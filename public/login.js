/** Vista de inicio de sesión. `alEntrar(respuesta)` la recibe app.js cuando el login sale bien. */
import { ErrorApi, llamar } from "./api.js";
import { h } from "./dom.js";

const AYUDA = "Elige un usuario para rellenar el formulario.";

/** Usuarios de demostración: solo existen fuera de producción (ver src/app.ts); si no están, no se muestra nada. */
async function cargarDemo() {
  try {
    const respuesta = await fetch("/demo/usuarios.json");
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null;
  }
}

function panelDemo(demo, correo, clave) {
  const nota = h("div", { class: "form-text" }, AYUDA);
  const selector = h(
    "select",
    {
      class: "form-select",
      "aria-label": "Usuario de demostración",
      onchange: () => {
        const u = demo.usuarios.find((x) => x.correo === selector.value);
        correo.value = u ? u.correo : "";
        clave.value = u ? demo.password : "";
        nota.textContent = u ? u.nota : AYUDA;
      },
    },
    h("option", { value: "" }, "— elegir —"),
    demo.usuarios.map((u) => h("option", { value: u.correo }, u.etiqueta)),
  );
  return h(
    "div",
    { class: "card mt-3 border-warning" },
    h(
      "div",
      { class: "card-body" },
      h("h2", { class: "h6" }, "Usuarios de demostración ", h("span", { class: "badge text-bg-warning" }, "solo laboratorio")),
      selector,
      nota,
    ),
  );
}

export async function vistaLogin(raiz, alEntrar) {
  const correo = h("input", { id: "correo", type: "email", class: "form-control", required: true, autocomplete: "username" });
  const clave = h("input", { id: "clave", type: "password", class: "form-control", required: true, autocomplete: "current-password" });
  const error = h("div", { class: "text-danger small mt-2", role: "alert" });
  const entrar = h("button", { class: "btn btn-primary w-100 mt-3" }, "Entrar");
  const zonaDemo = h("div", {});

  const formulario = h(
    "form",
    {
      onsubmit: async (ev) => {
        ev.preventDefault();
        error.textContent = "";
        entrar.disabled = true;
        try {
          await alEntrar(await llamar("POST", "/auth/login", { json: { correo: correo.value.trim(), password: clave.value } }));
        } catch (e) {
          error.textContent = e instanceof ErrorApi ? e.message : "No se pudo conectar con el servidor.";
          entrar.disabled = false;
        }
      },
    },
    h("label", { class: "form-label", for: "correo" }, "Correo"),
    correo,
    h("label", { class: "form-label mt-2", for: "clave" }, "Contraseña"),
    clave,
    error,
    entrar,
  );

  raiz.append(
    h(
      "div",
      { class: "row justify-content-center" },
      h(
        "div",
        { class: "col-md-8 col-lg-5" },
        h("div", { class: "card shadow-sm" }, h("div", { class: "card-body" }, h("h1", { class: "h4 mb-3" }, "Iniciar sesión"), formulario)),
        zonaDemo,
      ),
    ),
  );

  const demo = await cargarDemo();
  if (demo) zonaDemo.append(panelDemo(demo, correo, clave));
}
