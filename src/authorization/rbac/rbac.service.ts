import type { PrismaClient } from "@prisma/client";
import type { PermisosPort } from "../autorizador";

/** RBAC: los permisos de cada rol se leen de la tabla `rol_permiso`, nunca del código. */
export class RbacService implements PermisosPort {
  constructor(private readonly db: Pick<PrismaClient, "rolPermiso">) {}

  async tienePermiso(rol: string, permiso: string): Promise<boolean> {
    const n = await this.db.rolPermiso.count({ where: { rol: { nombre: rol }, permiso: { codigo: permiso } } });
    return n > 0;
  }

  /** Códigos de permiso del rol, ordenados (para mostrarlos en /auth/me). */
  async permisosDelRol(rol: string): Promise<string[]> {
    const filas = await this.db.rolPermiso.findMany({
      where: { rol: { nombre: rol } },
      select: { permiso: { select: { codigo: true } } },
      orderBy: { permiso: { codigo: "asc" } },
    });
    return filas.map((f) => f.permiso.codigo);
  }
}
