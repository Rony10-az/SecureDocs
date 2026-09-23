import { config } from "../config";

export interface Reloj {
  ahora(): Date;
}

const relojReal: Reloj = { ahora: () => new Date() };
let reloj: Reloj = relojReal;

// "en-GB" + h23 => "20:30" (y "00:05" a medianoche); "en-CA" => "2026-09-23"
const formatoHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: config.ZONA_HORARIA,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const formatoFecha = new Intl.DateTimeFormat("en-CA", {
  timeZone: config.ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Reloj inyectable: el resto del código nunca llama a `new Date()` directamente. */
export const clock = {
  ahora: () => reloj.ahora(),
  hora: (d: Date = reloj.ahora()) => formatoHora.format(d),
  fecha: (d: Date = reloj.ahora()) => formatoFecha.format(d),
};

/** Solo para pruebas: fija la hora del sistema. Sin argumento restaura el reloj real. */
export function fijarReloj(r?: Reloj) {
  reloj = r ?? relojReal;
}
