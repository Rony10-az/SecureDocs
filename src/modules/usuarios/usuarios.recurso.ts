import type { Request, RequestHandler, Response } from "express";
import type { RecursoCtx } from "../../authorization/tipos";
import { clock } from "../../context/clock";
import { normalizarTexto } from "../../context/entorno";
import { incluirRelaciones, type UsuarioConRelaciones } from "../../context/usuario";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { idDeParams } from "../comun";
import { resolverContrato, type Contrato } from "./usuarios.reglas";
import {
  actualizarUsuarioSchema,
  crearUsuarioSchema,
  type ActualizarUsuarioDto,
  type CrearUsuarioDto,
} from "./usuarios.schemas";

/** Atributos `recurso.*` que ven las políticas ABAC para un usuario (el usuario sobre el que se actúa). */
export function recursoDesdeUsuario(u: UsuarioConRelaciones): RecursoCtx {
  return {
    tipo: "usuario",
    id: u.id,
    departamento: u.departamento.codigo,
    rol: u.rol.nombre,
    nivel_seguridad: u.nivel_seguridad,
    estado: u.estado,
    tipo_contrato: u.tipo_contrato,
    pais: u.pais,
  };
}

/** Cargador para /usuarios/:id */
export async function cargarUsuario(req: Request): Promise<RecursoCtx | null> {
  const u = await prisma.usuario.findUnique({ where: { id: idDeParams(req) }, include: incluirRelaciones });
  return u ? recursoDesdeUsuario(u) : null;
}

/** Para la segunda autorización (ROLE_ASSIGN): el usuario ya está cargado por el `authorize` anterior. */
export const recursoYaCargado = (req: Request): RecursoCtx | null => req.recurso ?? null;

/** Lo que `cargarCandidatoUsuario` deja en `res.locals.alta` para que el controlador no repita el trabajo. */
export interface DatosAlta {
  dto: CrearUsuarioDto;
  rolId: number;
  departamentoId: number;
  contrato: Contrato;
  pais: string;
}

/**
 * Cargador para POST /usuarios: aún no existe el usuario, así que se evalúa el "candidato" (los atributos
 * que TENDRÍA, sin `id`). Valida el cuerpo, comprueba que el rol y el departamento existan y aplica
 * la coherencia contrato/expiración.
 */
export async function cargarCandidatoUsuario(req: Request, res: Response): Promise<RecursoCtx> {
  const dto = crearUsuarioSchema.parse(req.body ?? {});

  const [rol, departamento] = await Promise.all([
    prisma.rol.findUnique({ where: { nombre: dto.rol } }),
    prisma.departamento.findUnique({ where: { codigo: dto.departamento } }),
  ]);
  if (!rol) throw AppError.validacion(`El rol "${dto.rol}" no existe`);
  if (!departamento) throw AppError.validacion(`El departamento "${dto.departamento}" no existe`);

  const contrato = resolverContrato(null, dto, clock.fecha());
  const pais = normalizarTexto(dto.pais) ?? "PERU";
  const datos: DatosAlta = { dto, rolId: rol.id, departamentoId: departamento.id, contrato, pais };
  res.locals.alta = datos;

  return {
    tipo: "usuario",
    departamento: departamento.codigo,
    rol: rol.nombre,
    nivel_seguridad: dto.nivel_seguridad,
    estado: dto.estado,
    tipo_contrato: contrato.tipo,
    pais,
  };
}

/** PUT /usuarios/:id: valida el cuerpo y lo deja en `res.locals.cambios`. Va DESPUÉS de authorize("USER_MANAGE"). */
export const leerCambios: RequestHandler = (req, res, next) => {
  res.locals.cambios = actualizarUsuarioSchema.parse(req.body ?? {});
  next();
};

/** ¿Este PUT cambia el rol? (Solo entonces se exige además ROLE_ASSIGN.) */
export const cambiaElRol = (req: Request, res: Response): boolean => {
  const cambios = res.locals.cambios as ActualizarUsuarioDto;
  return cambios.rol !== undefined && cambios.rol !== req.recurso?.rol;
};
