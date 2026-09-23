import { Router } from "express";
import { usuarioActual } from "../../auth/authenticate";
import { authorize } from "../../authorization/authorize";
import { filtrosAuditoriaSchema } from "./auditoria.schemas";
import { listarAuditoria } from "./auditoria.service";

export const auditoriaRouter = Router();

// GET /auditoria?usuario=&accion=&resultado=&etapa=&desde=&hasta=&pagina=&limite=
// Consultar la auditoría también queda auditado (acción AUDIT_READ).
auditoriaRouter.get("/", ...authorize("AUDIT_READ"), async (req, res) => {
  const filtros = filtrosAuditoriaSchema.parse(req.query);
  res.json(await listarAuditoria(usuarioActual(req), filtros));
});
