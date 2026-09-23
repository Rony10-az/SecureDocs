/**
 * Validación de archivos subidos (sección 9 de la guía): solo PDF, DOCX, XLSX, PNG y JPG,
 * máximo 10 MB, y el tipo se decide por el CONTENIDO (firma / "magic bytes"), no por la extensión
 * ni por el Content-Type que declare el cliente.
 *
 * Se hace a mano, sin la librería `file-type`: `npm audit` reporta un bucle infinito en su parser
 * ASF con entrada mal formada, y aquí el contenido lo controla el usuario. Este código solo mira
 * unos pocos bytes conocidos y recorre el directorio del ZIP con límites, nunca descomprime nada.
 */
import { createHash } from "node:crypto";
import { AppError } from "../errors";
import { TAMANO_MAXIMO } from "./limites";

export type Extension = "pdf" | "png" | "jpg" | "docx" | "xlsx";

export const MIME: Record<Extension, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const MENSAJE_TIPOS = "Tipo de archivo no permitido: solo se aceptan PDF, DOCX, XLSX, PNG y JPG";

const empieza = (buf: Buffer, firma: number[]) => buf.length >= firma.length && firma.every((byte, i) => buf[i] === byte);

// --- ZIP (DOCX y XLSX son ZIP con partes conocidas) ---------------------------------------------
const FIRMA_EOCD = 0x06054b50; // fin del directorio central
const FIRMA_ENTRADA = 0x02014b50; // entrada del directorio central
const MAX_ENTRADAS = 10_000;

/**
 * Nombres de las entradas de un ZIP leyendo su directorio central. Devuelve null si el ZIP está
 * mal formado, es ZIP64 o no cabe en el buffer: ante la duda, no es un Office válido.
 */
function nombresDelZip(buf: Buffer): string[] | null {
  // El registro EOCD mide 22 bytes + un comentario de hasta 65535: se busca hacia atrás desde el final
  const limite = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= limite; i--) {
    if (buf.readUInt32LE(i) === FIRMA_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entradas = buf.readUInt16LE(eocd + 10);
  const tamanoDirectorio = buf.readUInt32LE(eocd + 12);
  const inicioDirectorio = buf.readUInt32LE(eocd + 16);
  if (entradas === 0xffff || tamanoDirectorio === 0xffffffff || inicioDirectorio === 0xffffffff) return null; // ZIP64
  if (entradas > MAX_ENTRADAS || inicioDirectorio + tamanoDirectorio > eocd) return null;

  const nombres: string[] = [];
  let p = inicioDirectorio;
  for (let n = 0; n < entradas; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== FIRMA_ENTRADA) return null;
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const finNombre = p + 46 + largoNombre;
    if (finNombre > buf.length) return null;
    nombres.push(buf.toString("utf8", p + 46, finNombre));
    p = finNombre + largoExtra + largoComentario;
  }
  return nombres;
}

function tipoOffice(buf: Buffer): "docx" | "xlsx" | null {
  const nombres = nombresDelZip(buf);
  if (!nombres || !nombres.includes("[Content_Types].xml")) return null; // todo Office (OOXML) lo trae
  const esWord = nombres.includes("word/document.xml");
  const esExcel = nombres.includes("xl/workbook.xml");
  if (esWord === esExcel) return null; // ninguno de los dos, o ambos (ambiguo): se rechaza
  return esWord ? "docx" : "xlsx";
}

/** Tipo real según el contenido, o null si no es uno de los cinco permitidos. */
export function detectarTipo(contenido: Buffer): Extension | null {
  if (empieza(contenido, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (empieza(contenido, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (empieza(contenido, [0xff, 0xd8, 0xff])) return "jpg";
  if (empieza(contenido, [0x50, 0x4b, 0x03, 0x04])) return tipoOffice(contenido); // PK\x03\x04
  return null;
}

// --- Nombre del archivo -------------------------------------------------------------------------
function extensionDe(nombre: string): string {
  const base = nombre.replace(/^.*[\\/]/, "");
  const punto = base.lastIndexOf(".");
  return punto > 0 ? base.slice(punto + 1).toLowerCase() : "";
}

/**
 * Nombre para mostrar y para el header de descarga: sin rutas, sin caracteres de control ni
 * prohibidos (evita path traversal y inyección de headers) y con la extensión REAL del contenido.
 */
export function nombreSeguro(nombreOriginal: string, extension: Extension): string {
  const base = nombreOriginal
    .replace(/^.*[\\/]/, "") // sin carpetas: "..\..\x.pdf" -> "x.pdf"
    .replace(/\.[^.]*$/, "") // sin la extensión que dijo el usuario
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"*/:<>?\\|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return `${(base || "documento").slice(0, 120)}.${extension}`;
}

/**
 * Header Content-Disposition para descargar como adjunto (nunca "inline": el navegador no abre ni
 * ejecuta nada). El nombre va en dos formas (RFC 6266): un respaldo solo ASCII para clientes viejos y
 * `filename*` en UTF-8 con porcentajes para los modernos. Nunca produce saltos de línea ni comillas.
 */
export function contentDispositionAttachment(nombre: string): string {
  const ascii = nombre.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(nombre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export interface ArchivoValidado {
  extension: Extension;
  mime: string;
  /** Nombre ya saneado, listo para guardar y mostrar */
  nombre: string;
  tamano: number;
  sha256: string;
}

/**
 * Comprueba tamaño, tipo real y coherencia con la extensión. Lanza 400 / 413 / 415 si no pasa.
 * El MIME que se guarda es el detectado, jamás el que declaró el cliente.
 */
export function validarArchivo(nombreOriginal: string, contenido: Buffer): ArchivoValidado {
  if (contenido.length === 0) throw AppError.validacion("El archivo está vacío");
  if (contenido.length > TAMANO_MAXIMO) throw AppError.archivoMuyGrande();

  const extension = detectarTipo(contenido);
  if (!extension) throw AppError.tipoNoPermitido(MENSAJE_TIPOS);

  const declarada = extensionDe(nombreOriginal);
  const coincide = declarada === extension || (extension === "jpg" && declarada === "jpeg");
  if (!coincide) {
    const etiqueta = declarada ? `".${declarada}"` : "(ninguna)";
    throw AppError.tipoNoPermitido(
      `La extensión ${etiqueta} no coincide con el contenido real del archivo (${extension.toUpperCase()})`,
    );
  }

  return {
    extension,
    mime: MIME[extension],
    nombre: nombreSeguro(nombreOriginal, extension),
    tamano: contenido.length,
    sha256: createHash("sha256").update(contenido).digest("hex"),
  };
}
