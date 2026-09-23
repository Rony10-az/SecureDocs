import { z } from "zod";

// En formularios multipart todo llega como texto ("true", "3"); en JSON llegan booleanos y números.
const booleano = z.union([z.boolean(), z.stringbool()]);

const ESTADOS = ["BORRADOR", "PENDIENTE", "PUBLICADO", "RECHAZADO"] as const;

const titulo = z
  .string({ error: "El título es obligatorio" })
  .trim()
  .min(3, "El título debe tener al menos 3 caracteres")
  .max(200, "El título admite hasta 200 caracteres");

const descripcion = z.string().trim().max(2000, "La descripción admite hasta 2000 caracteres");

/**
 * POST /documentos. Es `strictObject` a propósito: un campo que no esté aquí (p. ej. "estado",
 * "propietario_id", "aprobado_por") se RECHAZA en vez de ignorarse, para que nadie intente colar
 * datos que solo el sistema debe decidir (mass assignment).
 */
export const crearDocumentoSchema = z.strictObject({
  titulo,
  descripcion: descripcion.optional(),
  /** Código del departamento; si se omite, el del usuario */
  departamento: z.string().trim().toUpperCase().min(1).max(30).optional(),
  nivel_confidencialidad: z.coerce
    .number({ error: "El nivel de confidencialidad es obligatorio (1 a 5)" })
    .int("El nivel debe ser un número entero")
    .min(1, "El nivel mínimo es 1")
    .max(5, "El nivel máximo es 5"),
  /** País del documento (lo evalúa P5); si se omite, el del usuario */
  pais: z.string().trim().max(40).optional(),
  /** true = enviarlo ya a aprobación (queda PENDIENTE); false = borrador */
  enviar: booleano.default(false),
});

/**
 * PUT /documentos/:id. Solo se pueden cambiar título, descripción y archivo. El departamento, el
 * nivel de confidencialidad, el país y el propietario NO cambian después de crear el documento
 * (re-clasificar un documento sería un trámite aparte, con más controles).
 */
export const actualizarDocumentoSchema = z.strictObject({
  titulo: titulo.optional(),
  descripcion: descripcion.optional(),
  enviar: booleano.optional(),
});

/** POST /documentos/:id/aprobar. Sin cuerpo = aprobar. */
export const decisionSchema = z.strictObject({
  decision: z.enum(["APROBAR", "RECHAZAR"]).default("APROBAR"),
});

/** GET /documentos */
export const listaDocumentosSchema = z.object({
  q: z.string().trim().max(100).optional(),
  estado: z.enum(ESTADOS).optional(),
  departamento: z.string().trim().toUpperCase().max(30).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

export type CrearDocumentoDto = z.infer<typeof crearDocumentoSchema>;
export type ActualizarDocumentoDto = z.infer<typeof actualizarDocumentoSchema>;
export type Decision = z.infer<typeof decisionSchema>["decision"];
export type ListaDocumentosDto = z.infer<typeof listaDocumentosSchema>;
