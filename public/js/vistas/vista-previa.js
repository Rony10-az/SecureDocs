/**
 * Vista previa de un documento dentro de la página: imagen (PNG o JPG) o PDF. Se carga solo cuando se pide y equivale a
 * una descarga: el archivo sale por GET /documentos/:id/archivo, con el permiso DOC_DOWNLOAD y con su registro de
 * auditoría. El navegador arma la imagen o el PDF con blob: a partir de lo que descargó (por eso la CSP admite blob:
 * en img-src y frame-src), y el SHA-256 se comprueba antes de mostrarlo. Word y Excel no se pueden previsualizar.
 */
import { obtenerArchivo } from "../api.js";
import { formatoTamano, h } from "../dom.js";
import { ilustracion } from "../ilustraciones.js";
import { avisarError, botonAccion, chip, icono, cargando, toast } from "../ui.js";

const PREVISUALIZABLES = new Set(["application/pdf", "image/png", "image/jpeg"]);

/** Devuelve { el, detener }. `documento` es la respuesta de GET /documentos/:id. */
export function crearVistaPrevia({ documento }) {
  const archivo = documento.archivo;
  const el = h("div", { class: "vista-previa" });
  let url = null;

  const soltarUrl = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
  };

  function inicial() {
    soltarUrl();
    if (!archivo) {
      el.replaceChildren(h("div", { class: "vista-previa-vacia" }, ilustracion("documento", 120), h("strong", {}, "Este documento no tiene archivo"), h("p", { class: "text-secondary mb-0" }, "Edítalo para adjuntar uno y poder previsualizarlo.")));
      return;
    }
    if (!PREVISUALIZABLES.has(archivo.mime)) {
      el.replaceChildren(h("div", { class: "vista-previa-vacia" }, h("span", { class: "vista-previa-emoji" }, archivo.mime.includes("spreadsheetml") ? "📗" : "📘"), h("strong", {}, "Este tipo de archivo no se puede previsualizar"), h("p", { class: "text-secondary mb-0" }, "Los navegadores solo muestran PDF e imágenes. Descárgalo para abrirlo con su programa.")));
      return;
    }
    el.replaceChildren(
      h(
        "div",
        { class: "vista-previa-vacia" },
        ilustracion("documento", 120),
        h("strong", {}, `Vista previa de ${archivo.nombre}`),
        h("p", { class: "text-secondary" }, `${archivo.mime === "application/pdf" ? "PDF" : "Imagen"} · ${formatoTamano(archivo.tamano)}. Cargarla equivale a descargar el archivo y queda auditada como DOC_DOWNLOAD.`),
        botonAccion({ texto: "Cargar vista previa", icono: "eye", permiso: "DOC_DOWNLOAD", variante: "primary", tam: "md", alPulsar: cargar }),
      ),
    );
  }

  async function cargar() {
    el.replaceChildren(cargando("Descargando y verificando el archivo…"));
    try {
      const { blob, integro, mime } = await obtenerArchivo(documento.id);
      soltarUrl();
      url = URL.createObjectURL(blob);
      const visor = mime === "application/pdf" ? h("iframe", { class: "vista-pdf", src: url, title: `Vista previa de ${archivo.nombre}`, referrerpolicy: "no-referrer" }) : h("img", { class: "vista-imagen", src: url, alt: `Vista previa de ${archivo.nombre}` });
      el.replaceChildren(
        h("div", { class: "vista-previa-barra" }, chip(integro === false ? "El SHA-256 NO coincide" : integro ? "Integridad verificada (SHA-256)" : "Sin verificar el SHA-256", { color: integro === false ? "danger" : integro ? "success" : "secondary", icono: integro === false ? "x-circle" : "patch-check" }), h("div", { class: "ms-auto d-flex gap-1" }, h("a", { class: "btn btn-sm btn-outline-secondary", href: url, target: "_blank", rel: "noopener" }, icono("box-arrow-up-right", "me-1"), "Abrir en otra pestaña"), h("button", { type: "button", class: "btn btn-sm btn-outline-secondary", onclick: inicial }, icono("x-lg", "me-1"), "Cerrar"))),
        visor,
      );
      toast("info", "La vista previa quedó registrada como descarga.", "👁️ Vista previa");
    } catch (e) {
      inicial();
      avisarError(e);
    }
  }

  inicial();
  return { el, detener: soltarUrl };
}
