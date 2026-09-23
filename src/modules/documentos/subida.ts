import type { Request, Response } from "express";
import multer from "multer";
import { TAMANO_MAXIMO } from "../../storage/limites";

// El archivo se guarda en memoria (máx. 10 MB): hace falta el contenido completo para comprobar
// su firma, calcular el SHA-256 y subirlo a MinIO. Los límites protegen la memoria del servidor.
const cargador = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO, files: 1, fields: 20, fieldSize: 64 * 1024, parts: 25 },
}).single("archivo");

/**
 * Si la petición es multipart/form-data, deja los campos de texto en `req.body` y el archivo (campo
 * "archivo") en `req.file`. Si es JSON u otra cosa, no hace nada. Errores: `MulterError`.
 */
export function leerMultipart(req: Request, res: Response): Promise<void> {
  if (!req.is("multipart/form-data")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    cargador(req, res, (err: unknown) => (err ? reject(err) : resolve()));
  });
}

/** Los navegadores mandan el nombre en UTF-8 y multer lo lee como latin1: se recompone ("Ã±" -> "ñ"). */
export function nombreDeArchivo(nombreLeido: string): string {
  const utf8 = Buffer.from(nombreLeido, "latin1").toString("utf8");
  return utf8.includes("�") ? nombreLeido : utf8;
}

export interface ArchivoSubido {
  nombreOriginal: string;
  contenido: Buffer;
}

export function archivoSubido(req: Request): ArchivoSubido | undefined {
  const f = req.file;
  return f ? { nombreOriginal: nombreDeArchivo(f.originalname), contenido: f.buffer } : undefined;
}
