/**
 * Auditoría (AUDIT_READ): quién hizo qué, con qué resultado y por qué (etapa, política y motivo). ADMIN y AUDITOR ven
 * todo; los demás, solo la actividad de su departamento.
 *
 * Paginación con "foto": consultar la auditoría también deja una fila nueva en la auditoría, y sin más las páginas se
 * irían desplazando (la 2 repetiría el último registro de la 1). Por eso la primera página toma la fecha de su registro
 * más reciente y las siguientes piden solo lo anterior o igual a esa fecha (`hasta`), en la hora del servidor.
 */
import { llamar } from "../api.js";
import { descargarTexto, formatoFecha, h, hace, plural } from "../dom.js";
import { ACCION, abrirMenu, avisarError, cabeceraPagina, chip, conEmoji, enlacePolitica, establecerTitulo, esqueleto, icono, insigniaEtapa, insigniaResultado, paginador, seccion, toast, vacio } from "../ui.js";

const filtros = { usuario: "", accion: "", resultado: "", etapa: "", recurso: "", desde: "", hasta: "", pagina: 1, limite: 15 };
const ACCIONES = ["LOGIN", "DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE", "DOC_DOWNLOAD", "AUDIT_READ", "USER_MANAGE", "ROLE_ASSIGN", "USER_CREATE", "USER_UPDATE"];
const ETAPAS = ["AUTENTICACION", "ESTADO", "RBAC", "ABAC", "COMPLETA"];
const RESULTADOS = [
  ["", "📋 Todos"],
  ["PERMITIDO", "✅ Permitidos"],
  ["DENEGADO", "⛔ Denegados"],
];
const COLUMNAS_CSV = ["id", "fecha", "usuario_id", "usuario_correo", "accion", "recurso", "resultado", "etapa", "politica_codigo", "motivo", "ip", "ubicacion", "dispositivo"];

/** Valor de un <input type="datetime-local"> (hora del equipo) para una fecha. */
const aLocal = (fecha) => {
  const dos = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
};
const aIso = (local) => (local ? new Date(local).toISOString() : "");

/**
 * Una celda de CSV. Si empieza por = + - @ o un control, Excel la tomaría por una fórmula: el motivo y el correo de un
 * intento de login los escribe quien ataca, así que se les antepone un apóstrofo (inyección de fórmulas en CSV).
 */
export function celdaCsv(valor) {
  const texto = valor == null ? "" : String(valor);
  const segura = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[",\n\r]/.test(segura) ? `"${segura.replace(/"/g, '""')}"` : segura;
}

export const aCsv = (registros) => [COLUMNAS_CSV.join(","), ...registros.map((r) => COLUMNAS_CSV.map((c) => celdaCsv(r[c])).join(","))].join("\r\n");

export async function auditoria(raiz) {
  establecerTitulo("Auditoría");
  let foto = ""; // la "foto" de esta consulta: el registro más reciente que existía al pedir la primera página
  let datos = null;

  // ---------- Controles ----------
  const usuario = h("input", { class: "form-control", placeholder: "Usuario (contiene)", value: filtros.usuario, "aria-label": "Usuario" });
  const recurso = h("input", { class: "form-control", placeholder: "Recurso (ej. documento:12)", value: filtros.recurso, "aria-label": "Recurso" });
  const accion = h("select", { class: "form-select", "aria-label": "Acción" }, h("option", { value: "" }, "Todas las acciones"), ACCIONES.map((a) => h("option", { value: a, selected: a === filtros.accion }, `${a} · ${ACCION[a]?.[0] ?? a}`)));
  const etapa = h("select", { class: "form-select", "aria-label": "Etapa" }, h("option", { value: "" }, "Todas las etapas"), ETAPAS.map((e) => h("option", { value: e, selected: e === filtros.etapa }, e)));
  const desde = h("input", { type: "datetime-local", class: "form-control", value: filtros.desde, "aria-label": "Desde" });
  const hasta = h("input", { type: "datetime-local", class: "form-control", value: filtros.hasta, "aria-label": "Hasta" });
  const grupoResultado = h("div", { class: "segmentado", role: "group", "aria-label": "Resultado" });
  const pintarResultados = () => grupoResultado.replaceChildren(...RESULTADOS.map(([valor, texto]) => h("button", { type: "button", class: `segmento${filtros.resultado === valor ? " activo" : ""}`, onclick: () => ((filtros.resultado = valor), pintarResultados(), consultar()) }, texto)));
  pintarResultados();

  const rangos = [
    ["15 min", () => new Date(Date.now() - 15 * 60_000)],
    ["1 hora", () => new Date(Date.now() - 3_600_000)],
    ["Hoy", () => new Date(new Date().setHours(0, 0, 0, 0))],
    ["24 horas", () => new Date(Date.now() - 86_400_000)],
    ["7 días", () => new Date(Date.now() - 7 * 86_400_000)],
  ];

  const resumen = h("div", { class: "resumen-auditoria" });
  const resultados = h("div", { class: "resultados" });
  const pie = h("div", { class: "pie-lista" });

  function leerFiltros() {
    Object.assign(filtros, { usuario: usuario.value.trim(), recurso: recurso.value.trim(), accion: accion.value, etapa: etapa.value, desde: desde.value, hasta: hasta.value });
  }

  /** Nueva consulta: página 1 y foto nueva. */
  function consultar() {
    leerFiltros();
    filtros.pagina = 1;
    foto = "";
    return cargar();
  }

  const parametros = (pagina, limite) => ({ usuario: filtros.usuario, accion: filtros.accion, resultado: filtros.resultado, etapa: filtros.etapa, recurso: filtros.recurso, desde: aIso(filtros.desde), hasta: filtros.hasta ? aIso(filtros.hasta) : foto, pagina, limite });

  async function cargar() {
    resultados.replaceChildren(esqueleto(8));
    try {
      datos = await llamar("GET", "/auditoria", { params: parametros(filtros.pagina, filtros.limite) });
      if (!foto && !filtros.hasta && datos.registros.length > 0) foto = datos.registros[0].fecha; // fija la foto
      pintar();
    } catch (e) {
      datos = null;
      resumen.replaceChildren();
      pie.replaceChildren();
      resultados.replaceChildren(vacio({ icono: "shield-lock", titulo: "No se pudo consultar la auditoría", texto: "Mira el aviso de arriba para saber por qué." }));
      avisarError(e);
    }
  }

  // ---------- Filas ----------
  const dato = (etiqueta, valor) => [h("dt", {}, etiqueta), h("dd", {}, valor || "—")];

  function filas(r) {
    const documentoId = /^documento:(\d+)$/.exec(r.recurso)?.[1];
    const flecha = icono("chevron-right", "flecha-fila");
    const detalle = h(
      "tr",
      { class: "fila-detalle d-none" },
      h("td", { colspan: 9 }, h("dl", { class: "detalle-auditoria" }, dato("Registro", `#${r.id}`), dato("Fecha exacta", `${formatoFecha(r.fecha)} (${r.fecha})`), dato("Usuario", `${r.usuario_correo ?? "—"}${r.usuario_id ? ` (id ${r.usuario_id})` : ""}`), dato("Acción", `${r.accion} · ${ACCION[r.accion]?.[0] ?? ""}`), dato("Motivo", r.motivo), dato("IP", r.ip), dato("Ubicación", r.ubicacion), dato("Dispositivo", r.dispositivo))),
    );
    const alternar = () => {
      const abierto = detalle.classList.toggle("d-none") === false;
      fila.setAttribute("aria-expanded", String(abierto));
      flecha.classList.toggle("abierta", abierto);
    };
    const fila = h(
      "tr",
      { class: "fila-clic", tabindex: 0, "aria-expanded": "false", onclick: alternar, onkeydown: (ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), alternar()) },
      h("td", { class: "text-nowrap", title: formatoFecha(r.fecha) }, hace(r.fecha)),
      h("td", {}, r.usuario_correo ?? "—"),
      h("td", {}, h("span", { class: "accion-audit" }, icono(ACCION[r.accion]?.[1] ?? "dot"), h("code", {}, r.accion))),
      h("td", {}, documentoId ? h("a", { href: `#/documentos/${documentoId}`, onclick: (ev) => ev.stopPropagation() }, r.recurso) : r.recurso),
      h("td", {}, insigniaResultado(r.resultado)),
      h("td", {}, insigniaEtapa(r.etapa)),
      h("td", { onclick: (ev) => ev.stopPropagation() }, r.politica_codigo ? enlacePolitica(r.politica_codigo) : "—"),
      h("td", { class: "motivo-audit" }, r.motivo),
      h("td", { class: "text-end" }, flecha),
    );
    return [fila, detalle];
  }

  function pintar() {
    const permitidos = datos.registros.filter((r) => r.resultado === "PERMITIDO").length;
    resumen.replaceChildren(chip(plural(datos.total, "registro", "registros"), { color: "primary", icono: "journal-text" }), chip(`${permitidos} permitidos en esta página`, { color: "success", icono: "check-lg" }), chip(`${datos.registros.length - permitidos} denegados en esta página`, { color: "danger", icono: "x-lg" }), foto && h("small", { class: "text-secondary", title: "Los registros nuevos, incluida esta consulta, no desplazan las páginas. «Consultar» toma una foto nueva." }, icono("camera", "me-1"), `Vista fija hasta ${formatoFecha(foto)}`));

    resultados.replaceChildren(
      datos.registros.length === 0
        ? vacio({ icono: "journal-x", titulo: "Sin registros", texto: "Ningún evento coincide con estos filtros." })
        : h("div", { class: "tabla-contenedor" }, h("table", { class: "table tabla-sd tabla-auditoria align-middle mb-0" }, h("thead", {}, h("tr", {}, ["Cuándo", "Usuario", "Acción", "Recurso", "Resultado", "Etapa", "Política", "Motivo", ""].map((t) => h("th", {}, t)))), h("tbody", {}, datos.registros.flatMap(filas)))),
    );

    const paginas = Math.max(1, Math.ceil(datos.total / datos.limite));
    pie.replaceChildren(
      h(
        "div",
        { class: "pie-contenido" },
        h("div", { class: "d-flex align-items-center gap-2" }, h("select", { class: "form-select form-select-sm w-auto", "aria-label": "Registros por página", onchange: (ev) => ((filtros.limite = Number(ev.target.value)), (filtros.pagina = 1), cargar()) }, [15, 30, 50, 100].map((n) => h("option", { value: n, selected: n === filtros.limite }, `${n} por página`)))),
        paginas > 1 && paginador(datos.pagina, paginas, (p) => ((filtros.pagina = p), cargar())),
      ),
    );
  }

  // ---------- Exportar ----------
  async function exportar(todo) {
    try {
      let registros = datos.registros;
      if (todo) {
        registros = [];
        for (let pagina = 1; pagina <= 5; pagina++) {
          const r = await llamar("GET", "/auditoria", { params: parametros(pagina, 200) });
          registros.push(...r.registros);
          if (registros.length >= r.total) break;
        }
      }
      const marca = aLocal(new Date()).replace(/[-:T]/g, "");
      descargarTexto(`auditoria-${marca}.csv`, aCsv(registros), "text/csv");
      toast("success", `${plural(registros.length, "registro exportado", "registros exportados")} a CSV.`);
    } catch (e) {
      avisarError(e);
    }
  }

  const botonExportar = h("button", { type: "button", class: "btn btn-outline-secondary", onclick: (ev) => datos && abrirMenu(ev.currentTarget, [{ texto: `Esta página (${datos.registros.length})`, icono: "filetype-csv", alPulsar: () => exportar(false) }, { texto: "Todo el resultado (hasta 1000)", icono: "download", alPulsar: () => exportar(true) }]) }, icono("download", "me-1"), "Exportar CSV");

  // ---------- Montaje ----------
  raiz.append(
    cabeceraPagina({ emoji: "📜", titulo: "Auditoría", texto: "Cada decisión del servidor, permitida o denegada, queda registrada antes de responder y no se puede modificar.", foto: "/img/servidores.jpg", acciones: botonExportar }),
    seccion({ emoji: "🔎", titulo: "Filtros de auditoría", tono: "primary", cuerpo: h(
      "form",
      { class: "filtros-auditoria", onsubmit: (ev) => (ev.preventDefault(), consultar()) },
      h("div", { class: "row g-2" }, h("div", { class: "col-md-6 col-xxl-3" }, conEmoji("👤", usuario)), h("div", { class: "col-md-6 col-xxl-3" }, conEmoji("⚙️", accion)), h("div", { class: "col-md-6 col-xxl-3" }, conEmoji("🚦", etapa)), h("div", { class: "col-md-6 col-xxl-3" }, conEmoji("📌", recurso)), h("div", { class: "col-md-6 col-xxl-3" }, h("label", { class: "campo-etiqueta" }, "🕒 Desde", h("small", { class: "campo-opcional" }, "hora de tu equipo")), desde), h("div", { class: "col-md-6 col-xxl-3" }, h("label", { class: "campo-etiqueta" }, "🏁 Hasta"), hasta)),
      h(
        "div",
        { class: "d-flex flex-wrap align-items-center gap-2 mt-3" },
        grupoResultado,
        h("span", { class: "text-secondary small ms-2" }, "Rango rápido:"),
        rangos.map(([texto, inicio]) => h("button", { type: "button", class: "btn btn-sm btn-outline-secondary", onclick: () => ((desde.value = aLocal(inicio())), (hasta.value = ""), consultar()) }, texto)),
        h("div", { class: "ms-auto d-flex gap-2" }, h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => (Object.assign(filtros, { usuario: "", accion: "", resultado: "", etapa: "", recurso: "", desde: "", hasta: "" }), [usuario, recurso, accion, etapa, desde, hasta].forEach((c) => (c.value = "")), pintarResultados(), consultar()) }, "Limpiar"), h("button", { class: "btn btn-primary" }, icono("search", "me-1"), "Consultar")),
      ),
    ) }),
    resumen,
    resultados,
    pie,
  );
  await consultar();
}
