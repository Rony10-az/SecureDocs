import type { RequestHandler } from "express";
import { cargarUsuarioCtx } from "../context/usuario";
import { AppError } from "../errors";
import { verificarToken } from "./jwt";

/**
 * Exige `Authorization: Bearer <token>` y deja al usuario ACTUAL (leído de la BD) en `req.usuario`.
 * Solo identifica; no decide permisos (eso es `authorize`, Bloque 3).
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const [esquema, token] = (req.header("authorization") ?? "").split(" ");
  if (esquema?.toLowerCase() !== "bearer" || !token) throw AppError.noAutenticado();

  const usuario = await cargarUsuarioCtx(verificarToken(token));
  if (!usuario) throw AppError.tokenInvalido(); // el usuario fue eliminado después de emitir el token

  req.usuario = usuario;
  next();
};
