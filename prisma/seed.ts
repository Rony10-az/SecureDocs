import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  DEPARTAMENTOS,
  DOCUMENTOS,
  MATRIZ_RBAC,
  PASSWORD_PRUEBA,
  PERMISOS,
  POLITICAS,
  USUARIOS,
} from "./datos";

const prisma = new PrismaClient();

async function main() {
  // Departamentos
  for (const [codigo, nombre] of DEPARTAMENTOS) {
    await prisma.departamento.upsert({ where: { codigo }, update: { nombre }, create: { codigo, nombre } });
  }

  // Permisos
  for (const codigo of PERMISOS) {
    await prisma.permiso.upsert({ where: { codigo }, update: {}, create: { codigo } });
  }

  // Roles + matriz RBAC (se reescribe completa para reflejar cambios)
  for (const [nombre, codigos] of Object.entries(MATRIZ_RBAC)) {
    const rol = await prisma.rol.upsert({ where: { nombre }, update: {}, create: { nombre } });
    const permisos = await prisma.permiso.findMany({ where: { codigo: { in: codigos } } });
    await prisma.rolPermiso.deleteMany({ where: { rol_id: rol.id } });
    await prisma.rolPermiso.createMany({
      data: permisos.map((p) => ({ rol_id: rol.id, permiso_id: p.id })),
    });
  }

  // Políticas ABAC (la condición se guarda como JSONB)
  for (const p of POLITICAS) {
    const datos = {
      codigo: p.codigo,
      nombre: p.nombre,
      descripcion: p.descripcion ?? null,
      etapa: p.etapa,
      orden: p.orden,
      acciones: p.acciones,
      condicion: p.condicion as Prisma.InputJsonObject,
      roles_exceptuados: p.roles_exceptuados,
      motivo_denegacion: p.motivo_denegacion,
      activa: p.activa,
    };
    await prisma.politica.upsert({ where: { codigo: p.codigo }, update: datos, create: datos });
  }

  // Mapas código -> id
  const deptos = Object.fromEntries((await prisma.departamento.findMany()).map((d) => [d.codigo, d.id]));
  const roles = Object.fromEntries((await prisma.rol.findMany()).map((r) => [r.nombre, r.id]));

  // Usuarios
  const hash = await bcrypt.hash(PASSWORD_PRUEBA, 10);
  for (const u of USUARIOS) {
    const datos = {
      nombre: u.nombre,
      correo: u.correo,
      password_hash: hash,
      rol_id: roles[u.rol],
      departamento_id: deptos[u.depto],
      nivel_seguridad: u.nivel,
      pais: "PERU",
      tipo_contrato: u.tipo ?? "INTERNO",
      estado: u.estado ?? "ACTIVO",
      fecha_expiracion: u.expira ? new Date(u.expira) : null,
    } satisfies Prisma.UsuarioUncheckedCreateInput;
    await prisma.usuario.upsert({ where: { correo: u.correo }, update: datos, create: datos });
  }

  // Documentos (solo si la tabla está vacía)
  if ((await prisma.documento.count()) === 0) {
    const usuarios = Object.fromEntries((await prisma.usuario.findMany()).map((u) => [u.correo, u.id]));
    for (const d of DOCUMENTOS) {
      await prisma.documento.create({
        data: {
          titulo: d.titulo,
          propietario_id: usuarios[d.propietario],
          departamento_id: deptos[d.depto],
          nivel_confidencialidad: d.nivel,
          estado: d.estado,
          pais: "PERU",
        },
      });
    }
  }

  console.log("Seed completado ✔");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
