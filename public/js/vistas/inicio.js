/**
 * Panel de inicio: qué hay para ti según tus permisos y las políticas de acceso. Con una sola consulta de documentos
 * (los 100 más recientes que puedes leer) calcula los totales; si tu rol puede consultar la auditoría, suma los últimos
 * 50 eventos para ver la actividad y las denegaciones por política.
 */
import { catalogos, estado, llamar, puede, salud } from "../api.js";
import { h, hace } from "../dom.js";
import {
  ACCION,
  ESTADO_DOC,
  PERMISO_TEXTO,
  avatar,
  avisarError,
  barras,
  botonAccion,
  cabeceraPagina,
  cargando,
  chip,
  donut,
  establecerTitulo,
  icono,
  iconoArchivo,
  insigniaEstado,
  insigniaEstadoUsuario,
  insigniaNivel,
  insigniaRol,
  tarjeta,
  tarjetaKpi,
  vacio,
} from "../ui.js";
import { decidir } from "./acciones-documento.js";
import { abrirFormularioDocumento } from "./formulario-documento.js";
import { abrirEntorno } from "./entorno.js";

const ir = (hash) => {
  location.hash = hash;
};

export async function inicio(raiz) {
  establecerTitulo("Inicio");
  raiz.replaceChildren(cargando("Preparando tu panel…"));

  const [docs, auditoria, sistema, cat] = await Promise.allSettled([
    llamar("GET", "/documentos", { params: { limite: 100 } }),
    puede("AUDIT_READ") ? llamar("GET", "/auditoria", { params: { limite: 50 } }) : Promise.resolve(null),
    salud(),
    catalogos(),
  ]);
  if (docs.status === "rejected") avisarError(docs.reason);
  if (auditoria.status === "rejected") avisarError(auditoria.reason);

  raiz.replaceChildren(
    ...panel({
      docs: docs.status === "fulfilled" ? docs.value : null,
      auditoria: auditoria.status === "fulfilled" ? auditoria.value : null,
      sistema: sistema.status === "fulfilled" ? sistema.value : { ok: false, ms: null },
      permisosDelSistema: cat.status === "fulfilled" ? cat.value.permisos : Object.keys(PERMISO_TEXTO),
      recargar: () => inicio(raiz),
    }),
  );
}

function panel({ docs, auditoria, sistema, permisosDelSistema, recargar }) {
  const u = estado.sesion.usuario;
  const lista = docs?.documentos ?? [];
  const contar = (e) => lista.filter((d) => d.estado === e).length;
  const truncada = docs && docs.total > lista.length;

  // ---------- Encabezado y KPIs ----------
  const saludo = cabeceraPagina({
    emoji: "👋",
    titulo: `Hola, ${u.nombre.split(" ")[0]}`,
    texto: "Esto es lo que tus permisos y las políticas de acceso te dejan ver.",
    foto: "/img/login-fondo.jpg",
    acciones: botonAccion({ texto: "Subir documento", icono: "cloud-arrow-up", permiso: "DOC_CREATE", variante: "light", tam: "md", alPulsar: () => abrirFormularioDocumento({ alGuardar: recargar }) }),
  });

  const kpis = [
    tarjetaKpi({ icono: "folder2-open", etiqueta: "Documentos visibles", valor: docs ? docs.total : "—", nota: "los que tus políticas te dejan leer", color: "primary", alPulsar: () => ir("#/documentos") }),
    tarjetaKpi({ icono: "hourglass-split", etiqueta: "Pendientes de aprobación", valor: docs ? contar("PENDIENTE") : "—", nota: truncada ? "entre los 100 más recientes" : undefined, color: "warning", alPulsar: () => ir("#/documentos?estado=PENDIENTE") }),
    tarjetaKpi({ icono: "check-circle", etiqueta: "Publicados", valor: docs ? contar("PUBLICADO") : "—", color: "success", alPulsar: () => ir("#/documentos?estado=PUBLICADO") }),
    tarjetaKpi({ icono: "person-workspace", etiqueta: "Creados por ti", valor: docs ? lista.filter((d) => d.propietario?.id === u.id).length : "—", color: "info" }),
  ];
  if (auditoria) {
    const denegados = auditoria.registros.filter((r) => r.resultado === "DENEGADO").length;
    kpis.push(tarjetaKpi({ icono: "shield-exclamation", etiqueta: "Denegaciones recientes", valor: denegados, nota: `de los últimos ${auditoria.registros.length} eventos`, color: "danger", alPulsar: () => ir("#/auditoria") }));
  }

  // ---------- Documentos por estado ----------
  const datosEstado = Object.entries(ESTADO_DOC).map(([clave, v]) => ({ clave, etiqueta: v.texto, valor: contar(clave), color: `var(--bs-${v.color})` }));
  const porEstado = tarjeta({
    titulo: "Documentos por estado",
    icono: "pie-chart",
    cuerpo: docs
      ? h(
          "div",
          { class: "estado-grafico" },
          donut(datosEstado),
          h(
            "ul",
            { class: "leyenda" },
            datosEstado.map((d) => {
              const punto = h("span", { class: "leyenda-punto" });
              punto.style.backgroundColor = d.color;
              return h("li", {}, h("button", { type: "button", class: "leyenda-item", onclick: () => ir(`#/documentos?estado=${d.clave}`) }, punto, h("span", {}, d.etiqueta), h("strong", {}, String(d.valor))));
            }),
          ),
          truncada && h("p", { class: "text-secondary small mb-0 w-100" }, `Calculado con los ${lista.length} más recientes de ${docs.total}.`),
        )
      : vacio({ icono: "lock", titulo: "Sin datos", texto: "El servidor no te dejó consultar los documentos." }),
  });

  // ---------- Pendientes de aprobación ----------
  const pendientes = lista.filter((d) => d.estado === "PENDIENTE").slice(0, 5);
  const porAprobar = tarjeta({
    titulo: "Pendientes de aprobación",
    icono: "hourglass-split",
    acciones: h("a", { class: "btn btn-sm btn-link", href: "#/documentos?estado=PENDIENTE" }, "Ver todos"),
    cuerpo:
      pendientes.length === 0
        ? vacio({ icono: "check2-all", titulo: "Nada pendiente", texto: "No hay documentos esperando una decisión." })
        : h(
            "ul",
            { class: "lista-docs" },
            pendientes.map((d) =>
              h(
                "li",
                { class: "lista-doc" },
                icono(iconoArchivo(d.archivo?.mime), "lista-doc-icono"),
                h("a", { class: "lista-doc-cuerpo", href: `#/documentos/${d.id}` }, h("strong", {}, d.titulo), h("small", {}, `${d.propietario?.nombre ?? "—"} · ${hace(d.fecha_creacion)}`, d.propietario?.id === u.id && " · tuyo")),
                h(
                  "div",
                  { class: "lista-doc-acciones" },
                  botonAccion({ texto: "Aprobar", icono: "check-lg", permiso: "DOC_APPROVE", variante: "success", alPulsar: async () => (await decidir(d, "APROBAR")) && recargar() }),
                  botonAccion({ texto: "Rechazar", icono: "x-lg", permiso: "DOC_APPROVE", variante: "outline-danger", alPulsar: async () => (await decidir(d, "RECHAZAR")) && recargar() }),
                ),
              ),
            ),
          ),
  });

  // ---------- Recientes ----------
  const recientes = tarjeta({
    titulo: "Documentos recientes",
    icono: "clock-history",
    acciones: h("a", { class: "btn btn-sm btn-link", href: "#/documentos" }, "Ver todos"),
    cuerpo:
      lista.length === 0
        ? vacio({ icono: "folder", titulo: "Sin documentos visibles", texto: "Todavía no hay nada que tus políticas te dejen leer." })
        : h(
            "ul",
            { class: "lista-docs" },
            lista.slice(0, 6).map((d) =>
              h(
                "li",
                { class: "lista-doc" },
                icono(iconoArchivo(d.archivo?.mime), "lista-doc-icono"),
                h("a", { class: "lista-doc-cuerpo", href: `#/documentos/${d.id}` }, h("strong", {}, d.titulo), h("small", {}, `${d.departamento} · ${hace(d.fecha_creacion)}`)),
                h("div", { class: "lista-doc-acciones" }, insigniaNivel(d.nivel_confidencialidad), insigniaEstado(d.estado)),
              ),
            ),
          ),
  });

  // ---------- Tu acceso ----------
  const fila = (etiqueta, valor) => [h("dt", {}, etiqueta), h("dd", {}, valor)];
  const acceso = tarjeta({
    titulo: "Tu acceso",
    icono: "person-badge",
    acciones: h("a", { class: "btn btn-sm btn-link", href: "#/cuenta" }, "Mi cuenta"),
    cuerpo: h(
      "div",
      {},
      h("div", { class: "perfil-cabecera" }, avatar(u.nombre, "lg"), h("div", {}, h("strong", { class: "d-block" }, u.nombre), h("span", { class: "text-secondary small" }, u.correo))),
      h("dl", { class: "atributos" }, fila("Rol", insigniaRol(u.rol)), fila("Departamento", u.departamento), fila("Nivel de seguridad", `${u.nivel_seguridad} de 5`), fila("País", u.pais), fila("Contrato", u.tipo_contrato + (u.fecha_expiracion ? ` · vence ${u.fecha_expiracion}` : "")), fila("Estado", insigniaEstadoUsuario(u.estado))),
      h("div", { class: "form-label mb-2 mt-3" }, "Permisos de tu rol"),
      h("div", { class: "permisos" }, permisosDelSistema.map((p) => chip(p, { color: puede(p) ? "success" : "secondary", icono: puede(p) ? "check-lg" : "lock-fill", titulo: `${PERMISO_TEXTO[p] ?? p}${puede(p) ? "" : " · tu rol no lo tiene"}` }))),
    ),
  });

  // ---------- Actividad (solo con AUDIT_READ) ----------
  let actividad;
  if (auditoria) {
    const conteo = new Map();
    for (const r of auditoria.registros) {
      if (r.resultado !== "DENEGADO") continue;
      const clave = r.politica_codigo ?? `${r.etapa} (rol)`;
      conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    }
    actividad = tarjeta({
      titulo: "Actividad reciente",
      icono: "activity",
      acciones: h("a", { class: "btn btn-sm btn-link", href: "#/auditoria" }, "Auditoría"),
      cuerpo: h(
        "div",
        {},
        h(
          "ul",
          { class: "actividad" },
          auditoria.registros.slice(0, 7).map((r) =>
            h(
              "li",
              { class: "actividad-item" },
              h("span", { class: `actividad-punto ${r.resultado === "PERMITIDO" ? "ok" : "mal"}` }, icono(ACCION[r.accion]?.[1] ?? "dot")),
              h("div", {}, h("div", {}, h("strong", {}, ACCION[r.accion]?.[0] ?? r.accion), " ", h("span", { class: "text-secondary" }, r.recurso)), h("small", { class: "text-secondary" }, `${r.usuario_correo ?? "—"} · ${hace(r.fecha)}${r.resultado === "DENEGADO" ? ` · ${r.politica_codigo ?? r.etapa}` : ""}`)),
            ),
          ),
        ),
        h("div", { class: "form-label mt-3 mb-2" }, `Denegaciones por política (últimos ${auditoria.registros.length} eventos)`),
        barras([...conteo].sort((a, b) => b[1] - a[1]).map(([clave, valor]) => ({ etiqueta: clave, valor, color: "danger" })), "No hubo denegaciones."),
      ),
    });
  } else {
    actividad = tarjeta({ titulo: "Actividad reciente", icono: "activity", cuerpo: vacio({ icono: "lock", titulo: "Solo para quien audita", texto: "Tu rol no tiene AUDIT_READ, así que no puede consultar la auditoría." }) });
  }

  // ---------- Entorno y sistema ----------
  const entornoServidor = estado.perfil?.entorno;
  const entorno = tarjeta({
    titulo: "Entorno que ve el servidor",
    icono: "geo-alt",
    acciones: h("button", { type: "button", class: "btn btn-sm btn-link", onclick: abrirEntorno }, "Cambiar"),
    cuerpo: h("dl", { class: "atributos" }, fila("Hora", entornoServidor?.hora ?? "—"), fila("Ubicación", entornoServidor?.ubicacion ?? "sin informar"), fila("Dispositivo", entornoServidor?.dispositivo ?? "—"), fila("IP", entornoServidor?.direccion_ip ?? "—")),
  });
  const estadoSistema = tarjeta({
    titulo: "Sistema",
    icono: "hdd-network",
    cuerpo: h("div", { class: "sistema" }, chip(sistema.ok ? "API y base de datos en línea" : "Sin respuesta", { color: sistema.ok ? "success" : "danger", icono: sistema.ok ? "check-circle" : "x-circle" }), sistema.ms != null && h("small", { class: "text-secondary" }, `${sistema.ms} ms`)),
  });

  return [
    saludo,
    h("div", { class: "kpis" }, kpis),
    h("div", { class: "row g-3 mt-1" }, h("div", { class: "col-xl-7 d-grid gap-3 align-content-start" }, porEstado, porAprobar, recientes), h("div", { class: "col-xl-5 d-grid gap-3 align-content-start" }, acceso, actividad, entorno, estadoSistema)),
  ];
}
