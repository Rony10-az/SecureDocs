import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { autorizador } from "../../authorization/servicios";
import type { ContextoBase } from "../../authorization/tipos";
import { clock } from "../../context/clock";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { ArchivoValidado } from "../../storage/archivo";
import { ArchivoNoEncontrado, storage } from "../../storage";
import { recursoDesdeDocumento, type DatosCreacion } from "./documentos.recurso";
import { estadoTrasDecision, estadoTrasEditar } from "./documentos.estado";
import type { ActualizarDocumentoDto, Decision, ListaDocumentosDto } from "./documentos.schemas";

const incluirCompleto = {
  departamento: true,
  propietario: { select: { id: true, nombre: true } },
  aprobador: { select: { id: true, nombre: true } },
} satisfies Prisma.DocumentoInclude;

export type DocumentoCompleto = Prisma.DocumentoGetPayload<{ include: typeof incluirCompleto }>;

/** Archivo ya validado (tipo, tamaño, hash) junto con su contenido, listo para guardar. */
export type ArchivoParaGuardar = ArchivoValidado & { contenido: Buffer };

/** Lo que devuelve la API de un documento. No incluye la clave interna del archivo ni datos personales de más. */
export function serializarDocumento(d: DocumentoCompleto) {
  return {
    id: d.id,
    titulo: d.titulo,
    descripcion: d.descripcion,
    departamento: d.departamento.codigo,
    nivel_confidencialidad: d.nivel_confidencialidad,
    estado: d.estado,
    pais: d.pais,
    propietario: d.propietario,
    fecha_creacion: d.fecha_creacion.toISOString(),
    aprobado_por: d.aprobador,
    fecha_aprobacion: d.fecha_aprobacion ? d.fecha_aprobacion.toISOString() : null,
    archivo: d.archivo_clave
      ? { nombre: d.archivo_nombre_original, mime: d.archivo_mime, tamano: d.archivo_tamano, sha256: d.archivo_sha256 }
      : null,
  };
}

const huerfano = (clave: string) => (e: unknown) =>
  console.error(`[storage] No se pudo borrar el objeto ${clave} (queda huérfano en el bucket):`, e);

async function buscarCompleto(id: number): Promise<DocumentoCompleto> {
  const d = await prisma.documento.findFirst({ where: { id, eliminado_en: null }, include: incluirCompleto });
  if (!d) throw AppError.noEncontrado("Documento no encontrado");
  return d;
}

export const obtenerDocumento = buscarCompleto;

/**
 * GET /documentos: cada documento se pasa por las políticas ABAC como DOC_READ y solo se devuelven
 * los que el usuario puede leer (las políticas se leen una sola vez para todos). El total cuenta solo
 * lo visible: no se filtra cuántos documentos existen en total.
 */
export async function listarDocumentos(base: ContextoBase, f: ListaDocumentosDto) {
  const where: Prisma.DocumentoWhereInput = { eliminado_en: null };
  if (f.q) where.titulo = { contains: f.q, mode: "insensitive" };
  if (f.estado) where.estado = f.estado;
  if (f.departamento) where.departamento = { codigo: f.departamento };

  const documentos = await prisma.documento.findMany({
    where,
    include: incluirCompleto,
    orderBy: [{ fecha_creacion: "desc" }, { id: "desc" }],
  });
  const decisiones = await autorizador.decidirAbacLote(base, "DOC_READ", documentos.map(recursoDesdeDocumento));
  const visibles = documentos.filter((_, i) => decisiones[i].permitido);

  const desde = (f.pagina - 1) * f.limite;
  return {
    total: visibles.length,
    pagina: f.pagina,
    limite: f.limite,
    documentos: visibles.slice(desde, desde + f.limite).map(serializarDocumento),
  };
}

export async function crearDocumento(usuarioId: number, datos: DatosCreacion, archivo?: ArchivoParaGuardar) {
  const { dto } = datos;
  if (dto.enviar && !archivo) throw AppError.validacion("Para enviar a aprobación debe adjuntar el archivo");

  // Primero el objeto en MinIO y luego la fila; si la fila falla, se borra el objeto (no quedan huérfanos)
  const clave = archivo ? randomUUID() : null;
  if (archivo && clave) await storage.guardar(clave, archivo.contenido, archivo.mime);
  try {
    const creado = await prisma.documento.create({
      data: {
        titulo: dto.titulo,
        descripcion: dto.descripcion || null,
        propietario_id: usuarioId,
        departamento_id: datos.departamentoId,
        nivel_confidencialidad: dto.nivel_confidencialidad,
        estado: dto.enviar ? "PENDIENTE" : "BORRADOR",
        pais: datos.pais,
        ...(archivo && {
          archivo_clave: clave,
          archivo_nombre_original: archivo.nombre,
          archivo_mime: archivo.mime,
          archivo_tamano: archivo.tamano,
          archivo_sha256: archivo.sha256,
        }),
      },
      include: incluirCompleto,
    });
    return creado;
  } catch (e) {
    if (clave) await storage.eliminar(clave).catch(huerfano(clave));
    throw e;
  }
}

export async function actualizarDocumento(id: number, dto: ActualizarDocumentoDto, archivo?: ArchivoParaGuardar) {
  const actual = await buscarCompleto(id);

  const datos: Prisma.DocumentoUncheckedUpdateManyInput = {};
  let hayCambios = false;
  if (dto.titulo !== undefined && dto.titulo !== actual.titulo) {
    datos.titulo = dto.titulo;
    hayCambios = true;
  }
  if (dto.descripcion !== undefined && (dto.descripcion || null) !== actual.descripcion) {
    datos.descripcion = dto.descripcion || null;
    hayCambios = true;
  }
  if (archivo) hayCambios = true;

  const enviar = dto.enviar ?? false;
  if (!hayCambios && !enviar) throw AppError.validacion("No hay nada que actualizar");

  const estado = estadoTrasEditar(actual.estado, { hayCambios, enviar, tieneArchivo: Boolean(archivo || actual.archivo_clave) });
  if (estado !== actual.estado) {
    datos.estado = estado;
    // Lo que estaba publicado deja de estarlo: la aprobación era sobre el contenido anterior
    if (actual.estado === "PUBLICADO") Object.assign(datos, { aprobado_por: null, fecha_aprobacion: null });
  }

  // Archivo nuevo: se sube con clave nueva; el anterior se borra recién cuando la BD ya lo reemplazó
  const claveNueva = archivo ? randomUUID() : null;
  if (archivo && claveNueva) {
    await storage.guardar(claveNueva, archivo.contenido, archivo.mime);
    Object.assign(datos, {
      archivo_clave: claveNueva,
      archivo_nombre_original: archivo.nombre,
      archivo_mime: archivo.mime,
      archivo_tamano: archivo.tamano,
      archivo_sha256: archivo.sha256,
    });
  }

  try {
    // "estado: actual.estado" = control de concurrencia: si alguien lo cambió mientras tanto, no se pisa
    const { count } = await prisma.documento.updateMany({ where: { id, eliminado_en: null, estado: actual.estado }, data: datos });
    if (count === 0) throw AppError.conflicto("El documento cambió mientras lo editaba; vuelva a intentarlo");
  } catch (e) {
    if (claveNueva) await storage.eliminar(claveNueva).catch(huerfano(claveNueva));
    throw e;
  }
  if (claveNueva && actual.archivo_clave) await storage.eliminar(actual.archivo_clave).catch(huerfano(actual.archivo_clave));

  return buscarCompleto(id);
}

/** Borrado lógico: el documento pasa a la papelera (eliminado_en); el archivo queda en el bucket. */
export async function eliminarDocumento(id: number): Promise<void> {
  const { count } = await prisma.documento.updateMany({
    where: { id, eliminado_en: null },
    data: { eliminado_en: clock.ahora() },
  });
  if (count === 0) throw AppError.noEncontrado("Documento no encontrado");
}

/** Aprobar o rechazar un documento PENDIENTE. */
export async function decidirDocumento(id: number, usuarioId: number, decision: Decision) {
  const actual = await buscarCompleto(id);
  const nuevo = estadoTrasDecision(actual.estado, decision);

  const { count } = await prisma.documento.updateMany({
    where: { id, eliminado_en: null, estado: "PENDIENTE" }, // dos aprobadores a la vez: gana uno, el otro recibe 409
    data:
      nuevo === "PUBLICADO"
        ? { estado: nuevo, aprobado_por: usuarioId, fecha_aprobacion: clock.ahora() }
        : { estado: nuevo, aprobado_por: null, fecha_aprobacion: null },
  });
  if (count === 0) throw AppError.conflicto("El documento ya no está pendiente de aprobación");

  return buscarCompleto(id);
}

export interface ArchivoParaDescargar {
  stream: Readable;
  nombre: string;
  mime: string;
  tamano: number | null;
  sha256: string | null;
}

/** Abre el archivo del documento como flujo. La autorización (DOC_DOWNLOAD) ya la resolvió `authorize`. */
export async function abrirArchivo(id: number): Promise<ArchivoParaDescargar> {
  const d = await prisma.documento.findFirst({
    where: { id, eliminado_en: null },
    select: { archivo_clave: true, archivo_nombre_original: true, archivo_mime: true, archivo_tamano: true, archivo_sha256: true },
  });
  if (!d?.archivo_clave) throw AppError.noEncontrado("El documento no tiene archivo adjunto");

  try {
    return {
      stream: await storage.leer(d.archivo_clave),
      nombre: d.archivo_nombre_original ?? "documento",
      mime: d.archivo_mime ?? "application/octet-stream",
      tamano: d.archivo_tamano,
      sha256: d.archivo_sha256,
    };
  } catch (e) {
    if (e instanceof ArchivoNoEncontrado) {
      // La BD dice que hay archivo pero el bucket no lo tiene: es un problema de integridad, no del usuario
      console.error(`[storage] Documento ${id}: ${e.message}`);
      throw new AppError(404, "ARCHIVO_NO_DISPONIBLE", "El archivo no está disponible en el almacenamiento");
    }
    throw e;
  }
}
