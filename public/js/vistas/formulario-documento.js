/**
 * Ventana para subir un documento nuevo o editar uno existente: tres cuadros desplegables (información, clasificación y
 * archivo), arrastrar y soltar, avance de la subida y validaciones del lado del cliente (el servidor vuelve a validar el
 * tipo REAL del archivo por su firma, no por su extensión).
 */
import { catalogos, enviarConProgreso, estado } from "../api.js";
import { h, formatoTamano } from "../dom.js";
import { ilustracion } from "../ilustraciones.js";
import { avisar, avisarError, campo, conEmoji, dialogo, icono, iconoArchivo, medidorConfidencialidad, seccion, toast } from "../ui.js";
import { puedeEnviar } from "./acciones-documento.js";

const EXTENSIONES = [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx"];
const MAX_BYTES = 10 * 1024 * 1024;
const PAISES = ["PERU", "CHILE", "COLOMBIA", "ARGENTINA", "MEXICO", "ESTADOS UNIDOS"];

/** `documento`: el que se edita (null = documento nuevo). `alGuardar(documentoGuardado)` se llama al terminar bien. */
export async function abrirFormularioDocumento({ documento = null, alGuardar }) {
  const usuario = estado.sesion.usuario;
  const departamentos = (await catalogos().catch(() => ({ departamentos: [] }))).departamentos;
  let archivo = null;
  let nivel = 3;

  // ---------- Información ----------
  const titulo = h("input", { id: "fd-titulo", class: "form-control", required: true, minlength: 3, maxlength: 200, value: documento?.titulo ?? "", placeholder: "Ej. Informe financiero del tercer trimestre" });
  const descripcion = h("textarea", { id: "fd-descripcion", class: "form-control", rows: 3, maxlength: 2000, value: documento?.descripcion ?? "", placeholder: "¿De qué trata? (opcional)" });
  const contador = h("div", { class: "form-text text-end" });
  const informacion = seccion({ emoji: "📝", titulo: "Información", tono: "primary", resumen: documento?.titulo ?? "sin título", cuerpo: h("div", { class: "row g-3" }, campo({ etiqueta: "Título", control: conEmoji("📄", titulo) }), h("div", { class: "col-12" }, h("label", { class: "campo-etiqueta", for: "fd-descripcion" }, h("span", { class: "emoji" }, "🗒️"), "Descripción", h("small", { class: "campo-opcional" }, "opcional")), descripcion, contador)) });
  const alEscribir = () => {
    contador.textContent = `${descripcion.value.length} / 2000`;
    informacion.resumen(titulo.value.trim() || "sin título");
  };
  descripcion.addEventListener("input", alEscribir);
  titulo.addEventListener("input", alEscribir);
  alEscribir();

  // ---------- Clasificación (solo al crear: nivel, departamento y país no cambian después) ----------
  const departamento = h("select", { id: "fd-departamento", class: "form-select" }, departamentos.map((d) => h("option", { value: d.codigo, selected: d.codigo === usuario.departamento }, `${d.codigo} · ${d.nombre}`)));
  const pais = h("input", { id: "fd-pais", class: "form-control", list: "fd-paises", value: usuario.pais ?? "", maxlength: 40 });
  const listaPaises = h("datalist", { id: "fd-paises" }, PAISES.map((p) => h("option", { value: p })));
  const zonaMedidor = h("div", { class: "mt-2" });
  const botonesNivel = [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", class: `nivel-opcion nivel-${n}`, "aria-label": `Nivel ${n}`, onclick: () => elegirNivel(n) }, String(n)));
  const clasificacion = documento
    ? null
    : seccion({ emoji: "🔐", titulo: "Clasificación", tono: "warning", cuerpo: h("div", { class: "row g-3" }, h("div", { class: "col-12" }, h("label", { class: "campo-etiqueta" }, h("span", { class: "emoji" }, "🛡️"), "Nivel de confidencialidad"), h("div", { class: "nivel-selector", role: "group", "aria-label": "Nivel de confidencialidad" }, botonesNivel), zonaMedidor, h("div", { class: "form-text" }, "Las políticas comparan este nivel con el nivel de seguridad de quien intente abrirlo.")), campo({ etiqueta: "Departamento", control: conEmoji("🏢", departamento), columnas: "col-sm-6" }), campo({ etiqueta: "País del documento", control: conEmoji("🌎", pais), columnas: "col-sm-6" }), listaPaises) });
  const resumenClasificacion = () => clasificacion?.resumen(`Nivel ${nivel} · ${departamento.value} · ${pais.value || "—"}`);
  function elegirNivel(n) {
    nivel = n;
    botonesNivel.forEach((boton, i) => boton.classList.toggle("activo", i + 1 === n));
    zonaMedidor.replaceChildren(medidorConfidencialidad(n));
    resumenClasificacion();
  }
  departamento.addEventListener("change", resumenClasificacion);
  pais.addEventListener("input", resumenClasificacion);
  if (clasificacion) elegirNivel(nivel);

  // ---------- Archivo: arrastrar y soltar ----------
  const errorArchivo = h("div", { class: "text-danger small mt-1", role: "alert" });
  const tarjetaArchivo = h("div", { class: "archivo-elegido" });
  const entradaArchivo = h("input", { type: "file", class: "visually-hidden", accept: EXTENSIONES.join(","), tabindex: -1, "aria-hidden": "true", onchange: () => elegirArchivo(entradaArchivo.files[0]) });
  const barra = h("div", { class: "progress-bar progress-bar-striped progress-bar-animated", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100 });
  const progreso = h("div", { class: "progress mt-3 d-none" }, barra);

  const pintarArchivo = () => {
    if (archivo) {
      tarjetaArchivo.replaceChildren(icono(iconoArchivo(archivo.type), "fs-3"), h("div", { class: "flex-grow-1 text-truncate" }, h("strong", { class: "d-block text-truncate" }, archivo.name), h("small", { class: "text-secondary" }, formatoTamano(archivo.size))), h("button", { type: "button", class: "btn btn-sm btn-outline-secondary btn-icono", "aria-label": "Quitar el archivo", onclick: () => elegirArchivo(null) }, icono("x-lg")));
    } else if (documento?.archivo) {
      tarjetaArchivo.replaceChildren(icono(iconoArchivo(documento.archivo.mime), "fs-3"), h("div", { class: "flex-grow-1 text-truncate" }, h("strong", { class: "d-block text-truncate" }, documento.archivo.nombre), h("small", { class: "text-secondary" }, `Archivo actual · ${formatoTamano(documento.archivo.tamano)} · elige otro para reemplazarlo`)));
    } else {
      tarjetaArchivo.replaceChildren();
    }
    contenedorArchivo.resumen(archivo ? `${archivo.name} · ${formatoTamano(archivo.size)}` : (documento?.archivo?.nombre ?? "sin archivo"));
  };

  function elegirArchivo(elegido) {
    errorArchivo.textContent = "";
    entradaArchivo.value = "";
    if (elegido) {
      const extension = `.${elegido.name.split(".").pop().toLowerCase()}`;
      if (!EXTENSIONES.includes(extension)) errorArchivo.textContent = `Solo se admiten ${EXTENSIONES.join(", ")}.`;
      else if (elegido.size > MAX_BYTES) errorArchivo.textContent = `El archivo pesa ${formatoTamano(elegido.size)} y el máximo es 10 MB.`;
      else if (elegido.size === 0) errorArchivo.textContent = "El archivo está vacío.";
      else archivo = elegido;
    } else {
      archivo = null;
    }
    pintarArchivo();
  }

  const zona = h(
    "div",
    {
      class: "zona-soltar",
      tabindex: 0,
      role: "button",
      "aria-label": "Elegir un archivo",
      onclick: () => entradaArchivo.click(),
      onkeydown: (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          entradaArchivo.click();
        }
      },
      ondragover: (ev) => {
        ev.preventDefault();
        zona.classList.add("arrastrando");
      },
      ondragleave: () => zona.classList.remove("arrastrando"),
      ondrop: (ev) => {
        ev.preventDefault();
        zona.classList.remove("arrastrando");
        elegirArchivo(ev.dataTransfer.files[0]);
      },
    },
    h("span", { class: "zona-emoji" }, "☁️"),
    h("div", {}, h("strong", {}, "Arrastra un archivo aquí"), " o haz clic para elegirlo"),
    h("div", { class: "zona-tipos" }, ["📕 PDF", "🖼️ PNG", "🖼️ JPG", "📘 DOCX", "📗 XLSX"].map((t) => h("span", {}, t))),
    h("small", { class: "text-secondary" }, "Máximo 10 MB. Se verifica el tipo real del archivo, no solo su extensión."),
  );
  const contenedorArchivo = seccion({ emoji: "📎", titulo: documento ? "Archivo (opcional: reemplaza al actual)" : "Archivo", tono: "success", cuerpo: h("div", {}, zona, entradaArchivo, errorArchivo, tarjetaArchivo, progreso) });
  pintarArchivo();

  // ---------- Guardar ----------
  const botonGuardar = h("button", { type: "button", class: "btn btn-primary", onclick: () => guardar(false) }, icono("save", "me-1"), documento ? "Guardar cambios" : "Guardar borrador");
  const botonEnviar = !documento || puedeEnviar(documento) ? h("button", { type: "button", class: "btn btn-success", onclick: () => guardar(true) }, icono("send", "me-1"), "Guardar y enviar a aprobación") : null;

  async function guardar(enviar) {
    ventana.avisos.replaceChildren();
    if (titulo.value.trim().length < 3) {
      informacion.open = true;
      titulo.classList.add("is-invalid");
      titulo.focus();
      return avisar("warning", "El título debe tener al menos 3 caracteres.", ventana.avisos);
    }
    titulo.classList.remove("is-invalid");
    if (enviar && !archivo && !documento?.archivo) {
      contenedorArchivo.open = true;
      return avisar("warning", "Para enviar a aprobación hay que adjuntar el archivo.", ventana.avisos);
    }

    // Se arma a mano (y no con new FormData(formulario)): solo viajan los campos con contenido
    const datos = new FormData();
    datos.append("titulo", titulo.value.trim());
    if (documento) {
      datos.append("descripcion", descripcion.value.trim()); // vacío = quitar la descripción
    } else {
      datos.append("nivel_confidencialidad", String(nivel));
      if (descripcion.value.trim()) datos.append("descripcion", descripcion.value.trim());
      if (departamento.value) datos.append("departamento", departamento.value);
      if (pais.value.trim()) datos.append("pais", pais.value.trim());
    }
    if (archivo) datos.append("archivo", archivo);
    if (enviar) datos.append("enviar", "true");

    for (const boton of [botonGuardar, botonEnviar]) if (boton) boton.disabled = true;
    progreso.classList.toggle("d-none", !archivo);
    barra.style.width = "0%";
    try {
      const guardado = await enviarConProgreso(documento ? "PUT" : "POST", documento ? `/documentos/${documento.id}` : "/documentos", datos, (fraccion) => {
        barra.style.width = `${Math.round(fraccion * 100)}%`;
      });
      ventana.cerrar();
      toast("success", `«${guardado.titulo}» guardado como ${guardado.estado.toLowerCase()}.`, "🎉 Listo");
      alGuardar?.(guardado);
    } catch (e) {
      avisarError(e, ventana.avisos); // el error se ve dentro de la ventana, sin perder lo escrito
    } finally {
      for (const boton of [botonGuardar, botonEnviar]) if (boton) boton.disabled = false;
      progreso.classList.add("d-none");
    }
  }

  const ventana = dialogo({
    titulo: documento ? "Editar documento" : "Subir documento",
    ancho: "lg",
    banner: {
      emoji: documento ? "✏️" : "📤",
      tono: documento ? "naranja" : "azul",
      subtitulo: documento ? "Cambia el título o la descripción, o reemplaza el archivo." : "Adjunta el archivo, clasifícalo y decide si va directo a aprobación.",
      ilustracion: ilustracion("documento", 110),
    },
    cuerpo: h(
      "form",
      { class: "d-grid gap-3", novalidate: true, onsubmit: (ev) => ev.preventDefault() },
      documento?.estado === "PUBLICADO" && h("div", { class: "consejo consejo-aviso" }, h("span", { class: "emoji" }, "⚠️"), h("div", {}, "Al modificar un documento publicado vuelve a PENDIENTE y hay que aprobarlo otra vez.")),
      informacion,
      clasificacion,
      contenedorArchivo,
      h("div", { class: "consejo" }, h("span", { class: "emoji" }, "💡"), h("div", {}, "Un borrador es privado. Al enviarlo a aprobación pasa a ", h("strong", {}, "PENDIENTE"), " y quien tenga permiso de aprobar podrá publicarlo o rechazarlo.")),
    ),
    pie: [h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => ventana.cerrar() }, "Cancelar"), botonGuardar, botonEnviar],
  });
  titulo.focus();
}
