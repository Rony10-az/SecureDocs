import type { EstadoDocumento } from "@prisma/client";
import { AppError } from "../../errors";
import type { Decision } from "./documentos.schemas";

/**
 * Ciclo de vida de un documento:  BORRADOR -> PENDIENTE -> PUBLICADO | RECHAZADO
 * Son reglas de NEGOCIO (¿tiene sentido esta transición?); quién puede hacer qué ya lo decidió `authorize`.
 */

export interface CambiosDocumento {
  /** ¿Cambia el título, la descripción o el archivo? */
  hayCambios: boolean;
  /** ¿Se pide enviarlo a aprobación? */
  enviar: boolean;
  /** ¿Tendrá archivo (el que ya tiene o el que sube ahora)? */
  tieneArchivo: boolean;
}

/**
 *                     editar (sin enviar)                 editar + enviar
 *   BORRADOR          BORRADOR                            PENDIENTE
 *   PENDIENTE         PENDIENTE                           409 (ya está pendiente)
 *   PUBLICADO         PENDIENTE (pierde la aprobación)    PENDIENTE (con cambios) / 409 (sin cambios)
 *   RECHAZADO         RECHAZADO                           PENDIENTE
 *
 * Modificar algo que ya estaba publicado lo devuelve a PENDIENTE: la aprobación fue sobre el
 * contenido anterior, no sobre el nuevo.
 */
export function estadoTrasEditar(actual: EstadoDocumento, { hayCambios, enviar, tieneArchivo }: CambiosDocumento): EstadoDocumento {
  if (enviar) {
    if (!tieneArchivo) throw AppError.validacion("Para enviar a aprobación el documento debe tener un archivo adjunto");
    if (actual === "PENDIENTE") throw AppError.conflicto("El documento ya está pendiente de aprobación");
    if (actual === "PUBLICADO" && !hayCambios) throw AppError.conflicto("El documento ya está publicado");
    return "PENDIENTE";
  }
  if (actual === "PUBLICADO" && hayCambios) return "PENDIENTE";
  return actual;
}

/** Solo se resuelve (aprueba o rechaza) lo que está PENDIENTE. */
export function estadoTrasDecision(actual: EstadoDocumento, decision: Decision): EstadoDocumento {
  if (actual !== "PENDIENTE") {
    throw AppError.conflicto(`Solo se pueden resolver documentos PENDIENTES (estado actual: ${actual})`);
  }
  return decision === "APROBAR" ? "PUBLICADO" : "RECHAZADO";
}
