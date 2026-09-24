/**
 * Reglas de acceso (AUDIT_READ): la matriz RBAC y las políticas ABAC tal como están hoy en la base de datos. Las
 * políticas son datos: se leen en cada decisión, sin caché, así que un cambio en la tabla `politica` rige desde la
 * siguiente petición.
 */
import { estado, reglas as pedirReglas } from "../api.js";
import { h } from "../dom.js";
import { ilustracion } from "../ilustraciones.js";
import { PERMISO_TEXTO, avisarError, cabeceraPagina, cargando, chip, establecerTitulo, icono, insigniaEtapa, insigniaRol, tarjeta, vacio } from "../ui.js";
import { atributosDe } from "../condicion.js";

const ACCIONES_DOC = ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE", "DOC_DOWNLOAD"];

function accionesDe(acciones) {
  if (acciones.includes("*")) return [chip("Todas las acciones", { color: "info" })];
  if (acciones.length === ACCIONES_DOC.length && ACCIONES_DOC.every((a) => acciones.includes(a))) return [chip("DOC_* · las 6 de documentos", { color: "info", titulo: ACCIONES_DOC.join(", ") })];
  return acciones.map((a) => chip(a, { color: "info", titulo: PERMISO_TEXTO[a] }));
}

const codigos = (politicas) => politicas.map((p) => chip(p.codigo, { color: p.activa ? "warning" : "secondary" }));

export async function reglas(raiz, { consulta = {} } = {}) {
  establecerTitulo("Reglas de acceso");
  raiz.replaceChildren(cargando("Leyendo las reglas…"));

  let datos;
  try {
    datos = await pedirReglas({ forzar: true });
  } catch (e) {
    raiz.replaceChildren(vacio({ icono: "shield-lock", titulo: "No se pudieron leer las reglas", texto: "Mira el aviso de arriba para saber por qué." }));
    return avisarError(e);
  }

  const { rbac, abac } = datos;
  const miRol = estado.sesion.usuario.rol;
  const estadoPoliticas = abac.filter((p) => p.etapa === "ESTADO");
  const atributos = abac.filter((p) => p.etapa === "ABAC");

  // ---------- Cómo se decide ----------
  const paso = (numero, titulo, texto, extra) => h("li", { class: "decision-paso" }, h("span", { class: "decision-numero" }, String(numero)), h("div", {}, h("strong", {}, titulo), h("p", {}, texto), extra));
  const decision = tarjeta({
    titulo: "Cómo se decide cada petición",
    icono: "signpost-split",
    cuerpo: h(
      "ol",
      { class: "decision" },
      paso(1, "Estado", "¿La cuenta está activa y su acceso sigue vigente? Se evalúa antes que los roles y sin cargar el recurso.", h("div", { class: "d-flex flex-wrap gap-1" }, codigos(estadoPoliticas))),
      paso(2, "RBAC", "¿El rol del usuario tiene el permiso de la acción? Los permisos salen de la tabla rol_permiso."),
      paso(3, "ABAC", "¿Se cumplen todas las políticas de atributos que aplican a la acción? Se evalúan por orden y la primera que falla decide.", h("div", { class: "d-flex flex-wrap gap-1" }, codigos(atributos))),
      paso(4, "Auditoría", "La decisión, sea cual sea, queda registrada antes de responder. Si no se puede registrar, la petición falla."),
    ),
  });

  // ---------- Matriz RBAC ----------
  const matriz = tarjeta({
    titulo: "Matriz de roles y permisos (RBAC)",
    icono: "grid-3x3",
    cuerpo: h(
      "div",
      { class: "tabla-contenedor sin-borde" },
      h(
        "table",
        { class: "table matriz mb-0" },
        h("thead", {}, h("tr", {}, h("th", {}, "Permiso"), rbac.roles.map((r) => h("th", { class: `text-center${r.nombre === miRol ? " col-actual" : ""}` }, insigniaRol(r.nombre), r.nombre === miRol && h("small", { class: "d-block text-secondary" }, "tu rol"))))),
        h(
          "tbody",
          {},
          rbac.permisos.map((permiso) => h("tr", {}, h("th", { scope: "row" }, h("code", {}, permiso), h("small", { class: "d-block text-secondary fw-normal" }, PERMISO_TEXTO[permiso] ?? "")), rbac.roles.map((r) => h("td", { class: `text-center${r.nombre === miRol ? " col-actual" : ""}` }, r.permisos.includes(permiso) ? h("span", { class: "matriz-si", title: `${r.nombre} tiene ${permiso}` }, icono("check-lg")) : h("span", { class: "matriz-no", title: `${r.nombre} no tiene ${permiso}` }, icono("dash")))))),
          h("tr", { class: "matriz-total" }, h("th", { scope: "row" }, "Total"), rbac.roles.map((r) => h("td", { class: `text-center${r.nombre === miRol ? " col-actual" : ""}` }, String(r.permisos.length)))),
        ),
      ),
    ),
  });

  // ---------- Políticas ABAC ----------
  const buscador = h("input", { type: "search", class: "form-control form-control-sm", placeholder: "Buscar política, acción o atributo…", "aria-label": "Buscar políticas" });
  const detalles = abac.map((p) => {
    const resaltada = consulta.codigo === p.codigo;
    const usados = [...atributosDe(p.condicion)];
    return h(
      "details",
      { class: `politica${resaltada ? " resaltada" : ""}${p.activa ? "" : " inactiva"}`, id: `politica-${p.codigo}`, open: resaltada, "data-busqueda": `${p.codigo} ${p.nombre} ${p.acciones.join(" ")} ${usados.join(" ")}`.toLowerCase() },
      h("summary", {}, h("span", { class: "politica-codigo" }, p.codigo), h("span", { class: "politica-nombre" }, p.nombre), insigniaEtapa(p.etapa), chip(`orden ${p.orden}`), !p.activa && chip("inactiva", { color: "danger" }), icono("chevron-down", "ms-auto politica-flecha")),
      h(
        "div",
        { class: "politica-cuerpo" },
        p.descripcion && h("p", {}, p.descripcion),
        h("dl", { class: "atributos" }, h("dt", {}, "Actúa sobre"), h("dd", { class: "d-flex flex-wrap gap-1" }, accionesDe(p.acciones)), h("dt", {}, "Exceptúa a"), h("dd", { class: "d-flex flex-wrap gap-1" }, p.roles_exceptuados.length > 0 ? p.roles_exceptuados.map((r) => insigniaRol(r)) : h("span", { class: "text-secondary" }, "nadie")), h("dt", {}, "Si falla"), h("dd", {}, p.motivo_denegacion), h("dt", {}, "Compara"), h("dd", { class: "d-flex flex-wrap gap-1" }, usados.map((a) => h("code", { class: "atributo" }, a)))),
        h("div", { class: "form-label mb-1" }, "Condición (JSONB)"),
        h("pre", { class: "codigo-json" }, h("code", {}, JSON.stringify(p.condicion, null, 2))),
      ),
    );
  });
  buscador.addEventListener("input", () => {
    const texto = buscador.value.trim().toLowerCase();
    detalles.forEach((d) => (d.hidden = texto !== "" && !d.dataset.busqueda.includes(texto)));
  });

  const politicas = tarjeta({
    titulo: `Políticas de atributos (ABAC) · ${abac.length}`,
    icono: "diagram-3",
    acciones: buscador,
    cuerpo: h("div", { class: "politicas" }, h("p", { class: "text-secondary small" }, "Van en el orden en que se evalúan: primero la etapa ESTADO y luego ABAC, cada una por «orden»."), detalles),
  });

  raiz.replaceChildren(
    cabeceraPagina({
      emoji: "🧭",
      titulo: "Reglas de acceso",
      texto: "Lo que hay hoy en la base de datos. Cambiar una política es un INSERT o UPDATE en la tabla politica: rige desde la siguiente petición.",
      tono: "verde",
      ilustracion: ilustracion("escudo", 84),
      acciones: h("button", { type: "button", class: "btn btn-outline-light", onclick: () => reglas(raiz, { consulta }) }, icono("arrow-clockwise", "me-1"), "Releer"),
    }),
    h("div", { class: "d-grid gap-3" }, decision, matriz, politicas),
  );

  const resaltada = raiz.querySelector(".politica.resaltada");
  if (resaltada) setTimeout(() => resaltada.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
}
