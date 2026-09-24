import { prisma } from "../../db";

/**
 * Listas para llenar formularios y filtros (roles, departamentos y permisos). No son datos sensibles:
 * basta con tener sesión. El frontend las usa para no llevar los valores escritos a mano.
 */
export async function obtenerCatalogos() {
  const [roles, departamentos, permisos] = await Promise.all([
    prisma.rol.findMany({ orderBy: { id: "asc" }, select: { nombre: true } }),
    prisma.departamento.findMany({ orderBy: { id: "asc" }, select: { codigo: true, nombre: true } }),
    prisma.permiso.findMany({ orderBy: { id: "asc" }, select: { codigo: true } }),
  ]);
  return { roles: roles.map((r) => r.nombre), departamentos, permisos: permisos.map((p) => p.codigo) };
}

/**
 * Las reglas de acceso tal como están HOY en la base de datos: la matriz RBAC y las políticas ABAC con su condición
 * JSONB (etapa ESTADO primero y luego ABAC, cada una por `orden`: es el orden real de evaluación). Incluye las
 * políticas inactivas, marcadas con `activa: false`, para que quien audita vea todo lo que hay.
 */
export async function obtenerReglas() {
  const [permisos, roles, politicas] = await Promise.all([
    prisma.permiso.findMany({ orderBy: { id: "asc" }, select: { codigo: true } }),
    prisma.rol.findMany({
      orderBy: { id: "asc" },
      select: { nombre: true, permisos: { select: { permiso: { select: { codigo: true } } } } },
    }),
    prisma.politica.findMany({ orderBy: [{ etapa: "asc" }, { orden: "asc" }, { codigo: "asc" }] }),
  ]);

  return {
    rbac: {
      permisos: permisos.map((p) => p.codigo),
      roles: roles.map((r) => ({ nombre: r.nombre, permisos: r.permisos.map((rp) => rp.permiso.codigo).sort() })),
    },
    abac: politicas.map(({ id: _id, ...politica }) => politica),
  };
}
