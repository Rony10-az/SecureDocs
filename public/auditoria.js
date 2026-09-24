/**
 * Vista "Auditoría": quién hizo qué, con qué resultado y por qué (etapa, política y motivo).
 *
 * Paginación con "foto": consultar la auditoría también deja una fila nueva en la auditoría, y sin más las
 * páginas se irían desplazando (la 2 repetiría el último registro de la 1). Por eso la primera página toma
 * la fecha de su registro más reciente y las siguientes piden solo lo anterior o igual a esa fecha (`hasta`).
 */
import { llamar } from "./api.js";
import { avisarError } from "./avisos.js";
import { formatoFecha, h, insignia, paginador } from "./dom.js";

const POR_PAGINA = 15;
const ETAPAS = ["AUTENTICACION", "ESTADO", "RBAC", "ABAC", "COMPLETA"];
const filtros = { usuario: "", accion: "", resultado: "", etapa: "", pagina: 1, hasta: "" };

const selector = (etiqueta, opciones, actual) =>
  h(
    "select",
    { class: "form-select form-select-sm", "aria-label": etiqueta },
    h("option", { value: "" }, `${etiqueta}: todos`),
    opciones.map((o) => h("option", { value: o, selected: o === actual }, o)),
  );

function fila(a) {
  return h(
    "tr",
    {},
    h("td", { class: "text-nowrap" }, formatoFecha(a.fecha)),
    h("td", {}, a.usuario_correo ?? "—"),
    h("td", {}, h("code", {}, a.accion)),
    h("td", {}, a.recurso),
    h("td", {}, insignia(a.resultado, a.resultado === "PERMITIDO" ? "success" : "danger")),
    h("td", {}, a.etapa),
    h("td", {}, a.politica_codigo ?? "—"),
    h("td", { class: "txt-motivo" }, a.motivo),
    h("td", { class: "text-nowrap" }, [a.ip, a.ubicacion, a.dispositivo].filter(Boolean).join(" · ") || "—"),
  );
}

function pintar(zona, r, cargar) {
  const paginas = Math.max(1, Math.ceil(r.total / r.limite));
  zona.replaceChildren(
    h(
      "div",
      { class: "small text-secondary mb-2" },
      `${r.total} registro(s). Vista fija hasta ${filtros.hasta ? formatoFecha(filtros.hasta) : "ahora"}: los registros nuevos, incluida esta consulta, no desplazan las páginas. «Consultar» toma una foto nueva.`,
    ),
    r.registros.length === 0
      ? h("p", { class: "text-secondary" }, "Sin registros con estos filtros.")
      : h(
          "div",
          { class: "table-responsive" },
          h(
            "table",
            { class: "table table-sm table-hover align-middle bg-body tabla-auditoria" },
            h("thead", {}, h("tr", {}, ["Fecha", "Usuario", "Acción", "Recurso", "Resultado", "Etapa", "Política", "Motivo", "Entorno"].map((t) => h("th", {}, t)))),
            h("tbody", {}, r.registros.map(fila)),
          ),
        ),
    h(
      "div",
      { class: "d-flex justify-content-end" },
      paginador(r.pagina, paginas, (destino) => {
        filtros.pagina = destino;
        cargar();
      }),
    ),
  );
}

export async function vistaAuditoria(raiz) {
  Object.assign(filtros, { pagina: 1, hasta: "" }); // entrar a la pestaña = foto nueva

  const usuario = h("input", { class: "form-control form-control-sm", placeholder: "Correo (contiene)", value: filtros.usuario, "aria-label": "Usuario" });
  const accion = h("input", { class: "form-control form-control-sm", placeholder: "Acción (p. ej. DOC_READ)", value: filtros.accion, "aria-label": "Acción" });
  const resultado = selector("Resultado", ["PERMITIDO", "DENEGADO"], filtros.resultado);
  const etapa = selector("Etapa", ETAPAS, filtros.etapa);
  const zona = h("div", {});

  const cargar = async (nueva = false) => {
    if (nueva) {
      Object.assign(filtros, { usuario: usuario.value.trim(), accion: accion.value.trim(), resultado: resultado.value, etapa: etapa.value, pagina: 1, hasta: "" });
    }
    try {
      const r = await llamar("GET", "/auditoria", { params: { ...filtros, limite: POR_PAGINA } });
      if (!filtros.hasta && r.registros.length > 0) filtros.hasta = r.registros[0].fecha; // fija la foto
      pintar(zona, r, cargar);
    } catch (e) {
      zona.replaceChildren();
      avisarError(e);
    }
  };

  raiz.append(
    h("h1", { class: "h4 mb-3" }, "Auditoría"),
    h(
      "form",
      {
        class: "row g-2 mb-3",
        onsubmit: (ev) => {
          ev.preventDefault();
          cargar(true);
        },
      },
      h("div", { class: "col-12 col-md" }, usuario),
      h("div", { class: "col-6 col-md" }, accion),
      h("div", { class: "col-6 col-md-auto" }, resultado),
      h("div", { class: "col-6 col-md-auto" }, etapa),
      h("div", { class: "col-auto" }, h("button", { class: "btn btn-sm btn-primary" }, "Consultar")),
    ),
    zona,
  );
  await cargar();
}
