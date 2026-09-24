/**
 * Sesión y comunicación con la API.
 *
 *  - El token vive en sessionStorage (se borra al cerrar la pestaña), nunca en localStorage.
 *  - Cada petición lleva el token y el entorno simulado (X-Ubicacion, X-Dispositivo y, si se eligió, X-Hora).
 *  - Toda respuesta con error se convierte en ErrorApi, que conserva el cuerpo JSON (etapa, política y motivo).
 *  - Los permisos de la interfaz (puede) salen de GET /auth/me y solo sirven de pista visual: quien decide es el servidor.
 */
const CLAVE_SESION = "securedocs.sesion";
const CLAVE_ENTORNO = "securedocs.entorno";
const CLAVE_PREFS = "securedocs.prefs";

const leer = (clave) => {
  try {
    return JSON.parse(sessionStorage.getItem(clave));
  } catch {
    return null;
  }
};

const escribir = (clave, valor) => {
  try {
    if (valor == null) sessionStorage.removeItem(clave);
    else sessionStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento (modo privado o bloqueado): dura lo que dure la página */
  }
};

/** Estado en memoria (fuente de verdad); sessionStorage solo sirve para sobrevivir a un F5. */
export const estado = {
  sesion: leer(CLAVE_SESION), // { token, usuario } o null
  permisos: [], // permisos RBAC del rol, de GET /auth/me
  perfil: null, // la última respuesta de GET /auth/me
  entorno: leer(CLAVE_ENTORNO) ?? { ubicacion: "PERU", dispositivo: "CORPORATIVO", hora: "" },
  prefs: { modoLab: true, vistaDocumentos: "tabla", porPagina: 10, ...(leer(CLAVE_PREFS) ?? {}) },
};

export const puede = (permiso) => estado.permisos.includes(permiso);

export function guardarSesion(sesion) {
  estado.sesion = sesion;
  if (!sesion) {
    estado.permisos = [];
    estado.perfil = null;
    catalogosEnCache = null;
    reglasEnCache = null;
  }
  escribir(CLAVE_SESION, sesion);
}

export function guardarEntorno(entorno) {
  estado.entorno = entorno;
  escribir(CLAVE_ENTORNO, entorno);
}

export function guardarPrefs(cambios) {
  Object.assign(estado.prefs, cambios);
  escribir(CLAVE_PREFS, estado.prefs);
}

/** Cuándo vence el token (ms desde 1970), leído de su carga útil. El servidor sigue siendo quien lo valida. */
export function expiraEn() {
  try {
    const carga = JSON.parse(atob(estado.sesion.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return carga.exp * 1000;
  } catch {
    return null;
  }
}

export class ErrorApi extends Error {
  constructor(status, cuerpo) {
    super(cuerpo?.mensaje ?? `La API respondió ${status}`);
    this.status = status;
    this.cuerpo = cuerpo ?? {};
  }
}

export function cabeceras(extra = {}) {
  const cabecera = { ...extra };
  const { ubicacion, dispositivo, hora } = estado.entorno;
  if (estado.sesion) cabecera.Authorization = `Bearer ${estado.sesion.token}`;
  if (ubicacion) cabecera["X-Ubicacion"] = ubicacion;
  if (dispositivo) cabecera["X-Dispositivo"] = dispositivo;
  if (hora) cabecera["X-Hora"] = hora;
  return cabecera;
}

async function comoError(respuesta) {
  return new ErrorApi(respuesta.status, await respuesta.json().catch(() => null));
}

/**
 * llamar("GET", "/documentos", { params }) · llamar("POST", "/x", { json }) · llamar("PUT", "/x", { formulario }).
 * Devuelve el JSON (o null si la API respondió 204) y lanza ErrorApi si la respuesta no fue 2xx.
 */
export async function llamar(metodo, ruta, { json, formulario, params } = {}) {
  const url = new URL(ruta, location.origin);
  for (const [clave, valor] of Object.entries(params ?? {})) {
    if (valor !== "" && valor != null) url.searchParams.set(clave, valor);
  }
  const init = { method: metodo, headers: cabeceras(json ? { "Content-Type": "application/json" } : {}) };
  if (json) init.body = JSON.stringify(json);
  if (formulario) init.body = formulario; // FormData: el navegador pone el Content-Type con su boundary

  const respuesta = await fetch(url, init);
  if (respuesta.status === 204) return null;
  if (!respuesta.ok) throw await comoError(respuesta);
  return respuesta.json();
}

/** Como llamar() con un FormData, pero avisa del avance de la subida (fetch no lo permite; XMLHttpRequest sí). */
export function enviarConProgreso(metodo, ruta, formulario, alProgreso) {
  return new Promise((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    xhr.open(metodo, ruta);
    for (const [clave, valor] of Object.entries(cabeceras())) xhr.setRequestHeader(clave, valor);
    xhr.responseType = "json";
    xhr.upload.onprogress = (ev) => ev.lengthComputable && alProgreso?.(ev.loaded / ev.total);
    xhr.onerror = () => rechazar(new TypeError("Fallo de red"));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolver(xhr.response) : rechazar(new ErrorApi(xhr.status, xhr.response)));
    xhr.send(formulario);
  });
}

/** Quién eres y qué permisos tiene tu rol, leídos del servidor (así un cambio de rol se ve al instante). */
export async function cargarPerfil() {
  const perfil = await llamar("GET", "/auth/me");
  estado.perfil = perfil;
  estado.permisos = perfil.permisos;
  guardarSesion({ ...estado.sesion, usuario: perfil.usuario });
  estado.permisos = perfil.permisos; // guardarSesion no los toca con sesión, pero así queda explícito
  return perfil;
}

// ---------- Listas de referencia (se piden una vez por sesión) ----------
let catalogosEnCache = null;
let reglasEnCache = null;

/** { roles: [...], departamentos: [{ codigo, nombre }], permisos: [...] } */
export async function catalogos() {
  catalogosEnCache ??= await llamar("GET", "/catalogos");
  return catalogosEnCache;
}

/** { rbac: { permisos, roles }, abac: [...] } (exige AUDIT_READ). `forzar` vuelve a pedirlas. */
export async function reglas({ forzar = false } = {}) {
  if (forzar || !reglasEnCache) reglasEnCache = await llamar("GET", "/reglas");
  return reglasEnCache;
}

/** Estado de la API y de la base de datos (ruta pública) y lo que tardó en responder. */
export async function salud() {
  const inicio = performance.now();
  try {
    const respuesta = await fetch("/health", { cache: "no-store" });
    const cuerpo = await respuesta.json().catch(() => ({}));
    return { ok: respuesta.ok && cuerpo.bd === "ok", ms: Math.round(performance.now() - inicio) };
  } catch {
    return { ok: false, ms: null };
  }
}

/** Content-Disposition trae el nombre dos veces: filename="ascii" y filename*=UTF-8''codificado (conserva tildes y ñ). */
function nombreDeCabecera(cabecera) {
  if (!cabecera) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecera);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* cae al nombre ASCII */
    }
  }
  return /filename="([^"]+)"/i.exec(cabecera)?.[1] ?? null;
}

const hexadecimal = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Descarga el archivo de un documento. No puede ser un enlace directo porque la ruta exige el token:
 * se pide con fetch, se comprueba el SHA-256 contra la cabecera X-Content-SHA256 y se entrega al navegador.
 * Devuelve { nombre, integro, bytes } (integro = null si el navegador no puede calcular el hash).
 */
export async function descargarArchivo(id) {
  const { blob, nombre, integro, bytes } = await obtenerArchivo(id);
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { nombre, integro, bytes };
}

/**
 * Pide el archivo de un documento (con fetch, porque la ruta exige el token) y comprueba su SHA-256 contra la cabecera
 * X-Content-SHA256. Sirve para descargar y para la vista previa; en los dos casos el servidor lo audita como DOC_DOWNLOAD.
 * Devuelve { blob, nombre, mime, integro, bytes } (integro = null si el navegador no puede calcular el hash).
 */
export async function obtenerArchivo(id) {
  const respuesta = await fetch(`/documentos/${id}/archivo`, { headers: cabeceras() });
  if (!respuesta.ok) throw await comoError(respuesta);

  const bytes = await respuesta.arrayBuffer();
  const esperado = respuesta.headers.get("X-Content-SHA256");
  const nombre = nombreDeCabecera(respuesta.headers.get("Content-Disposition")) ?? `documento-${id}`;
  const mime = respuesta.headers.get("Content-Type") ?? "application/octet-stream";
  const integro =
    esperado && globalThis.crypto?.subtle ? hexadecimal(await crypto.subtle.digest("SHA-256", bytes)) === esperado.toLowerCase() : null;
  return { blob: new Blob([bytes], { type: mime }), nombre, mime, integro, bytes: bytes.byteLength };
}
