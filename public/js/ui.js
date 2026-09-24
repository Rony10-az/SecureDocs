/**
 * Componentes de la interfaz: insignias, avatares, avisos, menús, diálogos, gráficos y botones.
 * Nada aquí habla con la API salvo para leer el estado de la sesión (permisos y preferencias).
 */
import { ErrorApi, estado, puede } from "./api.js";
import { h, iniciales, colorDe, s } from "./dom.js";

export const icono = (nombre, clase = "") => h("i", { class: `bi bi-${nombre}${clase ? ` ${clase}` : ""}`, "aria-hidden": "true" });

// ================= Textos y colores de los dominios del sistema =================
export const ESTADO_DOC = {
  BORRADOR: { color: "secondary", icono: "pencil-square", texto: "Borrador" },
  PENDIENTE: { color: "warning", icono: "hourglass-split", texto: "Pendiente" },
  PUBLICADO: { color: "success", icono: "check-circle", texto: "Publicado" },
  RECHAZADO: { color: "danger", icono: "x-circle", texto: "Rechazado" },
};
export const ESTADO_USUARIO = {
  ACTIVO: { color: "success", icono: "check-circle", texto: "Activo" },
  INACTIVO: { color: "secondary", icono: "dash-circle", texto: "Inactivo" },
  SUSPENDIDO: { color: "danger", icono: "slash-circle", texto: "Suspendido" },
};
const COLOR_NIVEL = { 1: "success", 2: "info", 3: "primary", 4: "warning", 5: "danger" };
const COLOR_ROL = { ADMIN: "danger", GERENTE: "primary", SUPERVISOR: "info", EMPLEADO: "secondary", AUDITOR: "warning", INVITADO: "dark" };
export const COLOR_ETAPA = { AUTENTICACION: "secondary", ESTADO: "info", RBAC: "primary", ABAC: "warning", COMPLETA: "success" };

/** Cómo se lee cada acción del sistema: [texto, icono]. */
export const ACCION = {
  LOGIN: ["Inicio de sesión", "box-arrow-in-right"],
  DOC_CREATE: ["Crear documento", "file-earmark-plus"],
  DOC_READ: ["Consultar documento", "eye"],
  DOC_UPDATE: ["Modificar documento", "pencil"],
  DOC_DELETE: ["Eliminar documento", "trash"],
  DOC_APPROVE: ["Aprobar o rechazar", "patch-check"],
  DOC_DOWNLOAD: ["Descargar archivo", "download"],
  AUDIT_READ: ["Consultar auditoría o reglas", "journal-text"],
  USER_MANAGE: ["Gestionar usuarios", "people"],
  ROLE_ASSIGN: ["Asignar rol", "person-gear"],
  USER_CREATE: ["Alta de usuario", "person-plus"],
  USER_UPDATE: ["Cambio de usuario", "person-check"],
};
export const PERMISO_TEXTO = {
  DOC_CREATE: "Crear documentos",
  DOC_READ: "Listar y consultar documentos",
  DOC_UPDATE: "Modificar documentos y enviarlos a aprobación",
  DOC_DELETE: "Eliminar documentos (borrado lógico)",
  DOC_APPROVE: "Aprobar o rechazar documentos pendientes",
  DOC_DOWNLOAD: "Descargar el archivo de un documento",
  AUDIT_READ: "Consultar la auditoría y las reglas de acceso",
  USER_MANAGE: "Consultar, crear y modificar usuarios",
  ROLE_ASSIGN: "Asignar o cambiar el rol de un usuario",
};

// ================= Insignias =================
export function chip(texto, { color = "secondary", icono: ic, titulo, alPulsar } = {}) {
  return h(
    alPulsar ? "button" : "span",
    { type: alPulsar ? "button" : null, class: `chip bg-${color}-subtle text-${color}-emphasis border border-${color}-subtle`, title: titulo, onclick: alPulsar },
    ic && icono(ic),
    texto,
  );
}

export const insigniaEstado = (e, mapa = ESTADO_DOC) => chip(mapa[e]?.texto ?? e, { color: mapa[e]?.color ?? "secondary", icono: mapa[e]?.icono });
export const insigniaEstadoUsuario = (e) => insigniaEstado(e, ESTADO_USUARIO);
export const insigniaNivel = (n) => chip(`Nivel ${n}`, { color: COLOR_NIVEL[n] ?? "secondary", icono: "shield", titulo: `Confidencialidad ${n} de 5` });
export const insigniaRol = (rol) => chip(rol, { color: COLOR_ROL[rol] ?? "secondary" });
export const insigniaEtapa = (etapa) => chip(etapa, { color: COLOR_ETAPA[etapa] ?? "secondary" });
export const insigniaResultado = (r) => chip(r === "PERMITIDO" ? "Permitido" : "Denegado", { color: r === "PERMITIDO" ? "success" : "danger", icono: r === "PERMITIDO" ? "check-lg" : "x-lg" });

export function avatar(nombre, tam = "md") {
  const el = h("span", { class: `avatar avatar-${tam}`, title: nombre }, iniciales(nombre));
  el.style.backgroundColor = colorDe(nombre);
  return el;
}

/** Ícono de un archivo según su tipo. */
export function iconoArchivo(mime = "") {
  if (mime === "application/pdf") return "file-earmark-pdf";
  if (mime.startsWith("image/")) return "file-earmark-image";
  if (mime.includes("wordprocessingml")) return "file-earmark-word";
  if (mime.includes("spreadsheetml")) return "file-earmark-excel";
  return "file-earmark";
}

export function establecerTitulo(texto) {
  const titulo = document.getElementById("titulo-pagina");
  if (titulo) titulo.textContent = texto;
  document.title = `${texto} · SecureDocs`;
}

// ================= Avisos =================
const zonaAvisos = () => document.getElementById("avisos");

const TIPO_TOAST = {
  success: "check-circle-fill",
  danger: "x-octagon-fill",
  warning: "exclamation-triangle-fill",
  info: "info-circle-fill",
};

/** Mensaje breve que aparece arriba a la derecha y se va solo. */
export function toast(tipo, mensaje, titulo) {
  const el = h(
    "div",
    { class: `toast-sd toast-${tipo}`, role: "status" },
    icono(TIPO_TOAST[tipo] ?? TIPO_TOAST.info, "toast-icono"),
    h("div", { class: "toast-texto" }, titulo && h("strong", {}, titulo), h("div", {}, mensaje)),
  );
  const quitar = () => {
    el.classList.add("saliendo");
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener("click", quitar);
  document.getElementById("toasts")?.append(el);
  setTimeout(quitar, tipo === "success" || tipo === "info" ? 4500 : 9000);
}

export const limpiarAvisos = (zona = zonaAvisos()) => zona?.replaceChildren();

/** Alerta dentro de la página o de un diálogo. tipo: success | info | warning | danger. */
export function avisar(tipo, contenido, zona = zonaAvisos()) {
  zona.replaceChildren(
    h(
      "div",
      { class: `alert alert-${tipo} alert-dismissible mb-3`, role: "alert" },
      contenido,
      h("button", { type: "button", class: "btn-close", "aria-label": "Cerrar", onclick: () => limpiarAvisos(zona) }),
    ),
  );
  if (zona === zonaAvisos()) zona.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

const ETAPAS_DECISION = ["ESTADO", "RBAC", "ABAC"];

/** Las tres etapas con la que falló marcada: lo anterior pasó y lo posterior no llegó a evaluarse. */
export function pipelineDenegacion(etapa) {
  const falla = ETAPAS_DECISION.indexOf(etapa);
  return h(
    "ol",
    { class: "pipeline", "aria-label": "Etapas de la decisión" },
    ETAPAS_DECISION.map((nombre, i) => {
      const estadoPaso = i < falla ? "ok" : i === falla ? "falla" : "pendiente";
      const texto = { ok: "superada", falla: "denegó", pendiente: "no se evaluó" }[estadoPaso];
      return h("li", { class: `paso paso-${estadoPaso}` }, icono(estadoPaso === "ok" ? "check-lg" : estadoPaso === "falla" ? "x-lg" : "dash"), h("strong", {}, nombre), h("small", {}, texto));
    }),
  );
}

/** El código de una política, con enlace a su regla si el rol puede consultarlas. */
export function enlacePolitica(codigo) {
  if (!puede("AUDIT_READ")) return chip(codigo, { color: "warning" });
  return h("a", { class: "chip bg-warning-subtle text-warning-emphasis border border-warning-subtle text-decoration-none", href: `#/reglas?codigo=${encodeURIComponent(codigo)}`, title: "Ver la regla" }, codigo, icono("box-arrow-up-right", "ms-1 small"));
}

function tarjetaDenegado(cuerpo) {
  return h(
    "div",
    { class: "denegado" },
    h("div", { class: "denegado-cabecera" }, icono("shield-exclamation", "denegado-icono"), h("div", {}, h("strong", {}, "Acceso denegado"), h("div", { class: "text-secondary small" }, "El servidor evaluó la petición y la rechazó."))),
    pipelineDenegacion(cuerpo.etapa),
    h(
      "dl",
      { class: "denegado-datos" },
      h("dt", {}, "Etapa"),
      h("dd", {}, insigniaEtapa(cuerpo.etapa)),
      h("dt", {}, "Política"),
      h("dd", {}, cuerpo.politica ? enlacePolitica(cuerpo.politica) : h("span", { class: "text-secondary" }, "— la deniega el rol, no una política de atributos")),
      h("dt", {}, "Motivo"),
      h("dd", {}, cuerpo.motivo),
    ),
  );
}

/** Convierte cualquier error en un aviso legible. Un 401 no se avisa aquí: cierra la sesión (lo atiende app.js). */
export function avisarError(e, zona = zonaAvisos()) {
  if (!(e instanceof ErrorApi)) return avisar("danger", "No se pudo conectar con el servidor. ¿Está en marcha la API?", zona);

  const cuerpo = e.cuerpo;
  if (e.status === 401) return document.dispatchEvent(new Event("sesion-invalida"));

  if (e.status === 403 && cuerpo.error === "ACCESO_DENEGADO") {
    zona.replaceChildren(
      h("div", { class: "denegado-envoltura" }, tarjetaDenegado(cuerpo), h("button", { type: "button", class: "btn-close denegado-cerrar", "aria-label": "Cerrar", onclick: () => limpiarAvisos(zona) })),
    );
    if (zona === zonaAvisos()) zona.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }

  if (cuerpo.detalles?.length > 0) {
    const lineas = cuerpo.detalles.map((d) => h("li", {}, d.campo ? `${d.campo}: ${d.mensaje}` : d.mensaje));
    return avisar("warning", [h("strong", {}, e.message), h("ul", { class: "mb-0 mt-1" }, lineas)], zona);
  }

  avisar(e.status >= 500 ? "danger" : "warning", `${e.message} (HTTP ${e.status})`, zona);
}

// ================= Menús flotantes (el "⋯" de cada fila) =================
let menuAbierto = null;
let menuAncla = null;

function cerrarMenu() {
  menuAbierto?.remove();
  menuAbierto = menuAncla = null;
}

document.addEventListener(
  "click",
  (ev) => {
    if (menuAbierto && !menuAbierto.contains(ev.target) && !menuAncla?.contains(ev.target)) cerrarMenu();
  },
  true,
);
document.addEventListener("keydown", (ev) => ev.key === "Escape" && cerrarMenu());
addEventListener("scroll", cerrarMenu, true);
addEventListener("resize", cerrarMenu);

/** items: [{ texto, icono, alPulsar, peligro, bloqueado, titulo }] o { separador: true } o { encabezado: "texto" } */
export function abrirMenu(ancla, items) {
  if (menuAbierto && menuAncla === ancla) return cerrarMenu(); // un segundo clic lo cierra
  cerrarMenu();

  const menu = h(
    "div",
    { class: "menu-flotante", role: "menu" },
    items.filter(Boolean).map((item) => {
      if (item.separador) return h("hr", { class: "menu-sep" });
      if (item.encabezado) return h("div", { class: "menu-encabezado" }, item.encabezado);
      return h(
        "button",
        {
          type: "button",
          role: "menuitem",
          class: `menu-item${item.peligro ? " menu-peligro" : ""}${item.bloqueado ? " bloqueado" : ""}`,
          title: item.titulo,
          onclick: () => {
            cerrarMenu();
            item.alPulsar?.();
          },
        },
        item.icono && icono(item.icono),
        h("span", {}, item.texto),
        item.bloqueado && icono("lock-fill", "ms-auto small"),
      );
    }),
  );
  document.body.append(menu);

  const caja = ancla.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, caja.right - menu.offsetWidth))}px`;
  const cabeAbajo = caja.bottom + 6 + menu.offsetHeight < innerHeight - 8;
  menu.style.top = `${cabeAbajo ? caja.bottom + 6 : Math.max(8, caja.top - 6 - menu.offsetHeight)}px`;
  menuAbierto = menu;
  menuAncla = ancla;
}

// ================= Diálogos =================
/** Ventana modal con <dialog>: foco, tecla Esc y fondo atenuado nativos. Devuelve { el, cuerpo, avisos, cerrar }. */
export function dialogo({ titulo, icono: ic, cuerpo, pie, ancho = "md", alCerrar, banner }) {
  const avisos = h("div", { class: "dlg-avisos" });
  const cuerpoEl = h("div", { class: "modal-body" }, avisos, cuerpo);
  const cerrarBoton = h("button", { type: "button", class: `btn-close${banner ? " btn-close-white" : ""}`, "aria-label": "Cerrar", onclick: () => cerrar() });

  // Con `banner` la cabecera es una franja de color (o con foto) con un emoji grande, un subtítulo y una ilustración
  let cabecera;
  if (banner) {
    cabecera = h("div", { class: `dlg-banner dlg-banner-${banner.tono ?? "azul"}` }, h("span", { class: "dlg-banner-emoji", "aria-hidden": "true" }, banner.emoji), h("div", { class: "dlg-banner-texto" }, h("h2", { class: "dlg-banner-titulo" }, titulo), banner.subtitulo && h("p", {}, banner.subtitulo)), banner.ilustracion && h("div", { class: "dlg-banner-ilustracion" }, banner.ilustracion), cerrarBoton);
    if (banner.imagen) cabecera.style.backgroundImage = `linear-gradient(120deg, rgb(11 23 48 / 0.88), rgb(29 78 216 / 0.55)), url("${banner.imagen}")`;
  } else {
    cabecera = h("div", { class: "modal-header" }, h("h2", { class: "modal-title fs-5" }, ic && icono(ic, "me-2"), titulo), cerrarBoton);
  }

  const dlg = h("dialog", { class: `dlg dlg-${ancho}${banner ? " dlg-con-banner" : ""}`, "aria-label": titulo }, h("div", { class: "modal-content" }, cabecera, cuerpoEl, pie && h("div", { class: "modal-footer" }, pie)));
  // El retiro del DOM no espera al evento `close` (que el navegador dispara después y solo con la página visible):
  // cerrar() lo hace en el acto y `terminado` evita repetirlo cuando el evento llega (Esc, cierre desde fuera).
  let terminado = false;
  const terminar = () => {
    if (terminado) return;
    terminado = true;
    dlg.remove();
    alCerrar?.();
  };
  const cerrar = () => {
    if (dlg.open) dlg.close();
    terminar();
  };
  dlg.addEventListener("close", terminar);
  dlg.addEventListener("mousedown", (ev) => ev.target === dlg && cerrar()); // clic en el fondo
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, cuerpo: cuerpoEl, avisos, cerrar };
}

/** Pregunta de sí o no. Devuelve una promesa con true o false (reemplaza al confirm() del navegador). */
export function confirmar({ titulo, mensaje, textoOk = "Confirmar", peligro = false, icono: ic = "question-circle" }) {
  return new Promise((resolver) => {
    let resuelto = false;
    const terminar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      resolver(valor);
      ventana.cerrar();
    };
    const ventana = dialogo({
      titulo,
      icono: ic,
      ancho: "sm",
      cuerpo: h("p", { class: "mb-0" }, mensaje),
      pie: [
        h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => terminar(false) }, "Cancelar"),
        h("button", { type: "button", class: `btn btn-${peligro ? "danger" : "primary"}`, onclick: () => terminar(true) }, textoOk),
      ],
      alCerrar: () => terminar(false),
    });
  });
}

/**
 * Encabezado de una pantalla: franja con degradado (o con foto), emoji, título, texto, ilustración y acciones.
 * `tono`: azul, verde, morado, naranja o rojo (los mismos de las ventanas). `foto`: ruta de una imagen de /img.
 */
export function cabeceraPagina({ emoji, titulo, texto, tono = "azul", foto, ilustracion: ilus, acciones }) {
  const el = h(
    "section",
    { class: `banner-pagina banner-${tono}` },
    h("span", { class: "banner-pagina-emoji", "aria-hidden": "true" }, emoji),
    h("div", { class: "banner-pagina-texto" }, h("h2", {}, titulo), texto && h("p", {}, texto)),
    ilus && h("div", { class: "banner-pagina-ilustracion", "aria-hidden": "true" }, ilus),
    acciones && h("div", { class: "banner-pagina-acciones" }, acciones),
  );
  if (foto) el.style.backgroundImage = `linear-gradient(105deg, rgb(7 17 40 / 0.93) 0%, rgb(13 44 110 / 0.72) 55%, rgb(29 78 216 / 0.35) 100%), url("${foto}")`;
  return el;
}

// ================= Tarjetas, gráficos y estados =================
export function tarjetaKpi({ icono: ic, etiqueta, valor, nota, color = "primary", alPulsar }) {
  return h(
    alPulsar ? "button" : "div",
    { type: alPulsar ? "button" : null, class: `kpi kpi-${color}${alPulsar ? " kpi-clic" : ""}`, onclick: alPulsar },
    h("span", { class: "kpi-icono" }, icono(ic)),
    h("div", { class: "kpi-cuerpo" }, h("div", { class: "kpi-valor" }, valor), h("div", { class: "kpi-etiqueta" }, etiqueta), nota && h("div", { class: "kpi-nota" }, nota)),
  );
}

/** Gráfico de anillo. datos: [{ etiqueta, valor, color: "var(--bs-success)" }] */
export function donut(datos, { tam = 150, grosor = 20 } = {}) {
  const total = datos.reduce((suma, d) => suma + d.valor, 0);
  const centro = tam / 2;
  const radio = (tam - grosor) / 2;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;

  const anillo = (color, largo, desfase, titulo) => {
    const arco = s("circle", { cx: centro, cy: centro, r: radio, fill: "none", "stroke-width": grosor, "stroke-dasharray": `${largo} ${circunferencia - largo}`, "stroke-dashoffset": -desfase, transform: `rotate(-90 ${centro} ${centro})` }, titulo && s("title", {}, titulo));
    arco.style.stroke = color;
    return arco;
  };

  const arcos =
    total === 0
      ? [anillo("var(--bs-secondary-bg)", circunferencia, 0)]
      : datos
          .filter((d) => d.valor > 0)
          .map((d) => {
            const largo = (d.valor / total) * circunferencia;
            const arco = anillo(d.color, largo, acumulado, `${d.etiqueta}: ${d.valor}`);
            acumulado += largo;
            return arco;
          });

  return s(
    "svg",
    { viewBox: `0 0 ${tam} ${tam}`, width: tam, height: tam, class: "donut", role: "img", "aria-label": datos.map((d) => `${d.etiqueta}: ${d.valor}`).join(", ") },
    ...arcos,
    s("text", { x: centro, y: centro, "text-anchor": "middle", "dominant-baseline": "central", class: "donut-total" }, String(total)),
  );
}

/** Barras horizontales. datos: [{ etiqueta, valor, color: "danger", titulo }] */
export function barras(datos, textoVacio = "Sin datos todavía") {
  if (datos.length === 0) return h("div", { class: "text-secondary small py-2" }, textoVacio);
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  return h(
    "div",
    { class: "barras" },
    datos.map((d) => {
      const relleno = h("span", { class: `barra-relleno bg-${d.color ?? "primary"}` });
      relleno.style.width = `${(d.valor / maximo) * 100}%`;
      return h("div", { class: "barra-fila" }, h("span", { class: "barra-etiqueta", title: d.titulo }, d.etiqueta), h("span", { class: "barra-pista" }, relleno), h("span", { class: "barra-valor" }, String(d.valor)));
    }),
  );
}

/** Panel con cabecera (título, ícono o emoji y acciones a la derecha) y cuerpo. */
export function tarjeta({ titulo, icono: ic, emoji, acciones, cuerpo, clase = "" }) {
  return h(
    "section",
    { class: `tarjeta${clase ? ` ${clase}` : ""}` },
    (titulo || acciones) && h("header", { class: "tarjeta-cabecera" }, h("h2", { class: "tarjeta-titulo" }, emoji ? h("span", { class: "emoji" }, emoji) : ic && icono(ic), titulo), acciones && h("div", { class: "tarjeta-acciones" }, acciones)),
    h("div", { class: "tarjeta-cuerpo" }, cuerpo),
  );
}

/**
 * Cuadro desplegable con borde, color y un resumen visible aunque esté cerrado (usa <details>: sin JavaScript de por
 * medio y accesible). Devuelve el elemento; `.resumen(texto)` cambia el texto del resumen. tono: primary, success,
 * warning, danger, info o secondary.
 */
export function seccion({ emoji, titulo, resumen, cuerpo, abierta = true, tono = "primary" }) {
  const textoResumen = h("span", { class: "seccion-resumen" }, resumen ?? "");
  const el = h(
    "details",
    { class: `seccion seccion-${tono}`, open: abierta },
    h("summary", {}, h("span", { class: "seccion-emoji" }, emoji), h("span", { class: "seccion-titulo" }, titulo), textoResumen, icono("chevron-down", "seccion-flecha")),
    h("div", { class: "seccion-cuerpo" }, cuerpo),
  );
  el.resumen = (texto) => (textoResumen.textContent = texto);
  return el;
}

/** Un campo de formulario: etiqueta con emoji, el control y una ayuda. `columnas`: clases de columna de Bootstrap. */
export function campo({ emoji, etiqueta, control, ayuda, columnas = "col-12", opcional = false }) {
  return h(
    "div",
    { class: columnas },
    h("label", { class: "campo-etiqueta", for: control.querySelector?.("input, select, textarea")?.id ?? control.id }, emoji && h("span", { class: "emoji" }, emoji), etiqueta, opcional && h("small", { class: "campo-opcional" }, "opcional")),
    control,
    ayuda && h("div", { class: "form-text" }, ayuda),
  );
}

/** Un control con un emoji pegado a la izquierda (grupo de entrada de Bootstrap). */
export const conEmoji = (emoji, control) => h("div", { class: "input-group campo-grupo" }, h("span", { class: "input-group-text emoji" }, emoji), control);

/** El nivel de confidencialidad o de seguridad como cinco barras de color y su nombre. */
const NOMBRE_NIVEL = { 1: "Público", 2: "Bajo", 3: "Medio", 4: "Alto", 5: "Máximo" };
export function medidorConfidencialidad(n, { pequeno = false } = {}) {
  return h(
    "div",
    { class: `medidor-conf nivel-${n}${pequeno ? " pequeno" : ""}`, title: `Nivel ${n} de 5` },
    h("div", { class: "medidor-barras" }, [1, 2, 3, 4, 5].map((i) => h("span", { class: i <= n ? "on" : "" }))),
    h("strong", {}, `Nivel ${n}`),
    h("small", {}, NOMBRE_NIVEL[n] ?? ""),
  );
}

export function vacio({ icono: ic = "inbox", titulo, texto, accion }) {
  return h("div", { class: "vacio" }, icono(ic, "vacio-icono"), h("h3", { class: "h6 mb-1" }, titulo), texto && h("p", { class: "text-secondary mb-2" }, texto), accion);
}

export const cargando = (texto = "Cargando…") => h("div", { class: "cargando" }, h("span", { class: "spinner-border spinner-border-sm", "aria-hidden": "true" }), h("span", {}, texto));

/** Filas de relleno mientras llega la tabla. */
export function esqueleto(filas = 5) {
  return h(
    "div",
    { class: "esqueleto placeholder-glow", "aria-busy": "true" },
    Array.from({ length: filas }, () => h("span", { class: "placeholder col-12 rounded" })),
  );
}

/** «‹ 1 … 4 5 6 … 12 ›». `ir(nuevaPagina)` se llama al pulsar. */
export function paginador(pagina, paginas, ir) {
  const item = (contenido, destino, { activo = false, desactivado = false, etiqueta } = {}) =>
    h(
      "li",
      { class: `page-item${activo ? " active" : ""}${desactivado ? " disabled" : ""}` },
      h("button", { type: "button", class: "page-link", "aria-label": etiqueta, "aria-current": activo ? "page" : null, disabled: desactivado, onclick: () => ir(destino) }, contenido),
    );

  const visibles = new Set([1, paginas, pagina - 1, pagina, pagina + 1].filter((p) => p >= 1 && p <= paginas));
  const numeros = [];
  let anterior = 0;
  for (const p of [...visibles].sort((a, b) => a - b)) {
    if (p - anterior > 1) numeros.push(h("li", { class: "page-item disabled" }, h("span", { class: "page-link" }, "…")));
    numeros.push(item(String(p), p, { activo: p === pagina, etiqueta: `Página ${p}` }));
    anterior = p;
  }

  return h(
    "nav",
    { "aria-label": "Paginación" },
    h("ul", { class: "pagination pagination-sm mb-0" }, item(icono("chevron-left"), pagina - 1, { desactivado: pagina <= 1, etiqueta: "Página anterior" }), numeros, item(icono("chevron-right"), pagina + 1, { desactivado: pagina >= paginas, etiqueta: "Página siguiente" })),
  );
}

// ================= Botones que conocen el rol =================
/**
 * Botón de una acción. Si tu rol no tiene el permiso se ve atenuado y con candado: es solo una pista, porque el
 * servidor decide. Con el «modo laboratorio» activo sigue siendo pulsable (así se ve la denegación); sin él, se oculta.
 */
export function botonAccion({ texto, icono: ic, permiso, variante = "outline-secondary", tam = "sm", alPulsar, soloIcono = false, titulo }) {
  const bloqueado = Boolean(permiso) && !puede(permiso);
  if (bloqueado && !estado.prefs.modoLab) return null;
  return h(
    "button",
    {
      type: "button",
      class: `btn btn-${variante} btn-${tam}${soloIcono ? " btn-icono" : ""}${bloqueado ? " bloqueado" : ""}`,
      title: bloqueado ? `Tu rol no tiene ${permiso}: el servidor lo denegará` : (titulo ?? texto),
      "aria-label": texto,
      onclick: alPulsar,
    },
    ic && icono(ic),
    !soloIcono && texto && h("span", {}, texto),
    bloqueado && !soloIcono && icono("lock-fill", "ms-1 small"),
  );
}

/** Elemento de un menú que conoce el rol (mismas reglas que botonAccion). Devuelve null si debe ocultarse. */
export function itemMenu({ texto, icono: ic, permiso, alPulsar, peligro }) {
  const bloqueado = Boolean(permiso) && !puede(permiso);
  if (bloqueado && !estado.prefs.modoLab) return null;
  return { texto, icono: ic, alPulsar, peligro, bloqueado, titulo: bloqueado ? `Tu rol no tiene ${permiso}: el servidor lo denegará` : undefined };
}
