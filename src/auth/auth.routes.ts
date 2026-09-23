import { Router } from "express";
import { config } from "../config";
import { AppError } from "../errors";
import { loginSchema } from "./auth.schemas";
import { autenticar } from "./auth.service";
import { authenticate } from "./authenticate";
import { firmarToken } from "./jwt";

export const authRouter = Router();

// Estas respuestas llevan token y datos personales: que ningún navegador ni proxy las guarde
authRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// POST /auth/login  ->  { token, tipo, expira_en, usuario }
authRouter.post("/login", async (req, res) => {
  const { correo, password } = loginSchema.parse(req.body);
  const usuario = await autenticar(correo, password);
  res.json({ token: firmarToken(usuario.id), tipo: "Bearer", expira_en: config.JWT_EXPIRES_IN, usuario });
});

// GET /auth/me  ->  lo que el servidor sabe de ti Y del entorno desde el que consultas
authRouter.get("/me", authenticate, (req, res) => {
  if (!req.usuario) throw AppError.noAutenticado();
  res.json({ usuario: req.usuario, entorno: req.entorno });
});
