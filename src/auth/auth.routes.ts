import { Router } from "express";
import { audit } from "../audit/audit.service";
import { rbacService } from "../authorization/servicios";
import { config } from "../config";
import { AppError } from "../errors";
import { loginSchema } from "./auth.schemas";
import { autenticar } from "./auth.service";
import { authenticate, usuarioActual } from "./authenticate";
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
  const resultado = await autenticar(correo, password);
  const { entorno } = req;

  // Todo intento de login queda registrado, salga bien o mal (así se detecta la fuerza bruta)
  await audit.registrar({
    usuarioId: resultado.ok ? resultado.usuario.id : resultado.usuarioId,
    usuarioCorreo: correo,
    recurso: "sesion",
    accion: "LOGIN",
    resultado: resultado.ok ? "PERMITIDO" : "DENEGADO",
    etapa: "AUTENTICACION",
    politica: null,
    motivo: resultado.ok ? "Inicio de sesión exitoso" : "Credenciales inválidas",
    ip: entorno.direccion_ip,
    ubicacion: entorno.ubicacion,
    dispositivo: entorno.dispositivo,
  });

  if (!resultado.ok) throw AppError.credencialesInvalidas();
  const { usuario } = resultado;
  res.json({ token: firmarToken(usuario.id), tipo: "Bearer", expira_en: config.JWT_EXPIRES_IN, usuario });
});

// GET /auth/me  ->  quién eres, qué permisos tiene tu rol (tabla rol_permiso) y desde qué entorno consultas
authRouter.get("/me", authenticate, async (req, res) => {
  const usuario = usuarioActual(req);
  const permisos = await rbacService.permisosDelRol(usuario.rol);
  res.json({ usuario, permisos, entorno: req.entorno });
});
