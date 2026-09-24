/**
 * Detalle de un documento: cabecera con el tipo de archivo, estado dentro del flujo, vista previa, historial dinámico,
 * ficha, archivo con su SHA-256, confidencialidad y los atributos que el servidor compara para decidir. Cada bloque es un
 * cuadro que se puede plegar. Las acciones dependen del estado del documento; el rol es solo una pista y decide el servidor.
 */
import { estado, llamar, puede, reglas } from "../api.js";
import { copiar, formatoFecha, formatoTamano, h, hace } from "../dom.js";
import { actuaSobreDocumentos, atributosDe } from "../condicion.js";
import { avatar, avisarError, botonAccion, cargando, chip, enlacePolitica, establecerTitulo, icono, insigniaEstado, medidorConfidencialidad, seccion, toast, vacio } from "../ui.js";
import { decidir, descargar, eliminar, enviarAprobacion, puedeDecidir, puedeEnviar } from "./acciones-documento.js";
import { abrirFormularioDocumento } from "./formulario-documento.js";
import { crearHistorial } from "./historial.js";
import { crearVistaPrevia } from "./vista-previa.js";

const migas = (texto) => h("nav", { class: "migas", "aria-label": "Ubicación" }, h("a", { href: "#/documentos" }, icono("arrow-left"), "Documentos"), h("span", {}, "/"), h("span", { class: "text-secondary" }, texto));

/** Cómo se ve cada tipo de archivo: emoji, color de la cabecera y nombre. */
function tipoArchivo(mime = "") {
  if (mime === "application/pdf") return { emoji: "📕", tono: "pdf", texto: "PDF" };
  if (mime.startsWith("image/")) return { emoji: "🖼️", tono: "img", texto: mime.replace("image/", "").toUpperCase() };
  if (mime.includes("wordprocessingml")) return { emoji: "📘", tono: "word", texto: "Word" };
  if (mime.includes("spreadsheetml")) return { emoji: "📗", tono: "excel", texto: "Excel" };
  return { emoji: "📄", tono: "sin", texto: "Sin archivo" };
}

function pasos(d) {
  const rechazado = d.estado === "RECHAZADO";
  const actual = { BORRADOR: 0, PENDIENTE: 1, PUBLICADO: 2, RECHAZADO: 2 }[d.estado];
  const lista = [
    ["Borrador", "pencil-square", `creado ${hace(d.fecha_creacion)}`],
    ["En aprobación", "hourglass-split", d.estado === "PENDIENTE" ? "esperando una decisión" : ""],
    [rechazado ? "Rechazado" : "Publicado", rechazado ? "x-circle" : "check-circle", d.fecha_aprobacion ? `${hace(d.fecha_aprobacion)} · ${d.aprobado_por?.nombre ?? ""}` : ""],
  ];
  return h(
    "ol",
    { class: "stepper", "aria-label": "Estado dentro del flujo" },
    lista.map(([texto, ic, fecha], i) =>
      h("li", { class: `stepper-paso${i < actual ? " hecho" : ""}${i === actual ? ` actual${rechazado ? " rechazado" : ""}` : ""}` }, h("span", { class: "stepper-punto" }, icono(i < actual ? "check-lg" : ic)), h("span", { class: "stepper-texto" }, h("strong", {}, texto), fecha && h("small", {}, fecha))),
    ),
  );
}

const ficha = (emoji, etiqueta, valor) => h("div", { class: "ficha-fila" }, h("span", { class: "ficha-emoji" }, emoji), h("div", { class: "min-w-0" }, h("small", {}, etiqueta), h("div", { class: "ficha-valor" }, valor)));

let limpiarActual = null; // detiene el historial en vivo y suelta la vista previa de la pantalla anterior

export async function documento(raiz, { id }) {
  limpiarActual?.();
  limpiarActual = null;
  establecerTitulo(`Documento #${id}`);
  raiz.replaceChildren(cargando("Cargando el documento…"));

  let d;
  try {
    d = await llamar("GET", `/documentos/${id}`);
  } catch (e) {
    raiz.replaceChildren(migas(`#${id}`), vacio({ icono: e.status === 404 ? "file-earmark-x" : "shield-lock", titulo: e.status === 404 ? "El documento no existe" : "No se pudo abrir el documento", texto: e.status === 404 ? "Puede haberse eliminado." : "Mira el aviso de arriba para saber por qué.", accion: h("a", { class: "btn btn-primary", href: "#/documentos" }, "Volver a la lista") }));
    return avisarError(e);
  }
  establecerTitulo(d.titulo);
  const recargar = () => documento(raiz, { id });
  const usuario = estado.sesion.usuario;
  const entorno = estado.perfil?.entorno;
  const tipo = tipoArchivo(d.archivo?.mime);

  // ---------- Cabecera y acciones ----------
  const verificacion = h("div", { class: "mt-2" });
  const acciones = [
    d.archivo &&
      botonAccion({
        texto: "Descargar",
        icono: "download",
        permiso: "DOC_DOWNLOAD",
        variante: "light",
        tam: "md",
        alPulsar: async () => {
          const resultado = await descargar(d);
          if (resultado) verificacion.replaceChildren(chip(resultado.integro === false ? "El SHA-256 NO coincide" : resultado.integro ? "Integridad verificada: el SHA-256 coincide" : "Descargado (el navegador no puede calcular el SHA-256)", { color: resultado.integro === false ? "danger" : "success", icono: resultado.integro === false ? "x-circle" : "patch-check" }));
        },
      }),
    puedeEnviar(d) && botonAccion({ texto: "Enviar a aprobación", icono: "send", permiso: "DOC_UPDATE", variante: "warning", tam: "md", alPulsar: async () => (await enviarAprobacion(d)) && recargar() }),
    puedeDecidir(d) && botonAccion({ texto: "Aprobar", icono: "check-lg", permiso: "DOC_APPROVE", variante: "success", tam: "md", alPulsar: async () => (await decidir(d, "APROBAR")) && recargar() }),
    puedeDecidir(d) && botonAccion({ texto: "Rechazar", icono: "x-lg", permiso: "DOC_APPROVE", variante: "outline-light", tam: "md", alPulsar: async () => (await decidir(d, "RECHAZAR")) && recargar() }),
    botonAccion({ texto: "Editar", icono: "pencil", permiso: "DOC_UPDATE", variante: "outline-light", tam: "md", alPulsar: () => abrirFormularioDocumento({ documento: d, alGuardar: recargar }) }),
    botonAccion({ texto: "Eliminar", icono: "trash", permiso: "DOC_DELETE", variante: "outline-light", tam: "md", alPulsar: async () => (await eliminar(d)) && (location.hash = "#/documentos") }),
    botonAccion({ texto: "Copiar enlace", icono: "link-45deg", variante: "outline-light", tam: "md", soloIcono: true, alPulsar: async () => toast((await copiar(`${location.origin}/#/documentos/${d.id}`)) ? "success" : "warning", "Enlace copiado.") }),
  ];

  const hero = h(
    "section",
    { class: `hero-doc hero-doc-${tipo.tono}` },
    h(
      "div",
      { class: "hero-doc-cabeza" },
      h("span", { class: "hero-doc-emoji", "aria-hidden": "true" }, tipo.emoji),
      h(
        "div",
        { class: "hero-doc-texto" },
        h("div", { class: "hero-doc-etiquetas" }, h("span", { class: "hero-etiqueta" }, tipo.texto), d.archivo && h("span", { class: "hero-etiqueta" }, formatoTamano(d.archivo.tamano)), h("span", { class: "hero-etiqueta" }, `#${d.id}`)),
        h("h2", {}, d.titulo),
        h("p", {}, d.descripcion ?? "Sin descripción"),
        h("div", { class: "hero-doc-chips" }, insigniaEstado(d.estado), chip(d.departamento, { icono: "building" }), chip(d.pais, { icono: "geo-alt" }), h("span", { class: "hero-cristal" }, medidorConfidencialidad(d.nivel_confidencialidad, { pequeno: true }))),
      ),
    ),
    h("div", { class: "hero-doc-acciones" }, acciones),
  );

  const flujo = h("section", { class: "tarjeta stepper-tarjeta" }, pasos(d));

  // ---------- Vista previa e historial (los dos se detienen al salir) ----------
  const previa = crearVistaPrevia({ documento: d });
  const historial = crearHistorial({ documento: d });
  limpiarActual = () => {
    previa.detener();
    historial.detener();
  };
  const seccionPrevia = seccion({ emoji: "👁️", titulo: "Vista previa", tono: "info", resumen: d.archivo?.nombre ?? "sin archivo", cuerpo: previa.el });
  const seccionHistorial = seccion({ emoji: "🕘", titulo: "Historial dinámico", tono: "primary", resumen: puede("AUDIT_READ") ? "se actualiza solo" : "solo lo del documento", cuerpo: historial.el });

  // ---------- Ficha ----------
  const propietario = h("span", { class: "persona" }, avatar(d.propietario?.nombre ?? "?", "sm"), d.propietario?.nombre ?? "—", d.propietario?.id === usuario.id && chip("eres tú", { color: "primary" }));
  const seccionFicha = seccion({
    emoji: "📇",
    titulo: "Ficha del documento",
    tono: "primary",
    cuerpo: h(
      "div",
      { class: "ficha" },
      ficha("👤", "Propietario", propietario),
      ficha("🏢", "Departamento", d.departamento),
      ficha("🌎", "País", d.pais),
      ficha("🗓️", "Creado", h("span", { title: formatoFecha(d.fecha_creacion) }, `${formatoFecha(d.fecha_creacion)} (${hace(d.fecha_creacion)})`)),
      d.aprobado_por && ficha(d.estado === "RECHAZADO" ? "❌" : "✅", d.estado === "RECHAZADO" ? "Rechazado por" : "Aprobado por", `${d.aprobado_por.nombre}${d.fecha_aprobacion ? ` · ${formatoFecha(d.fecha_aprobacion)}` : ""}`),
      ficha("🔖", "Estado", insigniaEstado(d.estado)),
    ),
  });

  // ---------- Archivo ----------
  const seccionArchivo = seccion({
    emoji: "📎",
    titulo: "Archivo",
    tono: "success",
    resumen: d.archivo ? formatoTamano(d.archivo.tamano) : "sin archivo",
    cuerpo: d.archivo
      ? h(
          "div",
          {},
          h("div", { class: "archivo-tarjeta" }, h("span", { class: "archivo-emoji" }, tipo.emoji), h("div", { class: "min-w-0" }, h("strong", { class: "d-block text-break" }, d.archivo.nombre), h("small", { class: "text-secondary" }, `${d.archivo.mime} · ${formatoTamano(d.archivo.tamano)}`))),
          h("div", { class: "campo-etiqueta mt-3" }, "🔏 SHA-256"),
          h(
            "div",
            { class: "hash" },
            h("code", {}, d.archivo.sha256),
            h(
              "button",
              {
                type: "button",
                class: "btn btn-sm btn-outline-secondary btn-icono",
                "aria-label": "Copiar el SHA-256",
                title: "Copiar",
                onclick: async () => {
                  const copiado = await copiar(d.archivo.sha256);
                  toast(copiado ? "success" : "warning", copiado ? "SHA-256 copiado." : "No se pudo copiar.");
                },
              },
              icono("clipboard"),
            ),
          ),
          verificacion,
        )
      : vacio({ icono: "file-earmark-x", titulo: "Sin archivo", texto: "Este documento todavía no tiene archivo adjunto. Edítalo para adjuntarlo." }),
  });

  // ---------- Confidencialidad ----------
  const seccionConfidencialidad = seccion({
    emoji: "🔐",
    titulo: "Confidencialidad",
    tono: "danger",
    resumen: `Nivel ${d.nivel_confidencialidad} de 5`,
    cuerpo: h(
      "div",
      { class: "d-grid gap-2" },
      medidorConfidencialidad(d.nivel_confidencialidad),
      h("p", { class: "text-secondary small mb-0" }, "Cuanto más alto el nivel, menos personas pueden abrirlo: el servidor lo compara con el nivel de seguridad de cada usuario."),
      h("p", { class: "text-secondary small mb-0" }, `Tú tienes nivel de seguridad ${usuario.nivel_seguridad}. Los niveles altos pueden exigir además horario o dispositivo. `, puede("AUDIT_READ") && h("a", { href: "#/reglas" }, "Ver las reglas")),
    ),
  });

  // ---------- Atributos que compara el servidor ----------
  const cuerpoAtributos = h("div", {}, cargando("Leyendo las reglas…"));
  const seccionAtributos = seccion({ emoji: "🧭", titulo: "Lo que compara el servidor", tono: "warning", cuerpo: cuerpoAtributos });

  raiz.replaceChildren(
    migas(d.titulo),
    hero,
    flujo,
    h("div", { class: "row g-3 mt-1" }, h("div", { class: "col-xl-8 d-grid gap-3 align-content-start" }, seccionPrevia, seccionHistorial), h("div", { class: "col-xl-4 d-grid gap-3 align-content-start" }, seccionFicha, seccionArchivo, seccionConfidencialidad, seccionAtributos)),
  );

  const conjunto = puede("AUDIT_READ") ? await reglas().catch(() => null) : null;
  const politicas = conjunto ? conjunto.abac.filter((p) => p.activa && actuaSobreDocumentos(p)) : null;
  const leidosPor = (...rutas) => (politicas ? politicas.filter((p) => rutas.some((r) => atributosDe(p.condicion).has(r))).map((p) => p.codigo) : null);
  const filas = [
    ["🏢 Departamento", d.departamento, usuario.departamento, leidosPor("recurso.departamento", "usuario.departamento")],
    ["🔐 Nivel", `${d.nivel_confidencialidad}`, `${usuario.nivel_seguridad} (de seguridad)`, leidosPor("recurso.nivel_confidencialidad", "usuario.nivel_seguridad")],
    ["🌎 País", d.pais, entorno?.ubicacion ?? "sin informar", leidosPor("recurso.pais", "entorno.ubicacion")],
    ["👤 Propietario", d.propietario?.nombre ?? "—", d.propietario?.id === usuario.id ? "eres tú" : usuario.nombre, leidosPor("recurso.propietario_id")],
    ["🔖 Estado del documento", d.estado, "—", leidosPor("recurso.estado")],
    ["🕒 Hora", "—", entorno?.hora ?? "—", leidosPor("entorno.hora")],
    ["💻 Dispositivo", "—", entorno?.dispositivo ?? "—", leidosPor("entorno.dispositivo")],
    ["🪪 Tu cuenta", "—", `${usuario.estado} · ${usuario.tipo_contrato}${usuario.fecha_expiracion ? ` · vence ${usuario.fecha_expiracion}` : ""}`, leidosPor("usuario.estado", "usuario.tipo_contrato", "usuario.fecha_expiracion")],
  ];
  cuerpoAtributos.replaceChildren(
    h(
      "div",
      {},
      h("p", { class: "text-secondary small" }, "Son los valores que las políticas comparan. La decisión la toma el servidor, no esta pantalla."),
      h("div", { class: "table-responsive" }, h("table", { class: "table table-sm tabla-atributos" }, h("thead", {}, h("tr", {}, ["Atributo", "Documento", "Tú", politicas && "Políticas"].map((t) => t && h("th", {}, t)))), h("tbody", {}, filas.map(([atributo, deDoc, deTi, codigos]) => h("tr", {}, h("th", { scope: "row" }, atributo), h("td", {}, deDoc), h("td", {}, deTi), politicas && h("td", {}, codigos.length > 0 ? h("span", { class: "d-flex flex-wrap gap-1" }, codigos.map(enlacePolitica)) : h("span", { class: "text-secondary" }, "—"))))))),
      !politicas && h("p", { class: "text-secondary small mb-0" }, icono("lock", "me-1"), "Tu rol no puede consultar las reglas, así que no se muestra qué política lee cada atributo."),
    ),
  );
  return limpiarActual;
}
