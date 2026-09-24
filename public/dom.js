/**
 * Utilidades de DOM.
 *
 * Regla de este frontend: todo lo que viene del servidor (títulos, nombres, motivos...) entra en la página
 * como TEXTO, nunca como HTML. Por eso h() usa append() y propiedades, y ningún archivo arma HTML con texto
 * ajeno: así un título como "<img onerror=...>" se ve tal cual y no se ejecuta (XSS).
 */

/** h("button", { class: "btn", onclick: alHacerClic }, "Texto", otroNodo) devuelve un elemento del DOM. */
export function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor == null || valor === false) continue;
    if (nombre === "class") el.className = valor;
    else if (nombre.startsWith("on")) el.addEventListener(nombre.slice(2), valor);
    else if (nombre in el) el[nombre] = valor;
    else el.setAttribute(nombre, valor === true ? "" : valor);
  }
  el.append(...hijos.flat(Infinity).filter((hijo) => hijo != null && hijo !== false));
  return el;
}

export const insignia = (texto, color) => h("span", { class: `badge text-bg-${color}` }, texto);

/** Botones "‹ Anterior · 2 / 5 · Siguiente ›". `ir(nuevaPagina)` se llama al pulsar uno. */
export function paginador(pagina, paginas, ir) {
  const boton = (texto, destino, desactivado) =>
    h("button", { type: "button", class: "btn btn-outline-secondary", disabled: desactivado, onclick: () => ir(destino) }, texto);
  return h(
    "div",
    { class: "btn-group btn-group-sm" },
    boton("‹ Anterior", pagina - 1, pagina <= 1),
    h("span", { class: "btn btn-outline-secondary disabled" }, `${pagina} / ${paginas}`),
    boton("Siguiente ›", pagina + 1, pagina >= paginas),
  );
}

/** Fecha y hora en la zona de la empresa (la misma con la que las políticas leen la hora). */
export function formatoFecha(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatoTamano(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
