import type { Request, RequestHandler } from "express";
import { audit } from "../audit/audit.service";
import { authenticate, usuarioActual } from "../auth/authenticate";
import { AppError } from "../errors";
import { autorizador } from "./servicios";
import { TIPO_RECURSO, type Accion, type Decision, type RecursoCtx } from "./tipos";

/** Carga el recurso sobre el que se actúa (p. ej. el documento de :id). Null = no existe (404). */
export type CargadorRecurso = (req: Request) => Promise<RecursoCtx | null> | RecursoCtx | null;

/** Cómo se nombra el recurso en la auditoría: "documento:5", o solo "documento" si no hay id. */
function etiquetaRecurso(accion: Accion, recurso: RecursoCtx | undefined, req: Request): string {
  if (recurso) return recurso.id !== undefined ? `${recurso.tipo}:${recurso.id}` : recurso.tipo;
  const id = req.params?.id;
  return typeof id === "string" && /^\d+$/.test(id) ? `${TIPO_RECURSO[accion]}:${id}` : TIPO_RECURSO[accion];
}

/**
 * Único punto por el que los controladores piden autorización:
 *
 *   router.post("/:id/aprobar", ...authorize("DOC_APPROVE", cargarDocumento), controlador)
 *
 * (Con `...` para que TypeScript siga infiriendo los tipos de `req` y `res` en el controlador.)
 *
 * Incluye `authenticate` (ninguna ruta se puede olvidar del token) y aplica el flujo completo:
 * P7/P9 -> RBAC -> [carga del recurso] -> ABAC -> auditoría. Si se deniega responde 403 con
 * etapa, política y motivo. La decisión se registra ANTES de responder, siempre.
 */
export function authorize(accion: Accion, cargarRecurso?: CargadorRecurso): RequestHandler[] {
  const decidir: RequestHandler = async (req, _res, next) => {
    const usuario = usuarioActual(req);
    const base = { usuario, entorno: req.entorno };

    let recurso: RecursoCtx | undefined;
    let decision: Decision = await autorizador.decidirPrevia(base, accion);

    if (decision.permitido) {
      // El recurso se carga solo si el usuario pasó estado y RBAC: no se filtra su existencia a quien no debe
      if (cargarRecurso) {
        const cargado = await cargarRecurso(req);
        if (!cargado) throw AppError.noEncontrado();
        recurso = cargado;
      }
      decision = await autorizador.decidirAbac({ ...base, recurso }, accion);
    }

    // Si esto falla, la petición falla: no se permite nada que no deje rastro
    await audit.registrar({
      usuarioId: usuario.id,
      usuarioCorreo: usuario.correo,
      recurso: etiquetaRecurso(accion, recurso, req),
      accion,
      resultado: decision.permitido ? "PERMITIDO" : "DENEGADO",
      etapa: decision.permitido ? "COMPLETA" : decision.etapa,
      politica: decision.permitido ? null : decision.politica,
      motivo: decision.permitido ? "Acceso permitido" : decision.motivo,
      ip: base.entorno.direccion_ip,
      ubicacion: base.entorno.ubicacion,
      dispositivo: base.entorno.dispositivo,
    });

    if (!decision.permitido) throw AppError.accesoDenegado(decision);

    req.recurso = recurso;
    next();
  };

  return [authenticate, decidir];
}
