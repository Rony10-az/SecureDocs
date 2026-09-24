/**
 * Gestión de usuarios (USER_MANAGE y, al asignar o cambiar el rol, ROLE_ASSIGN). Alta, edición, activar o desactivar y
 * restablecer contraseña. El servidor aplica las reglas que la pantalla solo anticipa: contraseña segura, contrato
 * EXTERNO con fecha de expiración, nadie cambia su propio rol y siempre queda al menos un gestor activo.
 * No hay "eliminar": la auditoría es inmutable y apunta a cada usuario, así que las cuentas se desactivan.
 */
import { catalogos, estado, llamar, puede, reglas as pedirReglas } from "../api.js";
import { copiar, debounce, h, plural } from "../dom.js";
import { ilustracion } from "../ilustraciones.js";
import {
  abrirMenu,
  avatar,
  avisar,
  avisarError,
  botonAccion,
  cabeceraPagina,
  campo,
  chip,
  confirmar,
  conEmoji,
  dialogo,
  establecerTitulo,
  esqueleto,
  icono,
  insigniaEstadoUsuario,
  insigniaRol,
  itemMenu,
  medidorConfidencialidad,
  paginador,
  seccion,
  toast,
  vacio,
} from "../ui.js";

const filtros = { q: "", rol: "", departamento: "", estado: "", tipo_contrato: "", pagina: 1 };
const POR_PAGINA = 15;
const ESTADOS = [
  ["", "👥 Todos"],
  ["ACTIVO", "✅ Activos"],
  ["INACTIVO", "⛔ Inactivos"],
  ["SUSPENDIDO", "🚫 Suspendidos"],
];
const PAISES = ["PERU", "CHILE", "COLOMBIA", "ARGENTINA", "MEXICO", "ESTADOS UNIDOS"];

/** La fecha de hoy según el servidor (zona de Lima), o la del equipo si aún no se conoce. */
const hoy = () => estado.perfil?.entorno?.fecha ?? new Date().toISOString().slice(0, 10);

const medidorNivel = (n) => h("span", { class: "nivel-medidor", title: `Nivel de seguridad ${n} de 5` }, [1, 2, 3, 4, 5].map((i) => h("i", { class: i <= n ? "on" : "" })), h("small", {}, String(n)));

function celdaContrato(u) {
  if (u.tipo_contrato !== "EXTERNO") return chip("Interno", { color: "secondary", icono: "building" });
  const dias = Math.round((new Date(u.fecha_expiracion) - new Date(hoy())) / 86_400_000);
  return h("div", {}, chip("Externo", { color: dias < 0 ? "danger" : dias <= 30 ? "warning" : "info", icono: "hourglass-split" }), h("small", { class: `d-block ${dias < 0 ? "text-danger" : "text-secondary"}` }, dias < 0 ? `venció el ${u.fecha_expiracion}` : `vence el ${u.fecha_expiracion}`));
}

// ================= Contraseña =================
const REGLAS_PASSWORD = (clave, correo) => {
  const local = (correo.split("@")[0] ?? "").toLowerCase();
  return [
    ["Al menos 10 caracteres", clave.length >= 10],
    ["Mayúsculas, minúsculas y números", /\p{Ll}/u.test(clave) && /\p{Lu}/u.test(clave) && /\p{Nd}/u.test(clave)],
    ["Hasta 72 bytes (límite de bcrypt)", new TextEncoder().encode(clave).length <= 72],
    ["No contiene el correo del usuario", local.length < 4 || !clave.toLowerCase().includes(local)],
  ];
};

function generarPassword() {
  const aleatorio = (texto) => texto[crypto.getRandomValues(new Uint32Array(1))[0] % texto.length];
  const mayusculas = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const minusculas = "abcdefghijkmnopqrstuvwxyz";
  const numeros = "23456789";
  const todos = `${mayusculas}${minusculas}${numeros}!@#$%*?`;
  const letras = [aleatorio(mayusculas), aleatorio(minusculas), aleatorio(numeros), ...Array.from({ length: 11 }, () => aleatorio(todos))];
  for (let i = letras.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [letras[i], letras[j]] = [letras[j], letras[i]];
  }
  return letras.join("");
}

// ================= Formulario =================
/** `usuario`: el que se edita (null = alta). `restablecer`: abre la edición con el cambio de contraseña marcado. */
export async function abrirFormularioUsuario({ usuario = null, restablecer = false, alGuardar }) {
  const cat = await catalogos().catch(() => ({ roles: [], departamentos: [] }));
  const conjunto = puede("AUDIT_READ") ? await pedirReglas().catch(() => null) : null; // solo para mostrar los permisos de cada rol
  const editar = Boolean(usuario);
  const yo = estado.sesion.usuario;
  let nivel = usuario?.nivel_seguridad ?? 2;
  let contrato = usuario?.tipo_contrato ?? "INTERNO";

  // ---------- 👤 Datos personales ----------
  const nombre = h("input", { id: "fu-nombre", class: "form-control", value: usuario?.nombre ?? "", maxlength: 100, autocomplete: "off", placeholder: "Nombre y apellido" });
  const correo = h("input", { id: "fu-correo", type: "email", class: "form-control", value: usuario?.correo ?? "", maxlength: 254, autocomplete: "off", placeholder: "nombre@techcorp.pe" });
  const pais = h("input", { id: "fu-pais", class: "form-control", list: "fu-paises", value: usuario?.pais ?? "PERU", maxlength: 40 });
  const personales = seccion({
    emoji: "👤",
    titulo: "Datos personales",
    tono: "primary",
    resumen: usuario?.nombre ?? "",
    cuerpo: h("div", { class: "row g-3" }, campo({ etiqueta: "Nombre completo", control: conEmoji("👤", nombre), columnas: "col-sm-6" }), campo({ etiqueta: "Correo corporativo", control: conEmoji("✉️", correo), columnas: "col-sm-6" }), campo({ etiqueta: "País", control: conEmoji("🌎", pais), columnas: "col-sm-6" }), h("datalist", { id: "fu-paises" }, PAISES.map((p) => h("option", { value: p })))),
  });
  nombre.addEventListener("input", () => personales.resumen(nombre.value.trim()));

  // ---------- 🛡️ Acceso y permisos ----------
  const rol = h("select", { id: "fu-rol", class: "form-select" }, cat.roles.map((r) => h("option", { value: r, selected: r === (usuario?.rol ?? "EMPLEADO") }, r)));
  const departamento = h("select", { id: "fu-departamento", class: "form-select" }, cat.departamentos.map((d) => h("option", { value: d.codigo, selected: d.codigo === (usuario?.departamento ?? yo.departamento) }, `${d.codigo} · ${d.nombre}`)));
  const estadoUsuario = h("select", { id: "fu-estado", class: "form-select" }, [["ACTIVO", "✅ Activo"], ["INACTIVO", "⛔ Inactivo"], ["SUSPENDIDO", "🚫 Suspendido"]].map(([e, texto]) => h("option", { value: e, selected: e === (usuario?.estado ?? "ACTIVO") }, texto)));
  const avisoRol = h("div", { class: "form-text text-warning-emphasis d-none" }, icono("exclamation-triangle", "me-1"), "Cambiar el rol exige el permiso ROLE_ASSIGN, y nadie puede cambiar su propio rol.");
  const permisosRol = h("div", { class: "permisos-rol" });
  const zonaMedidor = h("div", { class: "mt-2" });
  const botonesNivel = [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", class: `nivel-opcion nivel-${n}`, "aria-label": `Nivel ${n}`, onclick: () => elegirNivel(n) }, String(n)));
  const acceso = seccion({
    emoji: "🛡️",
    titulo: "Acceso y permisos",
    tono: "warning",
    cuerpo: h(
      "div",
      { class: "row g-3" },
      h("div", { class: "col-sm-6" }, h("label", { class: "campo-etiqueta", for: "fu-rol" }, "Rol"), conEmoji("🎭", rol), avisoRol, permisosRol),
      campo({ etiqueta: "Departamento", control: conEmoji("🏢", departamento), columnas: "col-sm-6" }),
      h("div", { class: "col-sm-6" }, h("label", { class: "campo-etiqueta" }, h("span", { class: "emoji" }, "🛡️"), "Nivel de seguridad"), h("div", { class: "nivel-selector", role: "group", "aria-label": "Nivel de seguridad" }, botonesNivel), zonaMedidor, h("div", { class: "form-text" }, "Hasta qué nivel de confidencialidad puede abrir.")),
      campo({ etiqueta: "Estado de la cuenta", control: conEmoji("⚡", estadoUsuario), columnas: "col-sm-6", ayuda: "Inactivo o suspendido: puede entrar, pero el servidor le deniega todo." }),
    ),
  });
  function pintarAcceso() {
    const permisos = conjunto?.rbac.roles.find((r) => r.nombre === rol.value)?.permisos;
    permisosRol.replaceChildren(...(permisos ? [h("small", { class: "text-secondary d-block mt-2 mb-1" }, `🔓 Permisos de ${rol.value}`), h("div", { class: "d-flex flex-wrap gap-1" }, permisos.map((p) => chip(p, { color: "success" })))] : []));
    acceso.resumen(`${rol.value} · ${departamento.value} · nivel ${nivel}`);
  }
  function elegirNivel(n) {
    nivel = n;
    botonesNivel.forEach((b, i) => b.classList.toggle("activo", i + 1 === n));
    zonaMedidor.replaceChildren(medidorConfidencialidad(n));
    pintarAcceso();
  }
  rol.addEventListener("change", () => {
    avisoRol.classList.toggle("d-none", !editar || rol.value === usuario.rol);
    pintarAcceso();
  });
  departamento.addEventListener("change", pintarAcceso);
  elegirNivel(nivel);

  // ---------- 📃 Contrato ----------
  const expiracion = h("input", { id: "fu-expira", type: "date", class: "form-control", value: usuario?.fecha_expiracion ?? "", min: hoy() });
  const zonaExpiracion = campo({ etiqueta: "Vence el", control: conEmoji("📅", expiracion), columnas: "col-sm-6", ayuda: "Obligatoria para contratos externos; no puede ser anterior a hoy." });
  const botonesContrato = ["INTERNO", "EXTERNO"].map((c) => h("button", { type: "button", class: "segmento", onclick: () => elegirContrato(c) }, c === "INTERNO" ? "🏢 Interno" : "🤝 Externo"));
  const contratoSec = seccion({ emoji: "📃", titulo: "Contrato", tono: "info", cuerpo: h("div", { class: "row g-3" }, h("div", { class: "col-sm-6" }, h("label", { class: "campo-etiqueta" }, "Tipo de contrato"), h("div", { class: "segmentado" }, botonesContrato), h("div", { class: "form-text" }, "Un externo tiene acceso temporal y vence en la fecha indicada.")), zonaExpiracion) });
  function elegirContrato(c) {
    contrato = c;
    botonesContrato.forEach((b, i) => b.classList.toggle("activo", ["INTERNO", "EXTERNO"][i] === c));
    zonaExpiracion.classList.toggle("d-none", c !== "EXTERNO");
    contratoSec.resumen(c === "EXTERNO" ? `Externo${expiracion.value ? ` · vence ${expiracion.value}` : ""}` : "Interno");
  }
  expiracion.addEventListener("change", () => elegirContrato(contrato));
  elegirContrato(contrato);

  // ---------- 🔑 Credenciales ----------
  const password = h("input", { id: "fu-password", type: "text", class: "form-control font-monospace", autocomplete: "new-password", spellcheck: false, placeholder: "Escríbela o genera una" });
  const lista = h("ul", { class: "reglas-password" });
  const pintarReglas = () => lista.replaceChildren(...REGLAS_PASSWORD(password.value, correo.value).map(([texto, cumple]) => h("li", { class: cumple ? "cumple" : "" }, icono(cumple ? "check-circle-fill" : "circle"), texto)));
  password.addEventListener("input", pintarReglas);
  correo.addEventListener("input", pintarReglas);
  pintarReglas();
  const generar = h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => ((password.value = generarPassword()), pintarReglas()) }, icono("magic", "me-1"), "Generar");
  const copiarPassword = h("button", { type: "button", class: "btn btn-outline-secondary", "aria-label": "Copiar la contraseña", title: "Copiar", onclick: async () => toast((await copiar(password.value)) ? "success" : "warning", "Contraseña copiada.") }, icono("clipboard"));
  const bloquePassword = h("div", {}, h("label", { class: "campo-etiqueta", for: "fu-password" }, editar ? "Nueva contraseña" : "Contraseña inicial"), h("div", { class: "input-group campo-grupo" }, h("span", { class: "input-group-text emoji" }, "🔑"), password, generar, copiarPassword), lista);
  const reiniciar = h("input", { id: "fu-reiniciar", type: "checkbox", class: "form-check-input", checked: restablecer, onchange: () => bloquePassword.classList.toggle("d-none", !reiniciar.checked) });
  bloquePassword.classList.toggle("d-none", editar && !restablecer);
  const credenciales = seccion({ emoji: "🔑", titulo: "Credenciales", tono: "danger", abierta: !editar || restablecer, resumen: editar ? "restablecer contraseña" : "contraseña inicial", cuerpo: h("div", { class: "d-grid gap-3" }, editar && h("div", { class: "form-check" }, reiniciar, h("label", { class: "form-check-label", for: "fu-reiniciar" }, "Restablecer la contraseña de este usuario")), bloquePassword) });

  // ---------- Guardar ----------
  const guardarBoton = h("button", { type: "button", class: "btn btn-primary", onclick: guardar }, icono("save", "me-1"), editar ? "Guardar cambios" : "Crear usuario");

  async function guardar() {
    ventana.avisos.replaceChildren();
    const problemas = [];
    if (nombre.value.trim().length < 2) problemas.push("El nombre debe tener al menos 2 caracteres.");
    if (!correo.value.trim() || !correo.validity.valid) problemas.push("Escribe un correo válido.");
    if (contrato === "EXTERNO" && !expiracion.value && !(editar && usuario.tipo_contrato === "EXTERNO" && usuario.fecha_expiracion)) problemas.push("Un usuario externo necesita fecha de expiración.");
    const cambiaClave = editar ? reiniciar.checked : true;
    if (cambiaClave && REGLAS_PASSWORD(password.value, correo.value).some(([, cumple]) => !cumple)) {
      credenciales.open = true;
      problemas.push("La contraseña no cumple todas las reglas.");
    }
    if (problemas.length > 0) return avisar("warning", h("ul", { class: "mb-0" }, problemas.map((p) => h("li", {}, p))), ventana.avisos);

    const datos = { nombre: nombre.value.trim(), correo: correo.value.trim().toLowerCase(), rol: rol.value, departamento: departamento.value, nivel_seguridad: nivel, pais: pais.value.trim(), tipo_contrato: contrato, estado: estadoUsuario.value };
    let cuerpo;
    if (editar) {
      // Solo viaja lo que cambió: así el detalle de la auditoría es exacto y no se pide ROLE_ASSIGN sin necesidad
      cuerpo = Object.fromEntries(Object.entries(datos).filter(([clave, valor]) => String(valor) !== String(usuario[clave] ?? "")));
      if (contrato === "EXTERNO" && (usuario.tipo_contrato !== "EXTERNO" || (expiracion.value || null) !== (usuario.fecha_expiracion ?? null))) cuerpo.fecha_expiracion = expiracion.value || null;
      if (reiniciar.checked && password.value) cuerpo.password = password.value;
      if (Object.keys(cuerpo).length === 0) return avisar("info", "No hay cambios que guardar.", ventana.avisos);
    } else {
      cuerpo = { ...datos, password: password.value };
      if (!cuerpo.pais) delete cuerpo.pais;
      if (contrato === "EXTERNO") cuerpo.fecha_expiracion = expiracion.value;
    }

    guardarBoton.disabled = true;
    try {
      const guardado = await llamar(editar ? "PUT" : "POST", editar ? `/usuarios/${usuario.id}` : "/usuarios", { json: cuerpo });
      ventana.cerrar();
      toast("success", `«${guardado.nombre}» ${editar ? "actualizado" : "creado"}.`, "🎉 Listo");
      alGuardar?.(guardado);
    } catch (e) {
      avisarError(e, ventana.avisos); // el error se ve dentro de la ventana, sin perder lo escrito
    } finally {
      guardarBoton.disabled = false;
    }
  }

  const ventana = dialogo({
    titulo: editar ? `Editar a ${usuario.nombre}` : "Nuevo usuario",
    ancho: "lg",
    banner: {
      emoji: editar ? "🛠️" : "🧑‍💼",
      tono: editar ? "naranja" : "morado",
      subtitulo: editar ? "Cambia sus datos, su rol o su acceso. Solo se envía lo que modifiques." : "Crea la cuenta, asígnale un rol y un nivel de seguridad.",
      ilustracion: ilustracion("usuario", 110),
    },
    cuerpo: h("form", { class: "d-grid gap-3", novalidate: true, onsubmit: (ev) => ev.preventDefault() }, personales, acceso, contratoSec, credenciales, h("div", { class: "consejo" }, h("span", { class: "emoji" }, "💡"), h("div", {}, "Los usuarios no se eliminan: la auditoría guarda cada acción a su nombre y no se puede modificar. Para dar de baja una cuenta se la deja ", h("strong", {}, "inactiva"), " o ", h("strong", {}, "suspendida"), "."))),
    pie: [h("button", { type: "button", class: "btn btn-outline-secondary", onclick: () => ventana.cerrar() }, "Cancelar"), guardarBoton],
  });
  (editar && restablecer ? password : nombre).focus();
}

// ================= Lista =================
export async function usuarios(raiz) {
  establecerTitulo("Usuarios");
  const cat = await catalogos().catch(() => ({ roles: [], departamentos: [] }));
  let datos = null;

  const buscador = h("input", { type: "search", class: "form-control", placeholder: "Nombre o correo…", value: filtros.q, "aria-label": "Buscar usuarios" });
  const selRol = h("select", { class: "form-select", "aria-label": "Rol" }, h("option", { value: "" }, "Todos los roles"), cat.roles.map((r) => h("option", { value: r, selected: r === filtros.rol }, r)));
  const selDepto = h("select", { class: "form-select", "aria-label": "Departamento" }, h("option", { value: "" }, "Todos los departamentos"), cat.departamentos.map((d) => h("option", { value: d.codigo, selected: d.codigo === filtros.departamento }, d.nombre)));
  const selContrato = h("select", { class: "form-select", "aria-label": "Contrato" }, h("option", { value: "" }, "Todos los contratos"), ["INTERNO", "EXTERNO"].map((c) => h("option", { value: c, selected: c === filtros.tipo_contrato }, c === "INTERNO" ? "Internos" : "Externos")));
  const grupoEstado = h("div", { class: "segmentado", role: "group", "aria-label": "Estado" });
  const panelFiltros = seccion({ emoji: "🔎", titulo: "Buscar y filtrar", tono: "primary", cuerpo: h("div", {}, h("div", { class: "row g-2" }, h("div", { class: "col-sm-6 col-xxl-3" }, conEmoji("🔎", buscador)), h("div", { class: "col-sm-6 col-xxl-3" }, conEmoji("🎭", selRol)), h("div", { class: "col-sm-6 col-xxl-3" }, conEmoji("🏢", selDepto)), h("div", { class: "col-sm-6 col-xxl-3" }, conEmoji("📃", selContrato))), h("div", { class: "mt-3" }, grupoEstado)) });
  const resumenFiltros = () => {
    const n = [filtros.q, filtros.rol, filtros.departamento, filtros.estado, filtros.tipo_contrato].filter(Boolean).length;
    panelFiltros.resumen(n === 0 ? "sin filtros" : `${n} filtro${n === 1 ? "" : "s"} activo${n === 1 ? "" : "s"}`);
  };
  const pintarEstados = () => grupoEstado.replaceChildren(...ESTADOS.map(([valor, texto]) => h("button", { type: "button", class: `segmento${filtros.estado === valor ? " activo" : ""}`, onclick: () => ((filtros.estado = valor), (filtros.pagina = 1), pintarEstados(), cargar()) }, texto)));
  pintarEstados();

  const resultados = h("div", { class: "resultados" });
  const pie = h("div", { class: "pie-lista" });
  const alFiltrar = () => ((filtros.q = buscador.value.trim()), (filtros.rol = selRol.value), (filtros.departamento = selDepto.value), (filtros.tipo_contrato = selContrato.value), (filtros.pagina = 1), cargar());
  buscador.addEventListener("input", debounce(alFiltrar, 350));
  [selRol, selDepto, selContrato].forEach((s) => s.addEventListener("change", alFiltrar));

  async function cargar() {
    resumenFiltros();
    resultados.replaceChildren(esqueleto(6));
    try {
      datos = await llamar("GET", "/usuarios", { params: { ...filtros, limite: POR_PAGINA } });
      if (datos.usuarios.length === 0 && datos.pagina > 1) {
        filtros.pagina = Math.max(1, Math.ceil(datos.total / datos.limite));
        return cargar();
      }
      pintar();
    } catch (e) {
      datos = null;
      resultados.replaceChildren(vacio({ icono: "shield-lock", titulo: "No se pudo cargar la lista de usuarios", texto: "Mira el aviso de arriba para saber por qué." }));
      pie.replaceChildren();
      avisarError(e);
    }
  }

  async function cambiarEstado(u, nuevo) {
    if (nuevo !== "ACTIVO") {
      const acepta = await confirmar({ titulo: nuevo === "INACTIVO" ? "Desactivar usuario" : "Suspender usuario", icono: "person-dash", mensaje: `${u.nombre} conservará su cuenta, pero el servidor denegará todo lo que intente (etapa ESTADO). Sus sesiones abiertas dejan de servir al instante.`, textoOk: nuevo === "INACTIVO" ? "Desactivar" : "Suspender", peligro: true });
      if (!acepta) return;
    }
    try {
      await llamar("PUT", `/usuarios/${u.id}`, { json: { estado: nuevo } });
      toast("success", `${u.nombre}: ${nuevo.toLowerCase()}.`);
      cargar();
    } catch (e) {
      avisarError(e);
    }
  }

  const menuFila = (u) => [
    { encabezado: u.correo },
    u.estado === "ACTIVO" && itemMenu({ texto: "Suspender", icono: "slash-circle", permiso: "USER_MANAGE", alPulsar: () => cambiarEstado(u, "SUSPENDIDO") }),
    itemMenu({ texto: "Restablecer contraseña", icono: "key", permiso: "USER_MANAGE", alPulsar: () => abrirFormularioUsuario({ usuario: u, restablecer: true, alGuardar: cargar }) }),
    { texto: "Copiar correo", icono: "clipboard", alPulsar: async () => toast((await copiar(u.correo)) ? "success" : "warning", "Correo copiado.") },
  ];

  function pintar() {
    if (datos.usuarios.length === 0) {
      resultados.replaceChildren(vacio({ icono: "people", titulo: "Ningún usuario coincide", texto: "Prueba con otros filtros." }));
    } else {
      const filas = datos.usuarios.map((u) => {
        const propio = u.id === estado.sesion.usuario.id;
        return h(
          "tr",
          {},
          h("td", {}, h("span", { class: "persona" }, avatar(u.nombre, "md"), h("span", {}, h("strong", { class: "d-block" }, u.nombre, propio && chip("tú", { color: "primary" })), h("small", { class: "text-secondary" }, u.correo)))),
          h("td", {}, insigniaRol(u.rol)),
          h("td", {}, u.departamento),
          h("td", {}, medidorNivel(u.nivel_seguridad)),
          h("td", {}, u.pais),
          h("td", {}, celdaContrato(u)),
          h("td", {}, insigniaEstadoUsuario(u.estado)),
          h(
            "td",
            { class: "text-end text-nowrap" },
            botonAccion({ texto: "Editar", icono: "pencil", permiso: "USER_MANAGE", soloIcono: true, alPulsar: () => abrirFormularioUsuario({ usuario: u, alGuardar: cargar }) }),
            botonAccion({ texto: u.estado === "ACTIVO" ? "Desactivar" : "Activar", icono: u.estado === "ACTIVO" ? "person-dash" : "person-check", permiso: "USER_MANAGE", soloIcono: true, alPulsar: () => cambiarEstado(u, u.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO") }),
            h("button", { type: "button", class: "btn btn-outline-secondary btn-sm btn-icono", "aria-label": "Más acciones", title: "Más acciones", onclick: (ev) => abrirMenu(ev.currentTarget, menuFila(u)) }, icono("three-dots")),
          ),
        );
      });
      resultados.replaceChildren(h("div", { class: "tabla-contenedor" }, h("table", { class: "table tabla-sd align-middle mb-0" }, h("thead", {}, h("tr", {}, ["Usuario", "Rol", "Departamento", "Nivel", "País", "Contrato", "Estado", ""].map((t) => h("th", {}, t)))), h("tbody", {}, filas))));
    }
    const paginas = Math.max(1, Math.ceil(datos.total / datos.limite));
    pie.replaceChildren(h("div", { class: "pie-contenido" }, h("span", { class: "text-secondary small" }, plural(datos.total, "usuario", "usuarios")), paginas > 1 && paginador(datos.pagina, paginas, (p) => ((filtros.pagina = p), cargar()))));
  }

  raiz.append(
    cabeceraPagina({
      emoji: "👥",
      titulo: "Usuarios",
      texto: "Cuentas, roles y los atributos que las políticas leen: departamento, nivel, país y contrato.",
      tono: "morado",
      ilustracion: ilustracion("usuario", 84),
      acciones: [h("button", { type: "button", class: "btn btn-outline-light", "aria-label": "Actualizar la lista", title: "Actualizar", onclick: cargar }, icono("arrow-clockwise")), botonAccion({ texto: "Nuevo usuario", icono: "person-plus", permiso: "USER_MANAGE", variante: "light", tam: "md", alPulsar: () => abrirFormularioUsuario({ alGuardar: cargar }) })],
    }),
    h("div", { class: "mb-3" }, panelFiltros),
    resultados,
    pie,
  );
  await cargar();
}
