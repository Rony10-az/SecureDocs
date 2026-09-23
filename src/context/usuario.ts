import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { UsuarioCtx } from "./tipos";

/** Relaciones que hay que traer para poder construir el contexto (rol y departamento como texto). */
export const incluirRelaciones = { rol: true, departamento: true } satisfies Prisma.UsuarioInclude;

export type UsuarioConRelaciones = Prisma.UsuarioGetPayload<{ include: typeof incluirRelaciones }>;

/** Fila de la BD -> atributos que ven las políticas. Nunca incluye password_hash. */
export function usuarioDesdeBD(u: UsuarioConRelaciones): UsuarioCtx {
  return {
    id: u.id,
    nombre: u.nombre,
    correo: u.correo,
    rol: u.rol.nombre,
    departamento: u.departamento.codigo,
    nivel_seguridad: u.nivel_seguridad,
    pais: u.pais,
    tipo_contrato: u.tipo_contrato,
    estado: u.estado,
    // @db.Date llega como Date a medianoche UTC: los primeros 10 caracteres son la fecha exacta
    fecha_expiracion: u.fecha_expiracion ? u.fecha_expiracion.toISOString().slice(0, 10) : null,
  };
}

/** Lee el usuario ACTUAL desde la BD (no confía en lo que diga el token). */
export async function cargarUsuarioCtx(id: number): Promise<UsuarioCtx | null> {
  const u = await prisma.usuario.findUnique({ where: { id }, include: incluirRelaciones });
  return u ? usuarioDesdeBD(u) : null;
}
