/**
 * Ilustraciones planas dibujadas con SVG (sin archivos ni servicios externos). Toman sus colores de las clases il-*,
 * que salen de las variables de Bootstrap, así que cambian solas con el tema claro u oscuro.
 */
import { s } from "./dom.js";

const marco = (tam, ...formas) => s("svg", { viewBox: "0 0 120 96", width: tam, height: Math.round((tam * 96) / 120), role: "img", "aria-hidden": "true", class: "ilustracion" }, s("circle", { cx: 60, cy: 50, r: 42, class: "il-fondo" }), ...formas);

const DIBUJOS = {
  /** Una hoja con texto y una marca de visto bueno. */
  documento: (tam) =>
    marco(
      tam,
      s("path", { d: "M38 12h30l16 16v50a5 5 0 0 1-5 5H38a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5z", class: "il-papel" }),
      s("path", { d: "M68 12v11a5 5 0 0 0 5 5h11z", class: "il-doblez" }),
      s("rect", { x: 41, y: 36, width: 32, height: 4, rx: 2, class: "il-linea" }),
      s("rect", { x: 41, y: 45, width: 26, height: 4, rx: 2, class: "il-suave" }),
      s("rect", { x: 41, y: 54, width: 30, height: 4, rx: 2, class: "il-suave" }),
      s("circle", { cx: 84, cy: 72, r: 13, class: "il-ok" }),
      s("path", { d: "M78 72l4 4 8-9", fill: "none", stroke: "#fff", "stroke-width": 3.5, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    ),
  /** Una persona con una credencial. */
  usuario: (tam) =>
    marco(
      tam,
      s("circle", { cx: 60, cy: 36, r: 15, class: "il-linea" }),
      s("path", { d: "M30 80c0-17 13-28 30-28s30 11 30 28z", class: "il-linea" }),
      s("rect", { x: 66, y: 60, width: 30, height: 22, rx: 5, class: "il-papel" }),
      s("circle", { cx: 76, cy: 68, r: 4, class: "il-acento" }),
      s("rect", { x: 72, y: 75, width: 20, height: 3, rx: 1.5, class: "il-suave" }),
    ),
  /** Un globo con un marcador de ubicación. */
  entorno: (tam) =>
    marco(
      tam,
      s("circle", { cx: 56, cy: 52, r: 30, class: "il-papel" }),
      s("ellipse", { cx: 56, cy: 52, rx: 12, ry: 30, fill: "none", class: "il-trazo" }),
      s("path", { d: "M26 52h60M31 38h50M31 66h50", fill: "none", class: "il-trazo" }),
      s("path", { d: "M84 22c-8 0-14 6-14 14 0 10 14 24 14 24s14-14 14-24c0-8-6-14-14-14z", class: "il-acento" }),
      s("circle", { cx: 84, cy: 36, r: 5, fill: "#fff" }),
    ),
  /** Una lupa sobre una lista. */
  filtro: (tam) =>
    marco(
      tam,
      s("rect", { x: 30, y: 22, width: 48, height: 56, rx: 6, class: "il-papel" }),
      s("rect", { x: 38, y: 32, width: 30, height: 4, rx: 2, class: "il-linea" }),
      s("rect", { x: 38, y: 42, width: 22, height: 4, rx: 2, class: "il-suave" }),
      s("rect", { x: 38, y: 52, width: 26, height: 4, rx: 2, class: "il-suave" }),
      s("circle", { cx: 78, cy: 62, r: 15, fill: "none", class: "il-trazo-grueso" }),
      s("path", { d: "M89 73l12 12", class: "il-trazo-grueso", "stroke-linecap": "round" }),
    ),
  /** Un escudo con un candado. */
  escudo: (tam) =>
    marco(
      tam,
      s("path", { d: "M60 14l30 10v22c0 20-13 32-30 38-17-6-30-18-30-38V24z", class: "il-linea" }),
      s("rect", { x: 47, y: 46, width: 26, height: 20, rx: 4, fill: "#fff" }),
      s("path", { d: "M52 46v-6a8 8 0 0 1 16 0v6", fill: "none", stroke: "#fff", "stroke-width": 4 }),
      s("circle", { cx: 60, cy: 56, r: 3, class: "il-acento" }),
    ),
};

/** ilustracion("documento" | "usuario" | "entorno" | "filtro" | "escudo", 120) devuelve un <svg>. */
export const ilustracion = (nombre, tam = 120) => DIBUJOS[nombre](tam);
