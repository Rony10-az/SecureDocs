import type { RequestHandler } from "express";
import { config } from "../config";
import { AppError } from "../errors";
import { clock } from "./clock";
import type { Dispositivo, EntornoCtx } from "./tipos";

const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "Perú " -> "PERU": sin tildes, en mayúsculas y recortado. Devuelve null si viene vacío o es absurdamente largo. */
export function normalizarTexto(valor: string | undefined): string | null {
  if (!valor) return null;
  const limpio = valor.normalize("NFD").replace(/\p{M}/gu, "").trim().toUpperCase(); // \p{M} = marcas combinantes (las tildes)
  return limpio.length > 0 && limpio.length <= 40 ? limpio : null;
}

function dispositivoDe(valor: string | undefined): Dispositivo {
  const v = normalizarTexto(valor);
  return v === "CORPORATIVO" || v === "PERSONAL" ? v : "DESCONOCIDO";
}

/**
 * Construye `req.entorno` (hora, fecha, ubicación, dispositivo, IP).
 *
 * Ubicación y dispositivo son SIMULADOS con headers, como pide la guía. En un despliegue real
 * saldrían de la IP geolocalizada y de un certificado de dispositivo / MDM, no del cliente.
 */
export const contextoEntorno: RequestHandler = (req, _res, next) => {
  let hora = clock.hora();

  // Simular la hora solo se permite fuera de producción (así se prueba P4 sin esperar a las 20:00)
  const xHora = req.header("x-hora");
  if (xHora && config.NODE_ENV !== "production") {
    if (!HORA_VALIDA.test(xHora)) {
      throw AppError.validacion("X-Hora inválida: use el formato HH:mm (ej. 20:00)");
    }
    hora = xHora;
  }

  req.entorno = {
    hora,
    fecha: clock.fecha(),
    ubicacion: normalizarTexto(req.header("x-ubicacion")),
    dispositivo: dispositivoDe(req.header("x-dispositivo")),
    direccion_ip: req.ip ?? null,
  } satisfies EntornoCtx;

  next();
};
