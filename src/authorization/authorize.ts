import type { Request, RequestHandler, Response } from "express";
import { audit } from "../audit/audit.service";
import { authenticate, usuarioActual } from "../auth/authenticate";
import { AppError } from "../errors";
import { autorizador } from "./servicios";
import { TIPO_RECURSO, type Accion, type Decision, type RecursoCtx } from "./tipos";

/**
 * Carga el recurso sobre el que se actúa (p. ej. el documento de :id). Null = no existe (404).
 * Recibe también `res` porque el de "crear" necesita leer el formulario multipart para conocer
 * los atributos del documento antes de evaluar las políticas.
 */
export type CargadorRecurso = (req: Request, res: Response) => Promise<RecursoCtx | null> | RecursoCtx | null;

/** Cómo se nombra el recurso en la auditoría: "documento:5", o solo "documento" si no hay id. */
function etiquetaRecurso(accion: Accion, recurso: RecursoCtx | undefined, req: Request): string {
  if (recurso) return recurso.id !== undefined ? `${recurso.tipo}:${recurso.id}` : recurso.tipo;
  const id = req.params?.id;
  return typeof id === "string" && /^\d+$/.test(id) ? `${TIPO_RECURSO[accion]}:${id}` : TIPO_RECURSO[accion];
}

/** Deja constancia de la decisión. Si esto falla, la petición falla: no se permite nada que no deje rastro. */
async function auditarDecision(
  req: Request,
  accion: Accion,
  recurso: RecursoCtx | undefined,
  decision: Decision,
  motivoSiPermitido: string,
): Promise<void> {
  const usuario = usuarioActual(req);
  await audit.registrar({
    usuarioId: usuario.id,
    usuarioCorreo: usuario.correo,
    recurso: etiquetaRecurso(accion, recurso, req),
    accion,
    resultado: decision.permitido ? "PERMITIDO" : "DENEGADO",
    etapa: decision.permitido ? "COMPLETA" : decision.etapa,
    politica: decision.permitido ? null : decision.politica,
    motivo: decision.permitido ? motivoSiPermitido : decision.motivo,
    ip: req.entorno.direccion_ip,
    ubicacion: req.entorno.ubicacion,
    dispositivo: req.entorno.dispositivo,
  });
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
  const decidir: RequestHandler = async (req, res, next) => {
    const usuario = usuarioActual(req);
    const base = { usuario, entorno: req.entorno };

    let recurso: RecursoCtx | undefined;
    let decision: Decision = await autorizador.decidirPrevia(base, accion);

    if (decision.permitido) {
      // El recurso se carga solo si el usuario pasó estado y RBAC: no se filtra su existencia a quien no debe
      if (cargarRecurso) {
        const cargado = await cargarRecurso(req, res);
        if (!cargado) throw AppError.noEncontrado();
        recurso = cargado;
      }
      decision = await autorizador.decidirAbac({ ...base, recurso }, accion);
    }

    await auditarDecision(req, accion, recurso, decision, "Acceso permitido");
    if (!decision.permitido) throw AppError.accesoDenegado(decision);

    req.recurso = recurso;
    next();
  };

  return [authenticate, decidir];
}

/**
 * Para LISTADOS (p. ej. GET /documentos): no hay un recurso concreto, así que aquí solo se verifican
 * estado (P7/P9) y RBAC y se deja constancia. Las políticas ABAC las aplica luego el servicio a CADA
 * elemento (`autorizador.decidirAbacLote`), de modo que la lista solo contiene lo que el usuario puede leer.
 */
export function authorizeLista(accion: Accion): RequestHandler[] {
  const decidir: RequestHandler = async (req, _res, next) => {
    const usuario = usuarioActual(req);
    const decision = await autorizador.decidirPrevia({ usuario, entorno: req.entorno }, accion);

    await auditarDecision(req, accion, undefined, decision, "Acceso permitido a la lista (cada elemento se filtra por ABAC)");
    if (!decision.permitido) throw AppError.accesoDenegado(decision);
    next();
  };

  return [authenticate, decidir];
}
