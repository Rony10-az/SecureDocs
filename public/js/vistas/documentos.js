/**
 * Lista de documentos: búsqueda, filtros, vista de tabla o de tarjetas, selección múltiple con acciones en lote y menú
 * por fila. Solo aparecen los documentos que las políticas ABAC dejan leer al usuario. Los botones dependen del ESTADO del
 * documento y de una pista de rol; quien decide es el servidor.
 */
import { ErrorApi, catalogos, estado, guardarPrefs, llamar } from "../api.js";
import { debounce, h, hace, formatoFecha, plural } from "../dom.js";
import { ilustracion } from "../ilustraciones.js";
import {
  abrirMenu,
  avatar,
  avisarError,
  botonAccion,
  cabeceraPagina,
  cargando,
  chip,
  conEmoji,
  dialogo,
  establecerTitulo,
  esqueleto,
  icono,
  iconoArchivo,
  insigniaEstado,
  insigniaNivel,
  itemMenu,
  paginador,
  seccion,
  vacio,
} from "../ui.js";
import { decidir, descargar, eliminar, enviarAprobacion, puedeDecidir, puedeEnviar } from "./acciones-documento.js";
import { abrirFormularioDocumento } from "./formulario-documento.js";

const filtros = { q: "", estado: "", departamento: "", pagina: 1 }; // se conservan al ir y volver de otra pantalla
const ESTADOS = [
  ["", "📋 Todos"],
  ["BORRADOR", "✏️ Borrador"],
  ["PENDIENTE", "⏳ Pendiente"],
  ["PUBLICADO", "✅ Publicado"],
  ["RECHAZADO", "❌ Rechazado"],
];
const ir = (hash) => {
  location.hash = hash;
};

export async function documentos(raiz, { consulta = {} } = {}) {
  establecerTitulo("Documentos");
  if (consulta.estado !== undefined) {
    filtros.estado = consulta.estado;
    filtros.pagina = 1;
  }

  const cat = await catalogos().catch(() => ({ departamentos: [] }));
  let datos = null;
  const seleccion = new Set();

  // ---------- Controles ----------
  const buscador = h("input", { type: "search", class: "form-control", placeholder: "Buscar por título…  ( / )", value: filtros.q, "aria-label": "Buscar por título" });
  const grupoEstado = h("div", { class: "segmentado", role: "group", "aria-label": "Estado del documento" });
  const pintarEstados = () =>
    grupoEstado.replaceChildren(
      ...ESTADOS.map(([valor, texto]) =>
        h("button", { type: "button", class: `segmento${filtros.estado === valor ? " activo" : ""}`, onclick: () => ((filtros.estado = valor), (filtros.pagina = 1), pintarEstados(), cargar()) }, texto),
      ),
    );
  pintarEstados();

  const departamento = h("select", { class: "form-select", "aria-label": "Departamento" }, h("option", { value: "" }, "Todos los departamentos"), cat.departamentos.map((d) => h("option", { value: d.codigo, selected: d.codigo === filtros.departamento }, d.nombre)));
  const porPagina = h("select", { class: "form-select", "aria-label": "Documentos por página" }, [10, 20, 50].map((n) => h("option", { value: n, selected: n === estado.prefs.porPagina }, `${n} / pág.`)));
  const botonVista = (modo, ic, etiqueta) =>
    h("button", { type: "button", class: `segmento${estado.prefs.vistaDocumentos === modo ? " activo" : ""}`, "aria-label": etiqueta, title: etiqueta, onclick: () => (guardarPrefs({ vistaDocumentos: modo }), pintarVistas(), pintar()) }, icono(ic));
  const grupoVista = h("div", { class: "segmentado" });
  const pintarVistas = () => grupoVista.replaceChildren(botonVista("tabla", "list-ul", "Vista de tabla"), botonVista("tarjetas", "grid-3x3-gap", "Vista de tarjetas"));
  pintarVistas();

  const resultados = h("div", { class: "resultados" });
  const pie = h("div", { class: "pie-lista" });
  const barraSeleccion = h("div", { class: "barra-seleccion d-none", role: "region", "aria-label": "Acciones sobre la selección" });

  buscador.addEventListener("input", debounce(() => ((filtros.q = buscador.value.trim()), (filtros.pagina = 1), cargar()), 350));
  departamento.addEventListener("change", () => ((filtros.departamento = departamento.value), (filtros.pagina = 1), cargar()));
  porPagina.addEventListener("change", () => (guardarPrefs({ porPagina: Number(porPagina.value) }), (filtros.pagina = 1), cargar()));

  // ---------- Datos ----------
  async function cargar() {
    resumenFiltros();
    resultados.replaceChildren(esqueleto(6));
    try {
      datos = await llamar("GET", "/documentos", { params: { q: filtros.q, estado: filtros.estado, departamento: filtros.departamento, pagina: filtros.pagina, limite: estado.prefs.porPagina } });
      if (datos.documentos.length === 0 && datos.pagina > 1) {
        filtros.pagina = Math.max(1, Math.ceil(datos.total / datos.limite)); // se borró lo último de la página
        return cargar();
      }
      seleccion.clear();
      pintar();
    } catch (e) {
      datos = null;
      seleccion.clear();
      barraSeleccion.classList.add("d-none");
      resultados.replaceChildren(vacio({ icono: "shield-lock", titulo: "No se pudo cargar la lista", texto: "Mira el aviso de arriba para saber por qué." }));
      pie.replaceChildren();
      avisarError(e); // no se deja a la vista nada que el servidor no haya autorizado
    }
  }

  const items = (d) => [
    puedeEnviar(d) && itemMenu({ texto: "Enviar a aprobación", icono: "send", permiso: "DOC_UPDATE", alPulsar: async () => (await enviarAprobacion(d)) && cargar() }),
    puedeDecidir(d) && itemMenu({ texto: "Aprobar", icono: "check-lg", permiso: "DOC_APPROVE", alPulsar: async () => (await decidir(d, "APROBAR")) && cargar() }),
    puedeDecidir(d) && itemMenu({ texto: "Rechazar", icono: "x-lg", permiso: "DOC_APPROVE", alPulsar: async () => (await decidir(d, "RECHAZAR")) && cargar() }),
    itemMenu({ texto: "Editar", icono: "pencil", permiso: "DOC_UPDATE", alPulsar: () => abrirFormularioDocumento({ documento: d, alGuardar: cargar }) }),
    { separador: true },
    itemMenu({ texto: "Eliminar", icono: "trash", permiso: "DOC_DELETE", peligro: true, alPulsar: async () => (await eliminar(d)) && cargar() }),
  ];

  const acciones = (d) => [
    botonAccion({ texto: "Ver detalle", icono: "eye", soloIcono: true, alPulsar: () => ir(`#/documentos/${d.id}`) }),
    d.archivo && botonAccion({ texto: "Descargar", icono: "download", permiso: "DOC_DOWNLOAD", soloIcono: true, alPulsar: () => descargar(d) }),
    h("button", { type: "button", class: "btn btn-outline-secondary btn-sm btn-icono", "aria-label": "Más acciones", title: "Más acciones", onclick: (ev) => abrirMenu(ev.currentTarget, items(d)) }, icono("three-dots")),
  ];

  // ---------- Pintar ----------
  function pintar() {
    barraSeleccion.classList.add("d-none");
    if (!datos) return;
    if (datos.documentos.length === 0) {
      const filtrado = filtros.q || filtros.estado || filtros.departamento;
      resultados.replaceChildren(
        vacio({
          icono: filtrado ? "search" : "folder2-open",
          titulo: filtrado ? "Ningún documento coincide" : "No hay documentos que puedas ver",
          texto: filtrado ? "Prueba con otros filtros." : "Las políticas ABAC ocultan los documentos que tu usuario no puede leer.",
        }),
      );
    } else {
      resultados.replaceChildren(estado.prefs.vistaDocumentos === "tarjetas" ? rejilla() : tabla());
    }
    const paginas = Math.max(1, Math.ceil(datos.total / datos.limite));
    pie.replaceChildren(h("div", { class: "pie-contenido" }, h("span", { class: "text-secondary small" }, `${plural(datos.total, "documento visible", "documentos visibles")} · las políticas ABAC ocultan el resto`), paginas > 1 && paginador(datos.pagina, paginas, (p) => ((filtros.pagina = p), cargar()))));
  }

  function tabla() {
    const todas = h("input", { type: "checkbox", class: "form-check-input", "aria-label": "Seleccionar todos los de esta página", onchange: () => alternarTodos(todas.checked) });
    const marcas = new Map();
    const filas = datos.documentos.map((d) => {
      const marca = h("input", { type: "checkbox", class: "form-check-input", "aria-label": `Seleccionar ${d.titulo}`, onchange: () => ((marca.checked ? seleccion.add(d.id) : seleccion.delete(d.id)), sincronizarSeleccion(todas, marcas)) });
      marcas.set(d.id, marca);
      return h(
        "tr",
        {},
        h("td", { class: "col-marca" }, marca),
        h("td", {}, h("a", { class: "doc-enlace", href: `#/documentos/${d.id}` }, icono(iconoArchivo(d.archivo?.mime), "doc-icono"), h("span", {}, h("strong", {}, d.titulo), d.descripcion && h("small", { class: "doc-descripcion" }, d.descripcion)))),
        h("td", {}, chip(d.departamento, { color: "secondary" })),
        h("td", {}, insigniaNivel(d.nivel_confidencialidad)),
        h("td", {}, insigniaEstado(d.estado)),
        h("td", {}, h("span", { class: "persona" }, avatar(d.propietario?.nombre ?? "?", "sm"), h("span", {}, d.propietario?.nombre ?? "—"))),
        h("td", { class: "text-nowrap", title: formatoFecha(d.fecha_creacion) }, hace(d.fecha_creacion)),
        h("td", { class: "text-end text-nowrap" }, acciones(d)),
      );
    });
    return h("div", { class: "tabla-contenedor" }, h("table", { class: "table tabla-sd align-middle mb-0" }, h("thead", {}, h("tr", {}, h("th", { class: "col-marca" }, todas), ["Documento", "Depto.", "Nivel", "Estado", "Propietario", "Creado", ""].map((t) => h("th", {}, t)))), h("tbody", {}, filas)));
  }

  function rejilla() {
    return h(
      "div",
      { class: "rejilla-docs" },
      datos.documentos.map((d) =>
        h(
          "article",
          { class: "doc-tarjeta" },
          h("div", { class: "doc-tarjeta-cabecera" }, icono(iconoArchivo(d.archivo?.mime), "doc-tarjeta-icono"), insigniaEstado(d.estado)),
          h("a", { class: "doc-tarjeta-titulo", href: `#/documentos/${d.id}` }, d.titulo),
          h("p", { class: "doc-tarjeta-descripcion" }, d.descripcion ?? "Sin descripción"),
          h("div", { class: "doc-tarjeta-datos" }, chip(d.departamento), insigniaNivel(d.nivel_confidencialidad)),
          h("div", { class: "doc-tarjeta-pie" }, h("span", { class: "persona" }, avatar(d.propietario?.nombre ?? "?", "sm"), h("small", {}, `${d.propietario?.nombre ?? "—"} · ${hace(d.fecha_creacion)}`)), h("div", { class: "text-nowrap" }, acciones(d))),
        ),
      ),
    );
  }

  // ---------- Selección y acciones en lote ----------
  function alternarTodos(marcado) {
    seleccion.clear();
    if (marcado) datos.documentos.forEach((d) => seleccion.add(d.id));
    resultados.querySelectorAll("tbody input[type=checkbox]").forEach((c) => (c.checked = marcado));
    pintarBarraSeleccion();
  }

  function sincronizarSeleccion(todas, marcas) {
    todas.checked = seleccion.size === marcas.size;
    todas.indeterminate = seleccion.size > 0 && seleccion.size < marcas.size;
    pintarBarraSeleccion();
  }

  function pintarBarraSeleccion() {
    barraSeleccion.classList.toggle("d-none", seleccion.size === 0);
    if (seleccion.size === 0) return;
    const elegidos = datos.documentos.filter((d) => seleccion.has(d.id));
    barraSeleccion.replaceChildren(
      h("strong", {}, plural(elegidos.length, "seleccionado", "seleccionados")),
      h(
        "div",
        { class: "d-flex flex-wrap gap-2" },
        botonAccion({ texto: "Aprobar", icono: "check-lg", permiso: "DOC_APPROVE", variante: "success", alPulsar: () => lote({ titulo: "Aprobar documentos", docs: elegidos, elegible: puedeDecidir, omitido: "no está pendiente", hacer: (d) => llamar("POST", `/documentos/${d.id}/aprobar`, { json: { decision: "APROBAR" } }) }) }),
        botonAccion({ texto: "Rechazar", icono: "x-lg", permiso: "DOC_APPROVE", variante: "outline-danger", alPulsar: () => lote({ titulo: "Rechazar documentos", docs: elegidos, elegible: puedeDecidir, omitido: "no está pendiente", hacer: (d) => llamar("POST", `/documentos/${d.id}/aprobar`, { json: { decision: "RECHAZAR" } }) }) }),
        botonAccion({ texto: "Enviar a aprobación", icono: "send", permiso: "DOC_UPDATE", variante: "outline-warning", alPulsar: () => lote({ titulo: "Enviar a aprobación", docs: elegidos, elegible: puedeEnviar, omitido: "solo se envían borradores o rechazados", hacer: (d) => llamar("PUT", `/documentos/${d.id}`, { json: { enviar: true } }) }) }),
        botonAccion({ texto: "Eliminar", icono: "trash", permiso: "DOC_DELETE", variante: "outline-danger", alPulsar: () => lote({ titulo: "Eliminar documentos", docs: elegidos, elegible: () => true, omitido: "", hacer: (d) => llamar("DELETE", `/documentos/${d.id}`) }) }),
        h("button", { type: "button", class: "btn btn-sm btn-link", onclick: () => alternarTodos(false) }, "Quitar selección"),
      ),
    );
  }

  /** Aplica una acción a cada documento elegido y muestra qué pasó con cada uno (incluidas las denegaciones). */
  async function lote({ titulo, docs, elegible, omitido, hacer }) {
    const contenido = h("div", {}, cargando("Ejecutando…"));
    const ventana = dialogo({ titulo, icono: "list-check", ancho: "lg", cuerpo: contenido, pie: [h("button", { type: "button", class: "btn btn-primary", onclick: () => ventana.cerrar() }, "Cerrar")], alCerrar: cargar });
    const filas = [];
    for (const d of docs) {
      if (!elegible(d)) {
        filas.push({ d, tipo: "omitido", texto: omitido });
        continue;
      }
      try {
        await hacer(d);
        filas.push({ d, tipo: "ok", texto: "Hecho" });
      } catch (e) {
        if (e instanceof ErrorApi && e.status === 401) {
          ventana.cerrar();
          return document.dispatchEvent(new Event("sesion-invalida"));
        }
        if (e instanceof ErrorApi && e.status === 403 && e.cuerpo.error === "ACCESO_DENEGADO") filas.push({ d, tipo: "denegado", texto: e.cuerpo.motivo, detalle: `${e.cuerpo.etapa}${e.cuerpo.politica ? ` · ${e.cuerpo.politica}` : ""}` });
        else filas.push({ d, tipo: "error", texto: e.message ?? "Error inesperado" });
      }
    }
    const cuenta = (tipo) => filas.filter((f) => f.tipo === tipo).length;
    const RESULTADO = { ok: ["success", "check-lg", "Hecho"], denegado: ["danger", "shield-exclamation", "Denegado"], omitido: ["secondary", "skip-forward", "Omitido"], error: ["warning", "exclamation-triangle", "Error"] };
    contenido.replaceChildren(
      h("div", { class: "resumen-lote" }, ["ok", "denegado", "omitido", "error"].filter((t) => cuenta(t) > 0).map((t) => chip(`${cuenta(t)} ${RESULTADO[t][2].toLowerCase()}${cuenta(t) === 1 ? "" : "s"}`, { color: RESULTADO[t][0], icono: RESULTADO[t][1] }))),
      h("ul", { class: "resultado-lote" }, filas.map((f) => h("li", {}, chip(RESULTADO[f.tipo][2], { color: RESULTADO[f.tipo][0], icono: RESULTADO[f.tipo][1] }), h("div", {}, h("strong", {}, f.d.titulo), h("small", { class: "d-block text-secondary" }, [f.detalle, f.texto].filter(Boolean).join(" · ")))))),
    );
  }

  // ---------- Montaje ----------
  const panelFiltros = seccion({
    emoji: "🔎",
    titulo: "Buscar y filtrar",
    tono: "primary",
    cuerpo: h("div", {}, h("div", { class: "row g-2 align-items-center" }, h("div", { class: "col-12 col-xl-4" }, conEmoji("🔎", buscador)), h("div", { class: "col-sm-6 col-xl-4" }, conEmoji("🏢", departamento)), h("div", { class: "col-sm-6 col-xl-2" }, conEmoji("📄", porPagina)), h("div", { class: "col-12 col-xl-2 text-xl-end" }, grupoVista)), h("div", { class: "mt-3" }, grupoEstado)),
  });
  function resumenFiltros() {
    const n = [filtros.q, filtros.estado, filtros.departamento].filter(Boolean).length;
    panelFiltros.resumen(n === 0 ? "sin filtros" : `${n} filtro${n === 1 ? "" : "s"} activo${n === 1 ? "" : "s"}`);
  }

  raiz.append(
    cabeceraPagina({
      emoji: "📁",
      titulo: "Documentos",
      texto: "Solo aparecen los que tus políticas te dejan leer.",
      tono: "azul",
      ilustracion: ilustracion("documento", 84),
      acciones: [h("button", { type: "button", class: "btn btn-outline-light", "aria-label": "Actualizar la lista", title: "Actualizar", onclick: cargar }, icono("arrow-clockwise")), botonAccion({ texto: "Subir documento", icono: "cloud-arrow-up", permiso: "DOC_CREATE", variante: "light", tam: "md", alPulsar: () => abrirFormularioDocumento({ alGuardar: cargar }) })],
    }),
    h("div", { class: "mb-3" }, panelFiltros),
    barraSeleccion,
    resultados,
    pie,
  );

  const alTeclado = (ev) => {
    if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      ev.preventDefault();
      buscador.focus();
    }
  };
  document.addEventListener("keydown", alTeclado);

  await cargar();
  return () => document.removeEventListener("keydown", alTeclado);
}
