import type { EntornoCtx, UsuarioCtx } from "../context/tipos";

/** Los 9 permisos del sistema (tabla `permiso`). Escribirlos mal es un error de compilación. */
export const ACCIONES = [
  "DOC_CREATE",
  "DOC_READ",
  "DOC_UPDATE",
  "DOC_DELETE",
  "DOC_APPROVE",
  "DOC_DOWNLOAD",
  "AUDIT_READ",
  "USER_MANAGE",
  "ROLE_ASSIGN",
] as const;
export type Accion = (typeof ACCIONES)[number];

/** Departamento transversal: sus usuarios (ADMIN, AUDITOR) no están atados a un solo departamento. */
export const DEPARTAMENTO_GLOBAL = "GLOBAL";

/** Sobre qué tipo de recurso actúa cada acción (para etiquetar el registro de auditoría). */
export const TIPO_RECURSO: Record<Accion, string> = {
  DOC_CREATE: "documento",
  DOC_READ: "documento",
  DOC_UPDATE: "documento",
  DOC_DELETE: "documento",
  DOC_APPROVE: "documento",
  DOC_DOWNLOAD: "documento",
  AUDIT_READ: "auditoria",
  USER_MANAGE: "usuario",
  ROLE_ASSIGN: "usuario",
};

/**
 * Atributos del recurso (rutas `recurso.*` de las políticas).
 * Para un documento: departamento, nivel_confidencialidad, propietario_id, estado, pais.
 */
export interface RecursoCtx {
  tipo: string;
  id?: number;
  [atributo: string]: unknown;
}

/** Quién pide y desde dónde. */
export interface ContextoBase {
  usuario: UsuarioCtx;
  entorno: EntornoCtx;
}

/** Todo lo que ven las políticas: usuario + entorno + (si aplica) recurso. */
export interface ContextoAutorizacion extends ContextoBase {
  recurso?: RecursoCtx;
}

export type EtapaDenegacion = "ESTADO" | "RBAC" | "ABAC";

/** Resultado de autorizar. Si se deniega, dice en qué etapa, qué política y por qué. */
export type Decision =
  | { permitido: true }
  | { permitido: false; etapa: EtapaDenegacion; politica: string | null; motivo: string };

declare global {
  namespace Express {
    interface Request {
      /** Lo pone `authorize` cuando la ruta carga un recurso. */
      recurso?: RecursoCtx;
    }
  }
}
