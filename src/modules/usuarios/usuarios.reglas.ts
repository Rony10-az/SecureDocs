/**
 * Reglas de NEGOCIO de la gestión de usuarios que no dependen de la base de datos (funciones puras,
 * fáciles de probar). Quién puede gestionar usuarios lo decide `authorize`; aquí solo se decide si
 * los datos resultantes tienen sentido.
 */
import type { TipoContrato } from "@prisma/client";
import type { UsuarioCtx } from "../../context/tipos";
import { AppError } from "../../errors";

/** El permiso que hace falta para gestionar usuarios. */
export const PERMISO_GESTION = "USER_MANAGE";

export interface Contrato {
  tipo: TipoContrato;
  /** "YYYY-MM-DD" o null */
  expira: string | null;
}

/**
 * Coherencia entre tipo de contrato y fecha de expiración:
 *  - EXTERNO: el acceso es temporal, así que necesita fecha (P9 la exige); y si se ESTABLECE una fecha
 *    nueva no puede estar en el pasado. Una fecha vieja que ya tenía no bloquea otros cambios
 *    (p. ej. desactivar a un invitado cuyo acceso ya venció).
 *  - INTERNO: no lleva fecha. Al pasar a INTERNO se borra sola; pedir una fecha con INTERNO es un error.
 */
export function resolverContrato(
  actual: Contrato | null,
  cambios: { tipo_contrato?: TipoContrato; fecha_expiracion?: string | null },
  hoy: string,
): Contrato {
  const tipo = cambios.tipo_contrato ?? actual?.tipo ?? "INTERNO";

  if (tipo === "INTERNO") {
    if (cambios.fecha_expiracion) throw AppError.validacion("Un usuario INTERNO no lleva fecha de expiración");
    return { tipo, expira: null };
  }

  const expira = cambios.fecha_expiracion !== undefined ? cambios.fecha_expiracion : (actual?.expira ?? null);
  if (expira === null) {
    throw AppError.validacion("Un usuario EXTERNO necesita fecha de expiración (fecha_expiracion, formato AAAA-MM-DD)");
  }
  if (cambios.fecha_expiracion && cambios.fecha_expiracion < hoy) {
    throw AppError.validacion("La fecha de expiración no puede ser anterior a hoy");
  }
  return { tipo, expira };
}

/** La contraseña no puede contener la parte local del correo (usuario@...): es lo primero que se prueba. */
export function validarPasswordContraCorreo(password: string, correo: string): void {
  const local = (correo.split("@")[0] ?? "").toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    throw AppError.validacion("La contraseña no puede contener el correo del usuario");
  }
}

/**
 * ¿Este cambio dejaría al sistema sin ningún usuario ACTIVO capaz de gestionar usuarios?
 * (Sería un bloqueo sin salida: nadie podría volver a dar de alta ni a rehabilitar a nadie.)
 * "Capaz de gestionar" se decide por el PERMISO (USER_MANAGE), no por el nombre de un rol.
 */
export function dejaSinGestores(eraGestor: boolean, seraGestor: boolean, otrosGestoresActivos: number): boolean {
  return eraGestor && !seraGestor && otrosGestoresActivos === 0;
}

const mostrar = (valor: string | number | null) => (valor === null ? "(ninguna)" : String(valor));

/** Detalle para la auditoría de un alta. Nunca incluye la contraseña. */
export function resumenAlta(u: UsuarioCtx): string {
  const vence = u.fecha_expiracion ? `, vence ${u.fecha_expiracion}` : "";
  return `Creó al usuario ${u.correo} (rol ${u.rol}, departamento ${u.departamento}, nivel ${u.nivel_seguridad}, ${u.tipo_contrato}${vence}, ${u.estado})`;
}

const CAMPOS: Array<[keyof UsuarioCtx, string]> = [
  ["nombre", "nombre"],
  ["correo", "correo"],
  ["rol", "rol"],
  ["departamento", "departamento"],
  ["nivel_seguridad", "nivel"],
  ["pais", "país"],
  ["tipo_contrato", "contrato"],
  ["estado", "estado"],
  ["fecha_expiracion", "expira"],
];

/**
 * Detalle para la auditoría de un cambio: qué campos cambiaron y de qué valor a cuál.
 * De la contraseña solo se deja constancia de que se restableció, jamás su valor ni su hash.
 */
export function resumenCambios(antes: UsuarioCtx, despues: UsuarioCtx, passwordCambiada: boolean): string {
  const partes = CAMPOS.filter(([campo]) => antes[campo] !== despues[campo]).map(
    ([campo, etiqueta]) => `${etiqueta}: ${mostrar(antes[campo] as string | number | null)} → ${mostrar(despues[campo] as string | number | null)}`,
  );
  if (passwordCambiada) partes.push("contraseña restablecida");
  return `Modificó a ${despues.correo}: ${partes.join("; ") || "sin cambios"}`;
}
