/**
 * Tema claro, oscuro o el del sistema. Es la ÚNICA preferencia que se guarda en localStorage (para que sobreviva entre
 * visitas): no es un dato sensible. El token y el resto de la sesión viven solo en sessionStorage (ver api.js).
 */
const CLAVE = "securedocs.tema";
const MODOS = ["auto", "claro", "oscuro"];
const oscuroDelSistema = matchMedia("(prefers-color-scheme: dark)");

function leer() {
  try {
    const modo = localStorage.getItem(CLAVE);
    return MODOS.includes(modo) ? modo : "auto";
  } catch {
    return "auto";
  }
}

let modoActual = leer();

function aplicar() {
  const oscuro = modoActual === "oscuro" || (modoActual === "auto" && oscuroDelSistema.matches);
  document.documentElement.setAttribute("data-bs-theme", oscuro ? "dark" : "light");
}

export const modoTema = () => modoActual;

export function iniciarTema() {
  aplicar();
  oscuroDelSistema.addEventListener("change", aplicar);
}

/** auto -> claro -> oscuro -> auto. Devuelve el modo nuevo. */
export function alternarTema() {
  modoActual = MODOS[(MODOS.indexOf(modoActual) + 1) % MODOS.length];
  try {
    localStorage.setItem(CLAVE, modoActual);
  } catch {
    /* sin almacenamiento: el cambio dura mientras dure la página */
  }
  aplicar();
  return modoActual;
}

export const ICONO_TEMA = { auto: "circle-half", claro: "sun", oscuro: "moon-stars" };
