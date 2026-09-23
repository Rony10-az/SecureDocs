import type { Request } from "express";
import { AppError } from "../errors";

/** El :id de la URL. Un id mal formado es un 400 y no llega a tocar la base de datos. */
export function idDeParams(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validacion("El id debe ser un número entero positivo");
  return id;
}

/** El id del recurso que `authorize` dejó cargado en la petición. */
export function idDelRecurso(req: Request): number {
  const id = req.recurso?.id;
  if (id === undefined) throw new Error("authorize no dejó el recurso cargado en la petición");
  return id;
}
