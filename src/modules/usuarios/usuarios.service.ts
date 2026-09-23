import { Prisma } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { hashPassword } from "../../auth/password";
import { autorizador, rbacService } from "../../authorization/servicios";
import type { ContextoBase } from "../../authorization/tipos";
import { clock } from "../../context/clock";
import { normalizarTexto } from "../../context/entorno";
import { incluirRelaciones, usuarioDesdeBD, type UsuarioConRelaciones } from "../../context/usuario";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { recursoDesdeUsuario, type DatosAlta } from "./usuarios.recurso";
import {
  PERMISO_GESTION,
  dejaSinGestores,
  resolverContrato,
  resumenAlta,
  resumenCambios,
  validarPasswordContraCorreo,
} from "./usuarios.reglas";
import type { ActualizarUsuarioDto, ListaUsuariosDto } from "./usuarios.schemas";

/** Lo que devuelve la API de un usuario. Nunca incluye la contraseña ni su hash. */
export function serializarUsuario(u: UsuarioConRelaciones) {
  return { ...usuarioDesdeBD(u), creado_en: u.creado_en.toISOString() };
}

const fechaISO = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const fechaSql = (iso: string) => new Date(`${iso}T00:00:00.000Z`); // columna DATE: medianoche UTC = la fecha exacta

function traducirErrorBD(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw AppError.conflicto("Ya existe un usuario con ese correo");
  }
  throw e;
}

/** Deja constancia del alta/cambio con su detalle, DENTRO de la misma transacción: o quedan los dos o ninguno. */
function eventoAuditoria(tx: Prisma.TransactionClient, ctx: ContextoBase, accion: string, recurso: string, motivo: string) {
  return new AuditService(tx).registrar({
    usuarioId: ctx.usuario.id,
    usuarioCorreo: ctx.usuario.correo,
    recurso,
    accion,
    resultado: "PERMITIDO",
    etapa: "COMPLETA",
    politica: null,
    motivo,
    ip: ctx.entorno.direccion_ip,
    ubicacion: ctx.entorno.ubicacion,
    dispositivo: ctx.entorno.dispositivo,
  });
}

export async function obtenerUsuario(id: number) {
  const u = await prisma.usuario.findUnique({ where: { id }, include: incluirRelaciones });
  if (!u) throw AppError.noEncontrado("Usuario no encontrado");
  return u;
}

/**
 * GET /usuarios: cada usuario pasa por las políticas ABAC como USER_MANAGE (hoy ninguna política
 * lo restringe, pero así una política futura se aplica sola). `total` cuenta solo lo visible.
 */
export async function listarUsuarios(base: ContextoBase, f: ListaUsuariosDto) {
  const where: Prisma.UsuarioWhereInput = {};
  if (f.q) {
    where.OR = [
      { nombre: { contains: f.q, mode: "insensitive" } },
      { correo: { contains: f.q, mode: "insensitive" } },
    ];
  }
  if (f.rol) where.rol = { nombre: f.rol };
  if (f.departamento) where.departamento = { codigo: f.departamento };
  if (f.estado) where.estado = f.estado;
  if (f.tipo_contrato) where.tipo_contrato = f.tipo_contrato;

  const usuarios = await prisma.usuario.findMany({
    where,
    include: incluirRelaciones,
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
  const decisiones = await autorizador.decidirAbacLote(base, PERMISO_GESTION, usuarios.map(recursoDesdeUsuario));
  const visibles = usuarios.filter((_, i) => decisiones[i].permitido);

  const desde = (f.pagina - 1) * f.limite;
  return {
    total: visibles.length,
    pagina: f.pagina,
    limite: f.limite,
    usuarios: visibles.slice(desde, desde + f.limite).map(serializarUsuario),
  };
}

export async function crearUsuario(ctx: ContextoBase, datos: DatosAlta) {
  const { dto, rolId, departamentoId, contrato, pais } = datos;
  validarPasswordContraCorreo(dto.password, dto.correo);
  const password_hash = await hashPassword(dto.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const creado = await tx.usuario.create({
        data: {
          nombre: dto.nombre,
          correo: dto.correo,
          password_hash,
          rol_id: rolId,
          departamento_id: departamentoId,
          nivel_seguridad: dto.nivel_seguridad,
          pais,
          tipo_contrato: contrato.tipo,
          estado: dto.estado,
          fecha_expiracion: contrato.expira ? fechaSql(contrato.expira) : null,
        },
        include: incluirRelaciones,
      });
      await eventoAuditoria(tx, ctx, "USER_CREATE", `usuario:${creado.id}`, resumenAlta(usuarioDesdeBD(creado)));
      return creado;
    });
  } catch (e) {
    return traducirErrorBD(e);
  }
}

/** Bloquea las filas de quienes hoy pueden gestionar usuarios: dos cambios simultáneos se hacen en fila. */
function bloquearGestores(tx: Prisma.TransactionClient) {
  return tx.$queryRaw`
    SELECT u.id FROM usuario u
    WHERE u.estado = 'ACTIVO'
      AND EXISTS (
        SELECT 1 FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id
        WHERE rp.rol_id = u.rol_id AND p.codigo = ${PERMISO_GESTION}
      )
    FOR UPDATE OF u`;
}

/**
 * Cambia los datos de un usuario. `ctx` es quien lo hace.
 * La autorización (USER_MANAGE, y ROLE_ASSIGN si cambia el rol) ya la resolvió `authorize`.
 */
export async function actualizarUsuario(ctx: ContextoBase, id: number, dto: ActualizarUsuarioDto) {
  // Lo que no depende del estado actual se resuelve fuera de la transacción (bcrypt tarda ~100 ms)
  const [rolNuevo, departamentoNuevo] = await Promise.all([
    dto.rol ? prisma.rol.findUnique({ where: { nombre: dto.rol } }) : null,
    dto.departamento ? prisma.departamento.findUnique({ where: { codigo: dto.departamento } }) : null,
  ]);
  if (dto.rol && !rolNuevo) throw AppError.validacion(`El rol "${dto.rol}" no existe`);
  if (dto.departamento && !departamentoNuevo) throw AppError.validacion(`El departamento "${dto.departamento}" no existe`);
  const paisNuevo = dto.pais !== undefined ? normalizarTexto(dto.pais) : undefined;
  if (dto.pais !== undefined && !paisNuevo) throw AppError.validacion("El país no es válido");
  const passwordHash = dto.password !== undefined ? await hashPassword(dto.password) : undefined;

  try {
    return await prisma.$transaction(async (tx) => {
      const actual = await tx.usuario.findUnique({ where: { id }, include: incluirRelaciones });
      if (!actual) throw AppError.noEncontrado("Usuario no encontrado");

      const contrato = resolverContrato(
        { tipo: actual.tipo_contrato, expira: fechaISO(actual.fecha_expiracion) },
        dto,
        clock.fecha(),
      );

      // Solo se escribe lo que REALMENTE cambia
      const datos: Prisma.UsuarioUncheckedUpdateInput = {};
      if (dto.nombre !== undefined && dto.nombre !== actual.nombre) datos.nombre = dto.nombre;
      if (dto.correo !== undefined && dto.correo !== actual.correo) datos.correo = dto.correo;
      if (rolNuevo && rolNuevo.id !== actual.rol_id) datos.rol_id = rolNuevo.id;
      if (departamentoNuevo && departamentoNuevo.id !== actual.departamento_id) datos.departamento_id = departamentoNuevo.id;
      if (dto.nivel_seguridad !== undefined && dto.nivel_seguridad !== actual.nivel_seguridad) datos.nivel_seguridad = dto.nivel_seguridad;
      if (paisNuevo && paisNuevo !== actual.pais) datos.pais = paisNuevo;
      if (dto.estado !== undefined && dto.estado !== actual.estado) datos.estado = dto.estado;
      if (contrato.tipo !== actual.tipo_contrato) datos.tipo_contrato = contrato.tipo;
      if (contrato.expira !== fechaISO(actual.fecha_expiracion)) datos.fecha_expiracion = contrato.expira ? fechaSql(contrato.expira) : null;
      if (passwordHash !== undefined && dto.password !== undefined) {
        validarPasswordContraCorreo(dto.password, dto.correo ?? actual.correo);
        datos.password_hash = passwordHash;
      }
      if (Object.keys(datos).length === 0) throw AppError.validacion("No hay nada que actualizar");

      // Siempre debe quedar al menos un usuario activo que pueda gestionar usuarios
      const rolFinal = rolNuevo?.nombre ?? actual.rol.nombre;
      const estadoFinal = dto.estado ?? actual.estado;
      const eraGestor = actual.estado === "ACTIVO" && (await rbacService.tienePermiso(actual.rol.nombre, PERMISO_GESTION));
      const seraGestor = estadoFinal === "ACTIVO" && (await rbacService.tienePermiso(rolFinal, PERMISO_GESTION));
      if (eraGestor && !seraGestor) {
        await bloquearGestores(tx);
        const otros = await tx.usuario.count({
          where: {
            id: { not: id },
            estado: "ACTIVO",
            rol: { permisos: { some: { permiso: { codigo: PERMISO_GESTION } } } },
          },
        });
        if (dejaSinGestores(eraGestor, seraGestor, otros)) {
          throw AppError.conflicto("Debe quedar al menos un usuario activo con permiso para gestionar usuarios");
        }
      }

      const actualizado = await tx.usuario.update({ where: { id }, data: datos, include: incluirRelaciones });
      await eventoAuditoria(
        tx,
        ctx,
        "USER_UPDATE",
        `usuario:${id}`,
        resumenCambios(usuarioDesdeBD(actual), usuarioDesdeBD(actualizado), passwordHash !== undefined),
      );
      return actualizado;
    });
  } catch (e) {
    return traducirErrorBD(e);
  }
}
