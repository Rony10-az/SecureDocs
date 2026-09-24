/**
 * Sesión y comunicación con la API.
 *
 *  - El token vive en sessionStorage (se borra al cerrar la pestaña), nunca en localStorage.
 *  - Cada petición lleva el token y el entorno simulado (X-Ubicacion, X-Dispositivo y, si se eligió, X-Hora).
 *  - Toda respuesta con error se convierte en ErrorApi, que conserva el cuerpo JSON (etapa, política y motivo).
 */
const CLAVE_SESION = "securedocs.sesion";
const CLAVE_ENTORNO = "securedocs.entorno";

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
    /* sin almacenamiento (modo privado o bloqueado): la sesión dura lo que dure la página */
  }
};

/** Estado en memoria (fuente de verdad); sessionStorage solo sirve para sobrevivir a un F5. */
export const estado = {
  sesion: leer(CLAVE_SESION), // { token, usuario } o null
  permisos: [], // permisos RBAC del rol, de GET /auth/me
  entorno: leer(CLAVE_ENTORNO) ?? { ubicacion: "PERU", dispositivo: "CORPORATIVO", hora: "" },
};

export function guardarSesion(sesion) {
  estado.sesion = sesion;
  if (!sesion) estado.permisos = [];
  escribir(CLAVE_SESION, sesion);
}

export function guardarEntorno(entorno) {
  estado.entorno = entorno;
  escribir(CLAVE_ENTORNO, entorno);
}

export class ErrorApi extends Error {
  constructor(status, cuerpo) {
    super(cuerpo?.mensaje ?? `La API respondió ${status}`);
    this.status = status;
    this.cuerpo = cuerpo ?? {};
  }
}

function cabeceras(extra = {}) {
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
 * Devuelve { nombre, integro } (integro = null si el navegador no puede calcular el hash).
 */
export async function descargarArchivo(id) {
  const respuesta = await fetch(`/documentos/${id}/archivo`, { headers: cabeceras() });
  if (!respuesta.ok) throw await comoError(respuesta);

  const bytes = await respuesta.arrayBuffer();
  const esperado = respuesta.headers.get("X-Content-SHA256");
  const nombre = nombreDeCabecera(respuesta.headers.get("Content-Disposition")) ?? `documento-${id}`;
  const integro =
    esperado && globalThis.crypto?.subtle ? hexadecimal(await crypto.subtle.digest("SHA-256", bytes)) === esperado.toLowerCase() : null;

  const url = URL.createObjectURL(new Blob([bytes], { type: respuesta.headers.get("Content-Type") ?? "application/octet-stream" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { nombre, integro };
}
