/**
 * Entorno simulado. La ubicación, el dispositivo y la hora que las políticas leen llegan por cabeceras
 * (X-Ubicacion, X-Dispositivo, X-Hora); aquí se eligen. En un despliegue real saldrían de la IP geolocalizada y de un
 * certificado de dispositivo, no del cliente. La hora solo la acepta el servidor fuera de producción.
 */
import { estado, guardarEntorno } from "../api.js";
import { h } from "../dom.js";
import { ilustracion } from "../ilustraciones.js";
import { campo, conEmoji, dialogo, icono, seccion, toast } from "../ui.js";

const UBICACIONES = ["PERU", "CHILE", "COLOMBIA", "ARGENTINA", "MEXICO", "ESTADOS UNIDOS"];

const ESCENARIOS = [
  { emoji: "🏢", texto: "Oficina en Lima", detalle: "PERU · CORPORATIVO · hora real", cambios: { ubicacion: "PERU", dispositivo: "CORPORATIVO", hora: "" } },
  { emoji: "🌙", texto: "Fuera del horario", detalle: "a las 20:00", cambios: { hora: "20:00" } },
  { emoji: "📱", texto: "Dispositivo personal", detalle: "PERSONAL", cambios: { dispositivo: "PERSONAL" } },
  { emoji: "✈️", texto: "Desde otro país", detalle: "CHILE", cambios: { ubicacion: "CHILE" } },
  { emoji: "❓", texto: "Sin ubicación", detalle: "cabecera ausente", cambios: { ubicacion: "" } },
];

/** «PERU · CORPORATIVO · hora real» */
export function resumenEntorno() {
  const { ubicacion, dispositivo, hora } = estado.entorno;
  return [ubicacion || "sin ubicación", dispositivo || "sin dispositivo", hora || "hora real"].join(" · ");
}

export function abrirEntorno() {
  const ubicacion = h("select", { id: "en-ubicacion", class: "form-select" }, UBICACIONES.map((u) => h("option", { value: u, selected: u === estado.entorno.ubicacion }, u)), h("option", { value: "", selected: !estado.entorno.ubicacion }, "(sin informar)"));
  const dispositivo = h("select", { id: "en-dispositivo", class: "form-select" }, ["CORPORATIVO", "PERSONAL"].map((d) => h("option", { value: d, selected: d === estado.entorno.dispositivo }, d)), h("option", { value: "", selected: !estado.entorno.dispositivo }, "(sin informar)"));
  const hora = h("input", { id: "en-hora", type: "time", class: "form-control", value: estado.entorno.hora });

  const aplicar = (entorno) => {
    guardarEntorno(entorno);
    document.dispatchEvent(new Event("entorno-cambiado"));
    ventana.cerrar();
    toast("info", resumenEntorno(), "📍 Entorno simulado actualizado");
  };

  const escenarios = seccion({
    emoji: "🎬",
    titulo: "Escenarios rápidos",
    tono: "primary",
    resumen: "un clic y listo",
    cuerpo: h(
      "div",
      { class: "escenarios" },
      ESCENARIOS.map((e) => h("button", { type: "button", class: "escenario", onclick: () => aplicar({ ...estado.entorno, ...e.cambios }) }, h("span", { class: "escenario-emoji" }, e.emoji), h("span", { class: "escenario-texto" }, h("strong", {}, e.texto), h("small", {}, e.detalle)))),
    ),
  });

  const manual = seccion({
    emoji: "🛠️",
    titulo: "Valores manuales",
    tono: "warning",
    resumen: resumenEntorno(),
    cuerpo: h("div", { class: "row g-3" }, campo({ etiqueta: "Ubicación", control: conEmoji("📍", ubicacion), columnas: "col-sm-6" }), campo({ etiqueta: "Dispositivo", control: conEmoji("💻", dispositivo), columnas: "col-sm-6" }), campo({ etiqueta: "Hora (vacío = la real)", control: conEmoji("🕒", hora), columnas: "col-sm-6", ayuda: estado.perfil?.entorno?.hora ? `El servidor marca ${estado.perfil.entorno.hora} (hora de Lima).` : "El servidor usa la hora de Lima." })),
  });

  const ventana = dialogo({
    titulo: "Entorno simulado",
    ancho: "lg",
    banner: {
      emoji: "📍",
      tono: "azul",
      imagen: "/img/login-fondo.jpg",
      subtitulo: "Elige desde dónde, con qué dispositivo y a qué hora \"haces\" las peticiones.",
      ilustracion: ilustracion("entorno", 110),
    },
    cuerpo: h(
      "div",
      { class: "d-grid gap-3" },
      h("div", { class: "consejo" }, h("span", { class: "emoji" }, "💡"), h("div", {}, "Las políticas de horario, país y dispositivo leen estos valores. Cada petición viaja con ellos en las cabeceras ", h("code", {}, "X-Ubicacion"), ", ", h("code", {}, "X-Dispositivo"), " y ", h("code", {}, "X-Hora"), ".")),
      escenarios,
      manual,
    ),
    pie: [
      h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => aplicar({ ubicacion: "PERU", dispositivo: "CORPORATIVO", hora: "" }) }, icono("arrow-counterclockwise", "me-1"), "Restablecer"),
      h("button", { type: "button", class: "btn btn-primary", onclick: () => aplicar({ ubicacion: ubicacion.value, dispositivo: dispositivo.value, hora: hora.value }) }, icono("check-lg", "me-1"), "Aplicar"),
    ],
  });
}
