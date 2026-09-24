/**
 * Acciones sobre un documento que comparten la lista, el detalle y el panel de inicio. Cada una llama a la API, avisa
 * del resultado y, si el servidor la deniega, muestra por qué (etapa, política y motivo). Devuelven true si salió bien.
 * Los botones dependen solo del ESTADO del documento; el rol es una pista visual y decide el servidor.
 */
import { descargarArchivo, llamar } from "../api.js";
import { avisarError, confirmar, toast } from "../ui.js";

export const puedeEnviar = (d) => d.estado === "BORRADOR" || d.estado === "RECHAZADO";
export const puedeDecidir = (d) => d.estado === "PENDIENTE";

export async function ejecutar(mensaje, accion) {
  try {
    await accion();
    toast("success", mensaje);
    return true;
  } catch (e) {
    avisarError(e);
    return false;
  }
}

export const enviarAprobacion = (d) => ejecutar(`«${d.titulo}» enviado a aprobación.`, () => llamar("PUT", `/documentos/${d.id}`, { json: { enviar: true } }));

export const decidir = (d, decision) =>
  ejecutar(`«${d.titulo}» ${decision === "APROBAR" ? "aprobado y publicado" : "rechazado"}.`, () => llamar("POST", `/documentos/${d.id}/aprobar`, { json: { decision } }));

export async function eliminar(d) {
  const acepta = await confirmar({
    titulo: "Eliminar documento",
    icono: "trash",
    mensaje: `«${d.titulo}» pasará a la papelera (borrado lógico). Su archivo se conserva en el almacenamiento.`,
    textoOk: "Eliminar",
    peligro: true,
  });
  return acepta && ejecutar(`«${d.titulo}» eliminado.`, () => llamar("DELETE", `/documentos/${d.id}`));
}

/** Descarga el archivo y verifica su SHA-256. Devuelve { nombre, integro, bytes } o null si se denegó. */
export async function descargar(d) {
  try {
    const resultado = await descargarArchivo(d.id);
    if (resultado.integro === false) toast("danger", `«${resultado.nombre}» se descargó, pero su SHA-256 NO coincide con el registrado.`, "Integridad");
    else toast("success", `«${resultado.nombre}» descargado${resultado.integro ? " · SHA-256 verificado" : ""}.`);
    return resultado;
  } catch (e) {
    avisarError(e);
    return null;
  }
}
