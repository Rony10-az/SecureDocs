/**
 * Mi cuenta: tus atributos (los que las políticas leen), tus permisos, el estado de la sesión, el entorno tal como lo
 * ve el servidor y las preferencias de la interfaz.
 */
import { cargarPerfil, catalogos, estado, expiraEn, guardarPrefs, puede } from "../api.js";
import { faltan, formatoFecha, h } from "../dom.js";
import { ilustracion } from "../ilustraciones.js";
import { ICONO_TEMA, alternarTema, modoTema } from "../tema.js";
import { PERMISO_TEXTO, avatar, cabeceraPagina, chip, establecerTitulo, icono, insigniaEstadoUsuario, insigniaRol, tarjeta, toast } from "../ui.js";
import { abrirEntorno, resumenEntorno } from "./entorno.js";

const NOMBRE_TEMA = { auto: "Automático (el del sistema)", claro: "Claro", oscuro: "Oscuro" };

/** Datos de la carga útil del token (solo lectura: el servidor es quien lo valida). */
function cargaDelToken() {
  try {
    return JSON.parse(atob(estado.sesion.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

export async function cuenta(raiz) {
  establecerTitulo("Mi cuenta");
  const cat = await catalogos().catch(() => ({ permisos: Object.keys(PERMISO_TEXTO) }));
  const perfil = await cargarPerfil().catch(() => estado.perfil);
  const u = estado.sesion.usuario;
  const carga = cargaDelToken();
  const fila = (etiqueta, valor) => [h("dt", {}, etiqueta), h("dd", {}, valor)];

  // ---------- Perfil ----------
  const perfilTarjeta = tarjeta({
    titulo: "Perfil",
    icono: "person-badge",
    cuerpo: h(
      "div",
      {},
      h("div", { class: "perfil-cabecera" }, avatar(u.nombre, "lg"), h("div", {}, h("strong", { class: "d-block fs-5" }, u.nombre), h("span", { class: "text-secondary" }, u.correo), h("div", { class: "d-flex gap-2 mt-1" }, insigniaRol(u.rol), insigniaEstadoUsuario(u.estado)))),
      h("div", { class: "form-label mt-2 mb-2" }, "Atributos que leen las políticas"),
      h("dl", { class: "atributos" }, fila("Departamento", u.departamento), fila("Nivel de seguridad", `${u.nivel_seguridad} de 5`), fila("País", u.pais), fila("Contrato", u.tipo_contrato), fila("Vence el", u.fecha_expiracion ?? "no vence"), fila("Identificador", `#${u.id}`)),
    ),
  });

  // ---------- Sesión ----------
  const reloj = h("strong", { class: "reloj-sesion" });
  const pintarReloj = () => {
    const vence = expiraEn();
    reloj.textContent = vence ? faltan(vence - Date.now()) : "—";
  };
  pintarReloj();
  const intervalo = setInterval(pintarReloj, 1000);

  const sesionTarjeta = tarjeta({
    titulo: "Sesión",
    icono: "key",
    cuerpo: h(
      "div",
      {},
      h("div", { class: "sesion-vence" }, icono("hourglass-split"), h("div", {}, h("small", { class: "text-secondary d-block" }, "Tu sesión vence en"), reloj)),
      h("dl", { class: "atributos mt-3" }, fila("Vence el", expiraEn() ? formatoFecha(new Date(expiraEn()).toISOString()) : "—"), fila("Emisor", carga.iss ?? "—"), fila("Contenido del token", "solo el identificador del usuario (sub) y sus fechas: rol, estado y nivel se leen de la base de datos en cada petición")),
      h("div", { class: "d-flex flex-wrap gap-2 mt-3" }, h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => dispatchEvent(new HashChangeEvent("hashchange")) /* vuelve a entrar a la pantalla: relee todo del servidor */ }, icono("arrow-clockwise", "me-1"), "Actualizar"), h("button", { type: "button", class: "btn btn-outline-danger", onclick: () => document.dispatchEvent(new Event("cerrar-sesion")) }, icono("box-arrow-right", "me-1"), "Cerrar sesión")),
    ),
  });

  // ---------- Permisos ----------
  const permisosTarjeta = tarjeta({
    titulo: `Permisos de tu rol · ${estado.permisos.length} de ${cat.permisos.length}`,
    icono: "check2-square",
    cuerpo: h(
      "ul",
      { class: "lista-permisos" },
      cat.permisos.map((p) => h("li", { class: puede(p) ? "concedido" : "" }, icono(puede(p) ? "check-circle-fill" : "lock-fill"), h("div", {}, h("code", {}, p), h("small", { class: "d-block text-secondary" }, PERMISO_TEXTO[p] ?? "")))),
    ),
    acciones: h("small", { class: "text-secondary" }, "Además, las políticas ABAC deciden caso por caso"),
  });

  // ---------- Entorno ----------
  const entorno = perfil?.entorno;
  const entornoTarjeta = tarjeta({
    titulo: "Entorno",
    icono: "geo-alt",
    acciones: h("button", { type: "button", class: "btn btn-sm btn-link", onclick: abrirEntorno }, "Cambiar"),
    cuerpo: h(
      "div",
      {},
      h("div", { class: "form-label mb-2" }, "Lo que ve el servidor de tu última petición"),
      h("dl", { class: "atributos" }, fila("Hora", entorno?.hora ?? "—"), fila("Fecha", entorno?.fecha ?? "—"), fila("Ubicación", entorno?.ubicacion ?? "sin informar"), fila("Dispositivo", entorno?.dispositivo ?? "—"), fila("IP", entorno?.direccion_ip ?? "—")),
      h("div", { class: "form-label mt-3 mb-1" }, "Lo que esta pantalla envía (simulado)"),
      chip(resumenEntorno(), { icono: "send" }),
    ),
  });

  // ---------- Preferencias ----------
  const botonTema = h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => ((alternarTema(), pintarTema())) });
  const pintarTema = () => botonTema.replaceChildren(icono(ICONO_TEMA[modoTema()], "me-2"), NOMBRE_TEMA[modoTema()]);
  pintarTema();
  const modoLab = h("input", { id: "pref-lab", type: "checkbox", role: "switch", class: "form-check-input", checked: estado.prefs.modoLab, onchange: () => (guardarPrefs({ modoLab: modoLab.checked }), toast("info", modoLab.checked ? "Modo laboratorio activado." : "Modo laboratorio desactivado.")) });
  const vistas = h("div", { class: "segmentado" }, [["tabla", "list-ul", "Tabla"], ["tarjetas", "grid-3x3-gap", "Tarjetas"]].map(([valor, ic, texto]) => h("button", { type: "button", class: `segmento${estado.prefs.vistaDocumentos === valor ? " activo" : ""}`, onclick: (ev) => (guardarPrefs({ vistaDocumentos: valor }), ev.currentTarget.parentElement.querySelectorAll(".segmento").forEach((b) => b.classList.toggle("activo", b === ev.currentTarget))) }, icono(ic, "me-1"), texto)));
  const preferencias = tarjeta({
    titulo: "Preferencias",
    icono: "sliders",
    cuerpo: h(
      "div",
      { class: "d-grid gap-3" },
      h("div", {}, h("div", { class: "form-label" }, "Tema"), botonTema),
      h("div", { class: "form-check form-switch" }, modoLab, h("label", { class: "form-check-label", for: "pref-lab" }, "Modo laboratorio"), h("div", { class: "form-text" }, "Deja pulsables las acciones que tu rol no tiene, con un candado, para ver cómo las deniega el servidor. Apagado, se ocultan.")),
      h("div", {}, h("div", { class: "form-label" }, "Vista de documentos"), vistas),
    ),
  });

  raiz.append(
    cabeceraPagina({ emoji: "🙋", titulo: "Mi cuenta", texto: "Quién eres para el servidor y qué puedes hacer.", tono: "naranja", ilustracion: ilustracion("usuario", 84) }),
    h("div", { class: "row g-3" }, h("div", { class: "col-xl-6 d-grid gap-3 align-content-start" }, perfilTarjeta, sesionTarjeta, entornoTarjeta), h("div", { class: "col-xl-6 d-grid gap-3 align-content-start" }, permisosTarjeta, preferencias)),
  );
  return () => clearInterval(intervalo);
}
