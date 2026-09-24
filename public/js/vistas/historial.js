/**
 * Historial dinámico de un documento: línea de tiempo agrupada por día, con filtros, eventos desplegables, resaltado de
 * lo nuevo y actualización EN VIVO. Mezcla lo que consta en el propio documento (creación y decisión) con la auditoría
 * de ese recurso, que solo puede leer quien tenga AUDIT_READ.
 *
 * La actualización en vivo consulta la auditoría cada 20 s. Como consultar la auditoría también deja un registro, se
 * limita: no consulta con la pestaña oculta, se pausa sola a los 10 minutos y se puede pausar a mano.
 */
import { llamar, puede } from "../api.js";
import { formatoFecha, formatoFechaCorta, h, hace } from "../dom.js";
import { ACCION, avatar, chip, enlacePolitica, icono, insigniaEtapa, insigniaResultado } from "../ui.js";

const EMOJI = { DOC_CREATE: "➕", DOC_READ: "👁️", DOC_UPDATE: "✏️", DOC_DELETE: "🗑️", DOC_APPROVE: "✅", DOC_DOWNLOAD: "⬇️" };
const CAMBIOS = new Set(["DOC_CREATE", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE"]);
const FILTROS = [
  ["todo", "📋 Todo"],
  ["cambio", "✏️ Cambios"],
  ["consulta", "👁️ Consultas"],
  ["denegado", "⛔ Denegados"],
];
const CADA_MS = 20_000;
const MAX_SONDEOS = 30; // 30 × 20 s = 10 minutos

const claveDelDia = (iso) => new Date(iso).toLocaleDateString("es-CA", { timeZone: "America/Lima" }); // AAAA-MM-DD en la zona de la empresa

function etiquetaDelDia(iso) {
  const clave = claveDelDia(iso);
  if (clave === claveDelDia(new Date().toISOString())) return "Hoy";
  if (clave === claveDelDia(new Date(Date.now() - 86_400_000).toISOString())) return "Ayer";
  return formatoFechaCorta(iso);
}

/** Convierte una fila de la auditoría en un evento de la línea de tiempo. */
const deAuditoria = (r) => ({
  id: `a${r.id}`,
  fecha: r.fecha,
  emoji: EMOJI[r.accion] ?? "•",
  titulo: ACCION[r.accion]?.[0] ?? r.accion,
  actor: r.usuario_correo ?? "—",
  tipo: r.resultado === "DENEGADO" ? "denegado" : CAMBIOS.has(r.accion) ? "cambio" : "consulta",
  auditoria: r,
});

/** Devuelve { el, detener }. `documento` es la respuesta de GET /documentos/:id. */
export function crearHistorial({ documento }) {
  const auditable = puede("AUDIT_READ");
  const propios = [{ id: "creado", fecha: documento.fecha_creacion, emoji: "📄", titulo: "Documento creado", actor: documento.propietario?.nombre ?? "—", tipo: "cambio", texto: `Lo creó ${documento.propietario?.nombre ?? "—"} con nivel de confidencialidad ${documento.nivel_confidencialidad} en ${documento.departamento}.` }];
  if (documento.aprobado_por && documento.fecha_aprobacion) {
    const rechazado = documento.estado === "RECHAZADO";
    propios.push({ id: "decision", fecha: documento.fecha_aprobacion, emoji: rechazado ? "❌" : "✅", titulo: rechazado ? "Rechazado" : "Aprobado y publicado", actor: documento.aprobado_por.nombre, tipo: "cambio", texto: `${rechazado ? "Lo rechazó" : "Lo aprobó"} ${documento.aprobado_por.nombre}.` });
  }

  const auditados = new Map(); // id -> evento
  const nuevos = new Set(); // los que llegaron después de la primera carga
  const abiertos = new Set(); // los desplegados
  let filtro = "todo";
  let pausado = false;
  let motivoPausa = "";
  let sondeos = 0;
  let ultimo = null; // cuándo se consultó por última vez
  let fallo = false;

  const el = h("div", { class: "historial" });
  const cabecera = h("div", { class: "historial-cabecera" });
  const chips = h("div", { class: "segmentado historial-filtros", role: "group", "aria-label": "Filtrar el historial" });
  const lista = h("div", { class: "historial-lista" });
  el.append(cabecera, chips, lista);

  const todos = () => [...propios, ...auditados.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const cuenta = (tipo) => todos().filter((e) => tipo === "todo" || e.tipo === tipo).length;

  // ---------- Cabecera: indicador en vivo ----------
  function pintarCabecera() {
    if (!auditable) {
      cabecera.replaceChildren(h("div", { class: "consejo" }, h("span", { class: "emoji" }, "🔒"), h("div", {}, "Tu rol no tiene ", h("strong", {}, "AUDIT_READ"), ": solo ves lo que consta en el propio documento (creación y decisión).")));
      return;
    }
    const estadoVivo = fallo ? "sin conexión" : pausado ? `en pausa${motivoPausa ? ` (${motivoPausa})` : ""}` : "en vivo";
    cabecera.replaceChildren(
      h(
        "div",
        { class: "historial-fila" },
      h("span", { class: `en-vivo${pausado || fallo ? " en-pausa" : ""}` }, h("span", { class: "en-vivo-punto" }), estadoVivo),
      ultimo && h("small", { class: "text-secondary" }, `actualizado ${hace(new Date(ultimo).toISOString())}`),
      nuevos.size > 0 && h("button", { type: "button", class: "btn btn-sm btn-warning", onclick: () => (nuevos.clear(), pintar()) }, `🔔 ${nuevos.size} ${nuevos.size === 1 ? "nuevo" : "nuevos"}`),
      h("div", { class: "ms-auto d-flex gap-1" }, h("button", { type: "button", class: "btn btn-sm btn-outline-secondary", title: pausado ? "Reanudar la actualización en vivo" : "Pausar la actualización en vivo", onclick: alternarPausa }, icono(pausado ? "play-fill" : "pause-fill"), h("span", { class: "d-none d-sm-inline ms-1" }, pausado ? "Reanudar" : "Pausar")), h("button", { type: "button", class: "btn btn-sm btn-outline-secondary", title: "Consultar ahora", onclick: () => cargar(false) }, icono("arrow-clockwise"))),
      ),
    );
  }

  function alternarPausa() {
    pausado = !pausado;
    motivoPausa = "";
    if (!pausado) sondeos = 0;
    pintarCabecera();
  }

  // ---------- Línea de tiempo ----------
  function detalle(e) {
    if (!e.auditoria) return h("div", { class: "evento-detalle" }, h("p", { class: "mb-0" }, e.texto));
    const r = e.auditoria;
    const dato = (nombre, valor) => [h("dt", {}, nombre), h("dd", {}, valor || "—")];
    return h("div", { class: "evento-detalle" }, h("dl", {}, dato("Fecha exacta", `${formatoFecha(r.fecha)} (Lima)`), dato("Acción", `${r.accion} · ${ACCION[r.accion]?.[0] ?? ""}`), dato("Recurso", r.recurso), dato("Motivo", r.motivo), dato("IP", r.ip), dato("Ubicación", r.ubicacion), dato("Dispositivo", r.dispositivo), dato("Registro", `#${r.id}`)));
  }

  function pintarFiltros() {
    chips.replaceChildren(...FILTROS.map(([valor, texto]) => h("button", { type: "button", class: `segmento${filtro === valor ? " activo" : ""}`, onclick: () => ((filtro = valor), pintar()) }, `${texto} `, h("small", { class: "historial-cuenta" }, String(cuenta(valor))))));
  }

  function evento(e) {
    const abierto = abiertos.has(e.id);
    const r = e.auditoria;
    return h(
      "li",
      { class: `evento evento-${e.tipo}${nuevos.has(e.id) ? " nuevo" : ""}${abierto ? " abierto" : ""}` },
      h("span", { class: "evento-punto" }, h("span", { class: "emoji" }, e.emoji)),
      h(
        "div",
        { class: "evento-cuerpo" },
        h(
          "button",
          { type: "button", class: "evento-cabecera", "aria-expanded": String(abierto), onclick: () => (abierto ? abiertos.delete(e.id) : abiertos.add(e.id), pintar()) },
          h("strong", {}, e.titulo),
          r && insigniaResultado(r.resultado),
          r?.resultado === "DENEGADO" && insigniaEtapa(r.etapa),
          h("span", { class: "evento-hora", title: formatoFecha(e.fecha) }, hace(e.fecha)),
          icono("chevron-down", "evento-flecha"),
        ),
        h("div", { class: "evento-actor" }, avatar(e.actor, "sm"), h("span", {}, e.actor), r?.politica_codigo && h("span", { class: "evento-politica" }, enlacePolitica(r.politica_codigo))),
        r?.resultado === "DENEGADO" && h("div", { class: "evento-motivo" }, "⛔ ", r.motivo),
        abierto && detalle(e),
      ),
    );
  }

  function pintar() {
    pintarCabecera();
    pintarFiltros();
    const visibles = todos().filter((e) => filtro === "todo" || e.tipo === filtro);
    if (visibles.length === 0) {
      lista.replaceChildren(h("p", { class: "text-secondary text-center py-3 mb-0" }, "🍃 No hay eventos de este tipo."));
      return;
    }
    const grupos = new Map();
    for (const e of visibles) {
      const clave = claveDelDia(e.fecha);
      if (!grupos.has(clave)) grupos.set(clave, { titulo: etiquetaDelDia(e.fecha), eventos: [] });
      grupos.get(clave).eventos.push(e);
    }
    lista.replaceChildren(...[...grupos.values()].map((g) => h("div", { class: "historial-dia" }, h("div", { class: "historial-dia-titulo" }, h("span", {}, `📅 ${g.titulo}`), chip(`${g.eventos.length}`, { color: "secondary" })), h("ol", { class: "linea-tiempo" }, g.eventos.map(evento)))));
  }

  // ---------- Datos y actualización en vivo ----------
  async function cargar(inicial) {
    if (!auditable) return;
    try {
      const r = await llamar("GET", "/auditoria", { params: { recurso: `documento:${documento.id}`, limite: 100 } });
      for (const fila of r.registros) {
        const e = deAuditoria(fila);
        if (auditados.has(e.id)) continue;
        auditados.set(e.id, e);
        if (!inicial) nuevos.add(e.id);
      }
      ultimo = Date.now();
      fallo = false;
    } catch (error) {
      fallo = true;
      if (error?.status === 401) document.dispatchEvent(new Event("sesion-invalida"));
    }
    pintar();
  }

  function sondear() {
    if (!auditable || pausado || document.hidden) return;
    if (++sondeos > MAX_SONDEOS) {
      pausado = true;
      motivoPausa = "por inactividad";
      pintarCabecera();
      return;
    }
    cargar(false);
  }

  const temporizadores = auditable ? [setInterval(sondear, CADA_MS)] : [];
  temporizadores.push(setInterval(pintar, 30_000)); // los "hace 2 min" siguen corriendo
  pintar();
  cargar(true);

  return { el, detener: () => temporizadores.forEach(clearInterval) };
}
