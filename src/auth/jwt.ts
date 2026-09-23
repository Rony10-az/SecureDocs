import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config";
import { AppError } from "../errors";

const ALGORITMO = "HS256";
const EMISOR = "securedocs";

// "3600" (solo dígitos) se interpretaría como milisegundos; lo tratamos como segundos
const expiresIn = (/^\d+$/.test(config.JWT_EXPIRES_IN)
  ? Number(config.JWT_EXPIRES_IN)
  : config.JWT_EXPIRES_IN) as SignOptions["expiresIn"];

/**
 * El token solo dice QUIÉN es el usuario (`sub`).
 * Rol, estado y nivel NO viajan en él: se leen de la BD en cada petición,
 * así desactivar a alguien o cambiarle el rol surte efecto de inmediato.
 */
export function firmarToken(usuarioId: number): string {
  return jwt.sign({}, config.JWT_SECRET, {
    algorithm: ALGORITMO,
    issuer: EMISOR,
    subject: String(usuarioId),
    expiresIn,
  });
}

/** Devuelve el id del usuario o lanza 401 (TOKEN_EXPIRADO / TOKEN_INVALIDO). */
export function verificarToken(token: string): number {
  try {
    // `algorithms` fijo: evita que un atacante elija otro algoritmo (p. ej. "none")
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: [ALGORITMO], issuer: EMISOR });
    const id = typeof payload === "string" ? NaN : Number(payload.sub);
    if (!Number.isInteger(id)) throw AppError.tokenInvalido();
    return id;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof jwt.TokenExpiredError) throw AppError.tokenExpirado();
    throw AppError.tokenInvalido();
  }
}
