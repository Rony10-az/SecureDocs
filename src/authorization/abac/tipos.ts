/** Condición de una política: un objeto JSON (ver `condicion.ts` para el lenguaje). */
export type Condicion = { [clave: string]: unknown };

/** ESTADO = se evalúa ANTES de RBAC (P7, P9). ABAC = se evalúa DESPUÉS de RBAC. */
export type EtapaPolitica = "ESTADO" | "ABAC";

/** Una política tal como vive en la tabla `politica`. */
export interface PoliticaDef {
  codigo: string;
  nombre: string;
  descripcion?: string;
  etapa: EtapaPolitica;
  /** Orden de evaluación dentro de su etapa (menor = primero) */
  orden: number;
  /** Acciones a las que aplica; "*" = todas */
  acciones: string[];
  condicion: Condicion;
  roles_exceptuados: string[];
  motivo_denegacion: string;
  activa: boolean;
}

/** De dónde salen las políticas (la BD en producción, una lista en memoria en las pruebas). */
export interface PoliticasPort {
  activas(etapa: EtapaPolitica): Promise<PoliticaDef[]>;
}
