/**
 * Utilidades de DOM y de formato.
 *
 * Regla de este frontend: todo lo que viene del servidor (títulos, nombres, motivos...) entra en la página como TEXTO,
 * nunca como HTML. Por eso h() usa append() y propiedades, y ningún archivo arma HTML con texto ajeno: así un título
 * como "<img onerror=...>" se ve tal cual y no se ejecuta (XSS).
 */

/** h("button", { class: "btn", onclick: alHacerClic }, "Texto", otroNodo) devuelve un elemento del DOM. */
export function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor == null || valor === false) continue;
    if (nombre === "class") el.className = valor;
    else if (nombre.startsWith("on")) el.addEventListener(nombre.slice(2), valor);
    else if (nombre in el) {
      try {
        el[nombre] = valor;
      } catch {
        el.setAttribute(nombre, valor === true ? "" : valor); // propiedades de solo lectura (list, form...)
      }
    } else el.setAttribute(nombre, valor === true ? "" : valor);
  }
  el.append(...hijos.flat(Infinity).filter((hijo) => hijo != null && hijo !== false));
  return el;
}

/** Igual que h() pero para elementos SVG (los gráficos). */
export function s(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) if (valor != null && valor !== false) el.setAttribute(nombre, valor);
  el.append(...hijos.flat(Infinity).filter((hijo) => hijo != null && hijo !== false));
  return el;
}

// ---------- Fechas: siempre en la zona de la empresa (la misma con la que las políticas leen la hora) ----------
const formato = (opciones) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", ...opciones });
const FECHA_HORA = formato({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const FECHA_CORTA = formato({ day: "2-digit", month: "short", year: "numeric" });

export const formatoFecha = (iso) => (iso ? FECHA_HORA.format(new Date(iso)) : "—");
export const formatoFechaCorta = (iso) => (iso ? FECHA_CORTA.format(new Date(iso)) : "—");

/** "hace 5 min", "hace 2 h", "hace 3 d"; pasada una semana, la fecha. */
export function hace(iso) {
  if (!iso) return "—";
  const segundos = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (segundos < 45) return "ahora";
  if (segundos < 3600) return `hace ${Math.round(segundos / 60)} min`;
  if (segundos < 86400) return `hace ${Math.round(segundos / 3600)} h`;
  if (segundos < 7 * 86400) return `hace ${Math.round(segundos / 86400)} d`;
  return formatoFechaCorta(iso);
}

/** "en 42 min", "en 1 h 05 min": lo que falta hasta una fecha futura (para la sesión). */
export function faltan(ms) {
  if (ms <= 0) return "vencida";
  const minutos = Math.ceil(ms / 60000);
  return minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
}

export function formatoTamano(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export const plural = (n, singular, pluralTexto) => `${n} ${n === 1 ? singular : pluralTexto}`;

/** "Ana Torres" -> "AT" */
export const iniciales = (nombre = "") =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "?";

/** Un color estable por texto (para los avatares): el mismo nombre siempre sale del mismo color. */
export function colorDe(texto = "") {
  let hash = 0;
  for (const c of texto) hash = (hash * 31 + c.codePointAt(0)) % 360;
  return `hsl(${hash} 55% 42%)`;
}

export const debounce = (fn, ms = 300) => {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), ms);
  };
};

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    /* sin permiso del portapapeles: se prueba con un campo temporal */
  }
  const campo = h("textarea", { class: "visually-hidden", value: texto });
  document.body.append(campo);
  campo.select();
  const copiado = document.execCommand("copy");
  campo.remove();
  return copiado;
}

/** Entrega un texto como archivo descargable (por ejemplo, el CSV de la auditoría). */
export function descargarTexto(nombre, texto, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([texto], { type: `${mime};charset=utf-8` }));
  const enlace = h("a", { href: url, download: nombre });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
