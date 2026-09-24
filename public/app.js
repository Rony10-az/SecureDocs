/**
 * Punto de entrada: cabecera, entorno simulado, navegación por #/documentos y #/auditoria, y ciclo de la sesión.
 * Las vistas viven en login.js, documentos.js y auditoria.js.
 */
import { estado, guardarEntorno, guardarSesion, llamar } from "./api.js";
import { vistaAuditoria } from "./auditoria.js";
import { avisar, limpiarAviso } from "./avisos.js";
import { iniciarFormularios, vistaDocumentos } from "./documentos.js";
import { h } from "./dom.js";
import { vistaLogin } from "./login.js";

const $ = (id) => document.getElementById(id);
const VISTAS = { documentos: vistaDocumentos, auditoria: vistaAuditoria };

function vistaDeLaUrl() {
  const nombre = location.hash.replace(/^#\//, "");
  return Object.hasOwn(VISTAS, nombre) ? nombre : "documentos";
}

/** Quién eres y qué permisos tiene tu rol, leídos del servidor (así un cambio de rol se ve al instante). */
async function refrescarPerfil() {
  const perfil = await llamar("GET", "/auth/me");
  guardarSesion({ ...estado.sesion, usuario: perfil.usuario });
  estado.permisos = perfil.permisos;
}

function pintarPermisos() {
  const insignias = estado.permisos.map((p) => h("span", { class: "badge text-bg-light border me-1" }, p));
  $("permisos").replaceChildren("Permisos de tu rol (RBAC): ", ...(insignias.length > 0 ? insignias : ["ninguno"]));
}

async function pintar() {
  const conSesion = Boolean(estado.sesion);
  for (const id of ["menu", "sesion", "entorno"]) $(id).hidden = !conSesion;

  const raiz = $("vista");
  raiz.replaceChildren();
  if (!conSesion) return vistaLogin(raiz, entrar);

  const u = estado.sesion.usuario;
  const nombre = vistaDeLaUrl();
  $("quien").textContent = `${u.nombre} · ${u.rol} · ${u.departamento} · nivel ${u.nivel_seguridad}`;
  pintarPermisos();
  for (const enlace of document.querySelectorAll("#menu a")) enlace.classList.toggle("active", enlace.dataset.vista === nombre);
  await VISTAS[nombre](raiz);
}

async function entrar({ token, usuario }) {
  guardarSesion({ token, usuario });
  await refrescarPerfil();
  history.replaceState(null, "", "#/documentos"); // sin disparar hashchange: pintar() se llama una sola vez
  await pintar();
}

function cerrarSesion(mensaje) {
  for (const ventana of document.querySelectorAll("dialog[open]")) ventana.close();
  guardarSesion(null);
  limpiarAviso();
  if (mensaje) avisar("warning", mensaje);
  pintar();
}

function iniciarEntorno() {
  const { ubicacion, dispositivo, hora } = estado.entorno;
  $("e-ubicacion").value = ubicacion;
  $("e-dispositivo").value = dispositivo;
  $("e-hora").value = hora;
  $("form-entorno").addEventListener("change", () => {
    guardarEntorno({ ubicacion: $("e-ubicacion").value, dispositivo: $("e-dispositivo").value, hora: $("e-hora").value });
    limpiarAviso();
    pintar(); // vuelve a consultar: P4, P5 y P6 dependen del entorno
  });
}

$("salir").addEventListener("click", () => cerrarSesion());
document.addEventListener("sesion-invalida", () => cerrarSesion("Tu sesión expiró o ya no es válida. Inicia sesión de nuevo."));
addEventListener("hashchange", () => {
  limpiarAviso();
  pintar();
});

iniciarEntorno();
iniciarFormularios();
if (estado.sesion) {
  try {
    await refrescarPerfil();
  } catch {
    guardarSesion(null);
    avisar("warning", "Tu sesión ya no es válida. Inicia sesión de nuevo.");
  }
}
await pintar();
