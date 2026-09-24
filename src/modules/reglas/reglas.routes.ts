import { Router } from "express";
import { authenticate } from "../../auth/authenticate";
import { authorize } from "../../authorization/authorize";
import { obtenerCatalogos, obtenerReglas } from "./reglas.service";

// GET /catalogos  ->  roles, departamentos y permisos. Solo exige sesión (no es una decisión de autorización: no se audita).
export const catalogosRouter = Router();
catalogosRouter.get("/", authenticate, async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await obtenerCatalogos());
});

// GET /reglas  ->  matriz RBAC y políticas ABAC. Exige AUDIT_READ (quien audita puede ver cómo se decide) y queda
// auditado como AUDIT_READ sobre el recurso "reglas".
export const reglasRouter = Router();
reglasRouter.get("/", ...authorize("AUDIT_READ", () => ({ tipo: "reglas" })), async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await obtenerReglas());
});
