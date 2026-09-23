import { Router } from "express";
import { pipeline } from "node:stream/promises";
import { usuarioActual } from "../../auth/authenticate";
import { authorize, authorizeLista } from "../../authorization/authorize";
import { contentDispositionAttachment, validarArchivo } from "../../storage/archivo";
import {
  actualizarDocumentoSchema,
  decisionSchema,
  listaDocumentosSchema,
} from "./documentos.schemas";
import { cargarCandidato, cargarDocumento, idDelRecurso, type DatosCreacion } from "./documentos.recurso";
import {
  abrirArchivo,
  actualizarDocumento,
  crearDocumento,
  decidirDocumento,
  eliminarDocumento,
  listarDocumentos,
  obtenerDocumento,
  serializarDocumento,
  type ArchivoParaGuardar,
} from "./documentos.service";
import { archivoSubido, leerMultipart } from "./subida";
import type { Request } from "express";

export const documentosRouter = Router();

// Documentos privados: que ningún navegador ni proxy guarde copias
documentosRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/** Si la petición trae archivo: valida tipo real, tamaño y hash. Se llama DESPUÉS de autorizar. */
function archivoValidado(req: Request): ArchivoParaGuardar | undefined {
  const subido = archivoSubido(req);
  return subido ? { ...validarArchivo(subido.nombreOriginal, subido.contenido), contenido: subido.contenido } : undefined;
}

// GET /documentos  ->  solo los documentos que las políticas ABAC permiten leer a este usuario
documentosRouter.get("/", ...authorizeLista("DOC_READ"), async (req, res) => {
  const filtros = listaDocumentosSchema.parse(req.query);
  res.json(await listarDocumentos({ usuario: usuarioActual(req), entorno: req.entorno }, filtros));
});

// POST /documentos  (multipart: metadatos + archivo; también acepta JSON sin archivo)
documentosRouter.post("/", ...authorize("DOC_CREATE", cargarCandidato), async (req, res) => {
  const datos = res.locals.creacion as DatosCreacion;
  const creado = await crearDocumento(usuarioActual(req).id, datos, archivoValidado(req));
  res.status(201).location(`/documentos/${creado.id}`).json(serializarDocumento(creado));
});

// GET /documentos/:id  ->  metadatos (sin el contenido del archivo)
documentosRouter.get("/:id", ...authorize("DOC_READ", cargarDocumento), async (req, res) => {
  res.json(serializarDocumento(await obtenerDocumento(idDelRecurso(req))));
});

// PUT /documentos/:id  ->  título, descripción, archivo nuevo y/o enviar a aprobación
documentosRouter.put("/:id", ...authorize("DOC_UPDATE", cargarDocumento), async (req, res) => {
  await leerMultipart(req, res);
  const dto = actualizarDocumentoSchema.parse(req.body ?? {});
  const actualizado = await actualizarDocumento(idDelRecurso(req), dto, archivoValidado(req));
  res.json(serializarDocumento(actualizado));
});

// DELETE /documentos/:id  ->  borrado lógico (papelera)
documentosRouter.delete("/:id", ...authorize("DOC_DELETE", cargarDocumento), async (req, res) => {
  await eliminarDocumento(idDelRecurso(req));
  res.status(204).end();
});

// POST /documentos/:id/aprobar  ->  { "decision": "APROBAR" | "RECHAZAR" } (sin cuerpo = aprobar)
documentosRouter.post("/:id/aprobar", ...authorize("DOC_APPROVE", cargarDocumento), async (req, res) => {
  const { decision } = decisionSchema.parse(req.body ?? {});
  res.json(serializarDocumento(await decidirDocumento(idDelRecurso(req), usuarioActual(req).id, decision)));
});

// GET /documentos/:id/archivo  ->  el ÚNICO camino por el que sale un archivo: autorizado, auditado y transmitido desde MinIO
documentosRouter.get("/:id/archivo", ...authorize("DOC_DOWNLOAD", cargarDocumento), async (req, res) => {
  const archivo = await abrirArchivo(idDelRecurso(req));

  res.setHeader("Content-Disposition", contentDispositionAttachment(archivo.nombre)); // adjunto: nunca se abre "en línea"
  res.setHeader("Content-Type", archivo.mime);
  if (archivo.tamano !== null) res.setHeader("Content-Length", String(archivo.tamano));
  if (archivo.sha256) res.setHeader("X-Content-SHA256", archivo.sha256); // para que el cliente verifique la integridad

  try {
    await pipeline(archivo.stream, res);
  } catch (e) {
    // El cliente cortó la descarga a la mitad: no es un error del servidor
    if ((e as { code?: string }).code !== "ERR_STREAM_PREMATURE_CLOSE") throw e;
  }
});
