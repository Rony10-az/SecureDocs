import type { PrismaClient } from "@prisma/client";
import type { Condicion, EtapaPolitica, PoliticaDef, PoliticasPort } from "./tipos";

/** Lee las políticas activas de la tabla `politica` (la condición viene de una columna JSONB). */
export class PoliticasRepo implements PoliticasPort {
  constructor(private readonly db: Pick<PrismaClient, "politica">) {}

  async activas(etapa: EtapaPolitica): Promise<PoliticaDef[]> {
    const filas = await this.db.politica.findMany({
      where: { activa: true, etapa },
      orderBy: [{ orden: "asc" }, { codigo: "asc" }],
    });
    return filas.map((f) => ({
      codigo: f.codigo,
      nombre: f.nombre,
      descripcion: f.descripcion ?? undefined,
      etapa: f.etapa,
      orden: f.orden,
      acciones: f.acciones,
      // Si en la BD no fuera un objeto, `validarCondicion` lo detecta y el motor deniega (fail-closed)
      condicion: f.condicion as unknown as Condicion,
      roles_exceptuados: f.roles_exceptuados,
      motivo_denegacion: f.motivo_denegacion,
      activa: f.activa,
    }));
  }
}
