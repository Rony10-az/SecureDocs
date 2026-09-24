/** Pantalla de acceso. `alEntrar(respuesta)` la recibe app.js cuando el login sale bien. */
import { ErrorApi, llamar } from "../api.js";
import { h } from "../dom.js";
import { avatar, campo, conEmoji, establecerTitulo, icono, insigniaRol } from "../ui.js";
import { abrirEntorno, resumenEntorno } from "./entorno.js";

const CARACTERISTICAS = [
  ["🔐", "Autenticación con JWT", "Sesiones firmadas que caducan"],
  ["👥", "Roles y permisos (RBAC)", "Qué puede hacer cada rol"],
  ["🧭", "Políticas por atributos (ABAC)", "Departamento, nivel, país, horario y dispositivo"],
  ["📜", "Auditoría inmutable", "Cada decisión queda registrada"],
];
const SELLOS = ["JWT", "RBAC", "ABAC", "Auditoría", "PostgreSQL", "MinIO"];

/** Da a un elemento su posición en una animación escalonada (lo lee el CSS como var(--i)). */
const orden = (el, i) => (el.style.setProperty("--i", String(i)), el);

/** Usuarios de demostración: solo existen fuera de producción (ver src/app.ts); si no están, no se muestra nada. */
async function cargarDemo() {
  try {
    const respuesta = await fetch("/demo/usuarios.json");
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null;
  }
}

export async function login(raiz, alEntrar) {
  establecerTitulo("Iniciar sesión");
  const correo = h("input", { id: "correo", type: "email", class: "form-control form-control-lg", required: true, autocomplete: "username", placeholder: "nombre@techcorp.pe" });
  const clave = h("input", { id: "clave", type: "password", class: "form-control form-control-lg", required: true, autocomplete: "current-password", placeholder: "Tu contraseña" });
  const ojo = h(
    "button",
    {
      type: "button",
      class: "btn btn-outline-secondary",
      "aria-label": "Mostrar u ocultar la contraseña",
      title: "Mostrar u ocultar",
      onclick: () => {
        const visible = clave.type === "text";
        clave.type = visible ? "password" : "text";
        ojo.replaceChildren(icono(visible ? "eye" : "eye-slash"));
      },
    },
    icono("eye"),
  );
  const error = h("div", { class: "login-error d-none", role: "alert" });
  const entrar = h("button", { class: "btn btn-entrar btn-lg w-100" }, icono("box-arrow-in-right", "me-2"), "Entrar");
  const tarjeta = h("div", { class: "login-tarjeta" });

  const entorno = h("button", { type: "button", class: "pill", onclick: abrirEntorno }, icono("geo-alt"), h("span", {}, resumenEntorno()));
  const alCambiarEntorno = () => {
    if (!entorno.isConnected) return document.removeEventListener("entorno-cambiado", alCambiarEntorno);
    entorno.replaceChildren(icono("geo-alt"), h("span", {}, resumenEntorno()));
  };
  document.addEventListener("entorno-cambiado", alCambiarEntorno);

  async function iniciar(correoUsuario, password) {
    error.classList.add("d-none");
    entrar.disabled = true;
    entrar.replaceChildren(h("span", { class: "spinner-border spinner-border-sm me-2", "aria-hidden": "true" }), "Verificando…");
    try {
      await alEntrar(await llamar("POST", "/auth/login", { json: { correo: correoUsuario.trim(), password } }));
    } catch (e) {
      error.replaceChildren(icono("exclamation-octagon-fill", "me-2"), e instanceof ErrorApi ? e.message : "No se pudo conectar con el servidor.");
      error.classList.remove("d-none");
      entrar.disabled = false;
      entrar.replaceChildren(icono("box-arrow-in-right", "me-2"), "Entrar");
      tarjeta.classList.remove("sacudir");
      void tarjeta.offsetWidth; // reinicia la animación aunque se repita el error
      tarjeta.classList.add("sacudir");
    }
  }

  const zonaDemo = h("div", {});

  // ---------- Lado de la imagen ----------
  const hero = h(
    "section",
    { class: "login-hero" },
    h("div", { class: "login-hero-fondo", "aria-hidden": "true" }),
    h("div", { class: "login-hero-velo", "aria-hidden": "true" }),
    h(
      "div",
      { class: "login-hero-contenido" },
      orden(h("div", { class: "login-marca" }, icono("shield-lock-fill"), h("span", {}, "SecureDocs")), 0),
      orden(h("h1", {}, "Gestión documental con control de acceso"), 1),
      orden(h("p", { class: "login-lema" }, "TechCorp S.A. · Laboratorio 06 · Cloud Security"), 2),
      h("ul", { class: "login-lista" }, CARACTERISTICAS.map(([emoji, titulo, detalle], i) => orden(h("li", {}, h("span", { class: "login-emoji" }, emoji), h("div", {}, h("strong", {}, titulo), h("small", {}, detalle))), i + 3))),
      orden(h("div", { class: "login-sellos" }, SELLOS.map((s) => h("span", {}, s))), 8),
    ),
    h("small", { class: "login-credito" }, "Foto: Unsplash"),
  );

  // ---------- Formulario ----------
  const formulario = h(
    "form",
    { class: "login-formulario", onsubmit: (ev) => (ev.preventDefault(), iniciar(correo.value, clave.value)) },
    campo({ etiqueta: "Correo corporativo", control: conEmoji("✉️", correo) }),
    campo({ etiqueta: "Contraseña", control: h("div", { class: "input-group campo-grupo" }, h("span", { class: "input-group-text emoji" }, "🔑"), clave, ojo) }),
    error,
    entrar,
  );

  tarjeta.append(
    h("div", { class: "login-cabecera" }, h("span", { class: "login-escudo", "aria-hidden": "true" }, "🔐"), h("h2", {}, "Bienvenido de nuevo"), h("p", {}, "Entra con tu correo corporativo para continuar.")),
    formulario,
    h("div", { class: "login-entorno" }, h("span", {}, "📍 Entorno simulado"), entorno),
    zonaDemo,
  );

  raiz.append(h("div", { class: "login" }, hero, h("section", { class: "login-panel" }, tarjeta)));

  const demo = await cargarDemo();
  if (!demo) return;
  const nota = h("div", { class: "demo-nota" }, "💡 Pulsa un usuario para entrar con él: cada rol tiene permisos distintos.");
  const tarjetaUsuario = (u, i) => {
    const [nombre, rol] = u.etiqueta.split(" · ");
    return orden(
      h(
        "button",
        {
          type: "button",
          class: `demo-usuario${u.especial ? " demo-especial" : ""}`,
          title: u.nota,
          onclick: () => iniciar(u.correo, demo.password),
          onmouseenter: () => (nota.textContent = `💡 ${u.nota}`),
          onfocus: () => (nota.textContent = `💡 ${u.nota}`),
        },
        avatar(nombre, "sm"),
        h("span", { class: "demo-datos" }, h("strong", {}, nombre), insigniaRol(rol)),
      ),
      i,
    );
  };
  const normales = demo.usuarios.filter((u) => !u.especial);
  const especiales = demo.usuarios.filter((u) => u.especial);
  zonaDemo.append(
    h(
      "div",
      { class: "demo" },
      h("div", { class: "demo-titulo" }, h("strong", {}, "🧪 Usuarios de demostración"), h("span", { class: "badge text-bg-warning" }, "solo laboratorio")),
      h("div", { class: "demo-rejilla" }, normales.map(tarjetaUsuario)),
      especiales.length > 0 && h("div", { class: "demo-subtitulo" }, "⚠️ Casos especiales: entran, pero el servidor lo deniega todo"),
      especiales.length > 0 && h("div", { class: "demo-rejilla" }, especiales.map((u, i) => tarjetaUsuario(u, i + normales.length))),
      nota,
    ),
  );
}
