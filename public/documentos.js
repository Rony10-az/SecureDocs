/**
 * Vista "Documentos": listar, subir, editar, enviar, aprobar o rechazar, descargar y eliminar.
 *
 * El frontend NO decide permisos: los botones dependen solo del ESTADO del documento y es el servidor quien
 * autoriza cada acción. Si la deniega, el aviso muestra por qué (etapa, política y motivo).
 */
import { descargarArchivo, llamar } from "./api.js";
import { avisar, avisarError, limpiarAviso } from "./avisos.js";
import { formatoFecha, formatoTamano, h, insignia, paginador } from "./dom.js";

const COLOR = { BORRADOR: "secondary", PENDIENTE: "warning", PUBLICADO: "success", RECHAZADO: "danger" };
const POR_PAGINA = 10;
const filtros = { q: "", estado: "", pagina: 1 }; // se conservan al ir y volver de otra pestaña
const $ = (id) => document.getElementById(id);

let recargar = async () => {}; // la define vistaDocumentos; las acciones y el formulario la usan
let editando = null; // documento que muestra el formulario (null = documento nuevo)

const boton = (texto, variante, alPulsar) => h("button", { type: "button", class: `btn btn-sm btn-${variante}`, onclick: alPulsar }, texto);

/** Ejecuta una acción sobre la API: si sale bien avisa y recarga; si el servidor la deniega, muestra por qué. */
async function hacer(mensaje, accion) {
  try {
    await accion();
    avisar("success", mensaje);
    await recargar();
  } catch (e) {
    avisarError(e);
  }
}

const decidir = (d, decision) =>
  hacer(`«${d.titulo}» ${decision === "APROBAR" ? "aprobado y publicado" : "rechazado"}.`, () =>
    llamar("POST", `/documentos/${d.id}/aprobar`, { json: { decision } }),
  );

const enviar = (d) =>
  hacer(`«${d.titulo}» enviado a aprobación.`, () => llamar("PUT", `/documentos/${d.id}`, { json: { enviar: true } }));

function eliminar(d) {
  if (!confirm(`¿Eliminar «${d.titulo}»? Pasa a la papelera (borrado lógico).`)) return;
  return hacer(`«${d.titulo}» eliminado.`, () => llamar("DELETE", `/documentos/${d.id}`));
}

async function descargar(d) {
  try {
    const { nombre, integro } = await descargarArchivo(d.id);
    if (integro === false) avisar("danger", `«${nombre}» se descargó, pero su SHA-256 NO coincide con el registrado.`);
    else avisar("success", `«${nombre}» descargado${integro ? " · integridad verificada (el SHA-256 coincide)" : ""}.`);
  } catch (e) {
    avisarError(e);
  }
}

async function verDetalle(id) {
  try {
    const d = await llamar("GET", `/documentos/${id}`);
    const a = d.archivo;
    const dato = (nombre, valor) => [h("dt", { class: "col-sm-4" }, nombre), h("dd", { class: "col-sm-8" }, valor ?? "—")];
    $("detalle-cuerpo").replaceChildren(
      h(
        "dl",
        { class: "row mb-0" },
        dato("Título", d.titulo),
        dato("Descripción", d.descripcion),
        dato("Departamento", d.departamento),
        dato("Nivel de confidencialidad", d.nivel_confidencialidad),
        dato("Estado", insignia(d.estado, COLOR[d.estado])),
        dato("País", d.pais),
        dato("Propietario", d.propietario?.nombre),
        dato("Creado", formatoFecha(d.fecha_creacion)),
        dato("Aprobado por", d.aprobado_por?.nombre),
        dato("Aprobado el", d.fecha_aprobacion ? formatoFecha(d.fecha_aprobacion) : null),
        dato("Archivo", a ? `${a.nombre} · ${a.mime} · ${formatoTamano(a.tamano)}` : "sin archivo"),
        dato("SHA-256", a ? h("code", { class: "hash" }, a.sha256) : null),
      ),
    );
    $("dlg-detalle").showModal();
  } catch (e) {
    avisarError(e);
  }
}

function abrirFormulario(d) {
  editando = d;
  const formulario = $("form-doc");
  formulario.reset();
  limpiarAviso($("dlg-doc-aviso"));
  $("dlg-doc-titulo").textContent = d ? "Editar documento" : "Subir documento";
  $("campos-clasificacion").hidden = Boolean(d); // nivel, departamento y país no cambian después de crear
  formulario.elements.titulo.value = d?.titulo ?? "";
  formulario.elements.descripcion.value = d?.descripcion ?? "";
  $("dlg-doc").showModal();
}

async function guardar(ev) {
  ev.preventDefault();
  const formulario = ev.currentTarget;
  const valor = (nombre) => formulario.elements[nombre].value.trim();

  // Se arma a mano (y no con new FormData(formulario)): solo viajan los campos con contenido
  const datos = new FormData();
  datos.append("titulo", valor("titulo"));
  if (editando) {
    datos.append("descripcion", valor("descripcion")); // vacío = quitar la descripción
  } else {
    datos.append("nivel_confidencialidad", valor("nivel_confidencialidad"));
    for (const campo of ["descripcion", "departamento", "pais"]) if (valor(campo)) datos.append(campo, valor(campo));
  }
  const archivo = formulario.elements.archivo.files[0];
  if (archivo) datos.append("archivo", archivo);
  if (formulario.elements.enviar.checked) datos.append("enviar", "true");

  const guardando = $("btn-guardar");
  guardando.disabled = true;
  try {
    const d = editando
      ? await llamar("PUT", `/documentos/${editando.id}`, { formulario: datos })
      : await llamar("POST", "/documentos", { formulario: datos });
    $("dlg-doc").close();
    avisar("success", `«${d.titulo}» guardado (${d.estado}).`);
    await recargar();
  } catch (e) {
    avisarError(e, $("dlg-doc-aviso")); // el error se ve dentro de la ventana, sin perder lo escrito
  } finally {
    guardando.disabled = false;
  }
}

/** Se llama una sola vez al arrancar: botones "cerrar" de las ventanas y envío del formulario. */
export function iniciarFormularios() {
  for (const cerrar of document.querySelectorAll("[data-cerrar]")) cerrar.addEventListener("click", () => cerrar.closest("dialog").close());
  $("form-doc").addEventListener("submit", guardar);
}

function fila(d) {
  return h(
    "tr",
    {},
    h("td", { class: "col-titulo" }, d.titulo),
    h("td", {}, d.departamento),
    h("td", {}, `Nivel ${d.nivel_confidencialidad}`),
    h("td", {}, insignia(d.estado, COLOR[d.estado])),
    h("td", {}, d.propietario?.nombre ?? "—"),
    h("td", { class: "text-nowrap" }, formatoFecha(d.fecha_creacion)),
    h(
      "td",
      {},
      h(
        "div",
        { class: "d-flex flex-wrap gap-1" },
        boton("Ver", "outline-secondary", () => verDetalle(d.id)),
        d.archivo && boton("Descargar", "outline-primary", () => descargar(d)),
        (d.estado === "BORRADOR" || d.estado === "RECHAZADO") && boton("Enviar", "outline-warning", () => enviar(d)),
        d.estado === "PENDIENTE" && boton("Aprobar", "success", () => decidir(d, "APROBAR")),
        d.estado === "PENDIENTE" && boton("Rechazar", "outline-danger", () => decidir(d, "RECHAZAR")),
        boton("Editar", "outline-secondary", () => abrirFormulario(d)),
        boton("Eliminar", "outline-danger", () => eliminar(d)),
      ),
    ),
  );
}

function pintar(tabla, pie, r) {
  const paginas = Math.max(1, Math.ceil(r.total / r.limite));
  tabla.replaceChildren(
    r.documentos.length === 0
      ? h("p", { class: "text-secondary" }, "No hay documentos que tu usuario pueda ver con estos filtros.")
      : h(
          "table",
          { class: "table table-sm table-hover align-middle bg-body" },
          h("thead", {}, h("tr", {}, ["Título", "Depto.", "Nivel", "Estado", "Propietario", "Creado", "Acciones"].map((t) => h("th", {}, t)))),
          h("tbody", {}, r.documentos.map(fila)),
        ),
  );
  pie.replaceChildren(
    h("span", { class: "text-secondary" }, `${r.total} documento(s) visibles para ti; las políticas ABAC ocultan el resto.`),
    paginador(r.pagina, paginas, (destino) => {
      filtros.pagina = destino;
      recargar();
    }),
  );
}

export async function vistaDocumentos(raiz) {
  const buscador = h("input", { type: "search", class: "form-control form-control-sm", placeholder: "Buscar por título", value: filtros.q, "aria-label": "Buscar por título" });
  const estados = h(
    "select",
    { class: "form-select form-select-sm", "aria-label": "Estado" },
    h("option", { value: "" }, "Todos los estados"),
    Object.keys(COLOR).map((e) => h("option", { value: e, selected: e === filtros.estado }, e)),
  );
  const tabla = h("div", { class: "table-responsive" });
  const pie = h("div", { class: "d-flex flex-wrap justify-content-between align-items-center gap-2 small" });

  recargar = async () => {
    filtros.q = buscador.value.trim();
    filtros.estado = estados.value;
    try {
      const r = await llamar("GET", "/documentos", { params: { ...filtros, limite: POR_PAGINA } });
      if (r.documentos.length === 0 && r.pagina > 1) {
        filtros.pagina = Math.max(1, Math.ceil(r.total / r.limite)); // se borró lo último de la página
        return recargar();
      }
      pintar(tabla, pie, r);
    } catch (e) {
      tabla.replaceChildren(); // no se deja a la vista nada que el servidor no haya autorizado
      pie.replaceChildren();
      avisarError(e);
    }
  };

  raiz.append(
    h("h1", { class: "h4 mb-3" }, "Documentos"),
    h(
      "form",
      {
        class: "row g-2 mb-3",
        onsubmit: (ev) => {
          ev.preventDefault();
          filtros.pagina = 1;
          recargar();
        },
      },
      h("div", { class: "col-12 col-md" }, buscador),
      h("div", { class: "col-6 col-md-auto" }, estados),
      h("div", { class: "col-auto" }, h("button", { class: "btn btn-sm btn-primary" }, "Buscar")),
      h("div", { class: "col-auto ms-md-auto" }, boton("＋ Subir documento", "success", () => abrirFormulario(null))),
    ),
    tabla,
    pie,
  );
  await recargar();
}
