import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

/** Error "esperado" de la aplicación: lleva su código HTTP y un código estable para el cliente. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalle: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = "AppError";
  }

  static validacion(mensaje: string) {
    return new AppError(400, "VALIDACION", mensaje);
  }
  static noAutenticado(mensaje = "Debe iniciar sesión (header Authorization: Bearer <token>)") {
    return new AppError(401, "NO_AUTENTICADO", mensaje);
  }
  static tokenInvalido() {
    return new AppError(401, "TOKEN_INVALIDO", "Token inválido");
  }
  static tokenExpirado() {
    return new AppError(401, "TOKEN_EXPIRADO", "El token expiró, inicie sesión nuevamente");
  }
  static credencialesInvalidas() {
    // Mismo mensaje para "correo no existe" y "contraseña incorrecta": no revela qué cuentas existen
    return new AppError(401, "CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos");
  }
  static noEncontrado(mensaje = "Recurso no encontrado") {
    return new AppError(404, "NO_ENCONTRADO", mensaje);
  }
  /** 403 con el detalle que exige la guía: en qué etapa, qué política y por qué. */
  static accesoDenegado(d: { etapa: string; politica: string | null; motivo: string }) {
    return new AppError(403, "ACCESO_DENEGADO", d.motivo, { etapa: d.etapa, politica: d.politica, motivo: d.motivo });
  }
}

/** Ruta que no existe: se registra al final de app.ts. */
export const rutaNoEncontrada: RequestHandler = (req, _res, next) => {
  next(AppError.noEncontrado(`No existe ${req.method} ${req.path}`));
};

/** Manejador central: toda la API responde errores con la forma { error, mensaje, ... }. */
export const manejadorErrores: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "VALIDACION",
      mensaje: "Datos de entrada inválidos",
      detalles: err.issues.map((i) => ({ campo: i.path.map(String).join("."), mensaje: i.message })),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.codigo, mensaje: err.message, ...err.detalle });
    return;
  }

  // Errores del parser de express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "VALIDACION", mensaje: "El cuerpo de la petición no es JSON válido" });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "CUERPO_MUY_GRANDE", mensaje: "El cuerpo de la petición es demasiado grande" });
    return;
  }

  // Cualquier otra cosa es un bug nuestro: se registra en el servidor, el cliente no ve detalles
  console.error(err);
  res.status(500).json({ error: "ERROR_INTERNO", mensaje: "Error interno del servidor" });
};
