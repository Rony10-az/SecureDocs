/**
 * Punto de entrada: armazón (barra lateral y superior), enrutador por #/ruta y ciclo de la sesión.
 * Las pantallas viven en js/vistas/. Aquí no hay reglas de acceso: el servidor decide cada acción.
 */
import { cargarPerfil, estado, expiraEn, guardarPrefs, guardarSesion, puede, salud } from "./api.js";
import { faltan, h } from "./dom.js";
import { ICONO_TEMA, alternarTema, iniciarTema, modoTema } from "./tema.js";
import { abrirMenu, avatar, avisar, icono, insigniaRol, limpiarAvisos, toast } from "./ui.js";
import { auditoria } from "./vistas/auditoria.js";
import { cuenta } from "./vistas/cuenta.js";
import { documento } from "./vistas/documento.js";
import { documentos } from "./vistas/documentos.js";
import { abrirEntorno, resumenEntorno } from "./vistas/entorno.js";
import { inicio } from "./vistas/inicio.js";
import { login } from "./vistas/login.js";
import { reglas } from "./vistas/reglas.js";
import { usuarios } from "./vistas/usuarios.js";

const $ = (id) => document.getElementById(id);

/** Secciones del menú lateral. `permiso`: el que necesita el rol (solo como pista: decide el servidor). */
const MENU = [
  { ruta: "inicio", texto: "Inicio", icono: "speedometer2" },
  { ruta: "documentos", texto: "Documentos", icono: "folder2-open", permiso: "DOC_READ" },
  { ruta: "usuarios", texto: "Usuarios", icono: "people", permiso: "USER_MANAGE" },
  { ruta: "auditoria", texto: "Auditoría", icono: "journal-check", permiso: "AUDIT_READ" },
  { ruta: "reglas", texto: "Reglas de acceso", icono: "shield-lock", permiso: "AUDIT_READ" },
  { ruta: "cuenta", texto: "Mi cuenta", icono: "person-circle" },
];

const RUTAS = [
  { patron: /^inicio$/, vista: inicio, menu: "inicio" },
  { patron: /^documentos$/, vista: documentos, menu: "documentos" },
  { patron: /^documentos\/(\d+)$/, vista: documento, menu: "documentos" },
  { patron: /^usuarios$/, vista: usuarios, menu: "usuarios" },
  { patron: /^auditoria$/, vista: auditoria, menu: "auditoria" },
  { patron: /^reglas$/, vista: reglas, menu: "reglas" },
  { patron: /^cuenta$/, vista: cuenta, menu: "cuenta" },
];

function leerHash() {
  const [ruta, consulta = ""] = location.hash.replace(/^#\/?/, "").split("?");
  return { ruta: ruta || "inicio", consulta: Object.fromEntries(new URLSearchParams(consulta)) };
}

// ================= Armazón =================
function pintarMenu() {
  const visibles = MENU.filter((m) => !m.permiso || puede(m.permiso) || estado.prefs.modoLab);
  $("menu").replaceChildren(
    ...visibles.map((m) => {
      const bloqueado = m.permiso && !puede(m.permiso);
      return h("a", { class: `lateral-enlace${bloqueado ? " bloqueado" : ""}`, href: `#/${m.ruta}`, "data-menu": m.ruta, title: bloqueado ? `Tu rol no tiene ${m.permiso}: el servidor lo denegará` : undefined }, icono(m.icono), h("span", {}, m.texto), bloqueado && icono("lock-fill", "ms-auto small"));
    }),
  );
}

function pintarBarra() {
  const u = estado.sesion?.usuario;
  $("btn-entorno").replaceChildren(icono("geo-alt"), h("span", {}, resumenEntorno()));
  $("btn-tema").replaceChildren(icono(ICONO_TEMA[modoTema()]));
  $("btn-tema").title = `Tema: ${modoTema()}`;
  if (u) $("btn-usuario").replaceChildren(avatar(u.nombre, "sm"), h("span", { class: "usuario-datos" }, h("strong", {}, u.nombre), insigniaRol(u.rol)), icono("chevron-down", "small"));
}

const marcarMenu = (nombre) => document.querySelectorAll("[data-menu]").forEach((a) => a.classList.toggle("activo", a.dataset.menu === nombre));
const cerrarLateral = () => document.body.classList.remove("lateral-abierto");

// ================= Enrutador =================
let limpiarVista = null;
let navegacion = 0;

async function enrutar() {
  const turno = ++navegacion;
  limpiarVista?.();
  limpiarVista = null;
  cerrarLateral();
  limpiarAvisos();
  const raiz = $("vista");
  raiz.replaceChildren();

  if (!estado.sesion) {
    $("app").classList.add("sin-sesion");
    return login(raiz, entrar);
  }
  $("app").classList.remove("sin-sesion");
  pintarMenu();
  pintarBarra();

  const { ruta, consulta } = leerHash();
  const coincidencia = RUTAS.map((r) => [r, r.patron.exec(ruta)]).find(([, m]) => m);
  if (!coincidencia) {
    history.replaceState(null, "", "#/inicio");
    return enrutar();
  }
  const [definicion, partes] = coincidencia;
  marcarMenu(definicion.menu);

  const limpiar = await definicion.vista(raiz, { id: partes[1] ? Number(partes[1]) : undefined, consulta });
  if (turno === navegacion) limpiarVista = limpiar ?? null;
  else limpiar?.(); // el usuario ya se fue a otra pantalla
}

// ================= Sesión =================
let temporizadores = [];

async function actualizarSalud() {
  const respuesta = await salud();
  $("salud").replaceChildren(h("span", { class: `punto ${respuesta.ok ? "ok" : "mal"}` }), h("span", {}, respuesta.ok ? "API en línea" : "Sin conexión"));
  $("salud").title = respuesta.ms != null ? `Respondió en ${respuesta.ms} ms` : "Sin respuesta";
}

function iniciarRelojes() {
  detenerRelojes();
  let avisado = false;
  temporizadores.push(
    setInterval(() => {
      const vence = expiraEn();
      if (!vence) return;
      const resta = vence - Date.now();
      if (resta <= 0) return document.dispatchEvent(new Event("sesion-invalida"));
      if (resta < 120_000 && !avisado) {
        avisado = true;
        toast("warning", `Tu sesión vence en ${faltan(resta)}. Guarda lo que estés haciendo.`, "Sesión por vencer");
      }
    }, 15_000),
  );
  actualizarSalud();
  temporizadores.push(setInterval(actualizarSalud, 30_000));
}

function detenerRelojes() {
  temporizadores.forEach(clearInterval);
  temporizadores = [];
}

async function entrar({ token, usuario }) {
  guardarSesion({ token, usuario });
  await cargarPerfil();
  iniciarRelojes();
  if (!location.hash || location.hash === "#/") history.replaceState(null, "", "#/inicio");
  await enrutar();
}

function cerrarSesion(mensaje) {
  detenerRelojes();
  document.querySelectorAll("dialog[open]").forEach((ventana) => ventana.close());
  guardarSesion(null);
  history.replaceState(null, "", "#/");
  enrutar().then(() => mensaje && avisar("warning", mensaje));
}

function menuUsuario(ancla) {
  const u = estado.sesion.usuario;
  abrirMenu(ancla, [
    { encabezado: u.correo },
    { texto: "Mi cuenta", icono: "person-circle", alPulsar: () => (location.hash = "#/cuenta") },
    {
      texto: estado.prefs.modoLab ? "Ocultar acciones sin permiso" : "Mostrar todas las acciones",
      icono: estado.prefs.modoLab ? "eye-slash" : "eye",
      titulo: "Modo laboratorio: deja pulsables las acciones que tu rol no tiene, para ver cómo las deniega el servidor",
      alPulsar: () => (guardarPrefs({ modoLab: !estado.prefs.modoLab }), enrutar()),
    },
    { separador: true },
    { texto: "Cerrar sesión", icono: "box-arrow-right", peligro: true, alPulsar: () => cerrarSesion() },
  ]);
}

// ================= Arranque =================
iniciarTema();
$("btn-tema").addEventListener("click", () => (alternarTema(), pintarBarra()));
$("btn-entorno").addEventListener("click", abrirEntorno);
$("btn-usuario").addEventListener("click", (ev) => menuUsuario(ev.currentTarget));
$("btn-menu").addEventListener("click", () => document.body.classList.toggle("lateral-abierto"));
$("fondo-lateral").addEventListener("click", cerrarLateral);
addEventListener("hashchange", enrutar);
document.addEventListener("entorno-cambiado", () => {
  pintarBarra();
  if (estado.sesion) enrutar(); // vuelve a consultar: las políticas de horario, país y dispositivo dependen del entorno
});
document.addEventListener("cerrar-sesion", () => estado.sesion && cerrarSesion());
document.addEventListener("sesion-invalida", () => estado.sesion && cerrarSesion("Tu sesión expiró o ya no es válida. Inicia sesión de nuevo."));

let avisoInicial = null;
if (estado.sesion) {
  try {
    await cargarPerfil();
    iniciarRelojes();
  } catch {
    guardarSesion(null);
    avisoInicial = "Tu sesión ya no es válida. Inicia sesión de nuevo.";
  }
}
await enrutar();
if (avisoInicial) avisar("warning", avisoInicial);
