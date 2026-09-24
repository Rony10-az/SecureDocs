/**
 * Avisos: el resultado de la última acción. Un 403 muestra la decisión completa del servidor
 * (etapa, política y motivo), que es lo que hace visible el control de acceso.
 */
import { ErrorApi } from "./api.js";
import { h } from "./dom.js";

const principal = () => document.getElementById("aviso");

export const limpiarAviso = (zona = principal()) => zona.replaceChildren();

/** tipo: success | info | warning | danger. `contenido`: texto, nodo o lista de ambos. `zona`: dónde pintarlo. */
export function avisar(tipo, contenido, zona = principal()) {
  zona.replaceChildren(
    h(
      "div",
      { class: `alert alert-${tipo} alert-dismissible mb-3`, role: "alert" },
      contenido,
      h("button", { type: "button", class: "btn-close", "aria-label": "Cerrar", onclick: () => limpiarAviso(zona) }),
    ),
  );
}

const dato = (nombre, valor) => [h("dt", { class: "col-sm-2" }, nombre), h("dd", { class: "col-sm-10 mb-1" }, valor ?? "—")];

/** Convierte cualquier error en un aviso legible. Un 401 no se avisa aquí: cierra la sesión (lo atiende app.js). */
export function avisarError(e, zona = principal()) {
  if (!(e instanceof ErrorApi)) return avisar("danger", "No se pudo conectar con el servidor. ¿Está en marcha la API?", zona);

  const cuerpo = e.cuerpo;
  if (e.status === 401) return document.dispatchEvent(new Event("sesion-invalida"));

  if (e.status === 403 && cuerpo.error === "ACCESO_DENEGADO") {
    return avisar(
      "danger",
      [
        h("strong", {}, "⛔ Acceso denegado"),
        h(
          "dl",
          { class: "row mb-0 mt-2" },
          dato("Etapa", cuerpo.etapa),
          dato("Política", cuerpo.politica ?? "— (lo deniega el rol, sin política de atributos)"),
          dato("Motivo", cuerpo.motivo),
        ),
      ],
      zona,
    );
  }

  if (cuerpo.detalles?.length > 0) {
    const lineas = cuerpo.detalles.map((d) => h("li", {}, d.campo ? `${d.campo}: ${d.mensaje}` : d.mensaje));
    return avisar("warning", [h("strong", {}, e.message), h("ul", { class: "mb-0 mt-1" }, lineas)], zona);
  }

  avisar(e.status >= 500 ? "danger" : "warning", `${e.message} (HTTP ${e.status})`, zona);
}
