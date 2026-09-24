import { z } from "zod";

/** Filtros de GET /auditoria (todos opcionales). `desde`/`hasta` son fechas ISO, p. ej. 2026-09-23T00:00:00-05:00 */
export const filtrosAuditoriaSchema = z.object({
  usuario: z.string().trim().max(254).optional(),
  accion: z.string().trim().max(50).optional(),
  resultado: z.enum(["PERMITIDO", "DENEGADO"]).optional(),
  etapa: z.enum(["AUTENTICACION", "ESTADO", "RBAC", "ABAC", "COMPLETA"]).optional(),
  /** Coincidencia exacta con el recurso auditado, p. ej. "documento:12" (historial de un documento) */
  recurso: z.string().trim().max(60).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

export type FiltrosAuditoria = z.infer<typeof filtrosAuditoriaSchema>;
