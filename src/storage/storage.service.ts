import type { Readable } from "node:stream";

/** El objeto no está en el almacenamiento (aunque la BD diga que debería). */
export class ArchivoNoEncontrado extends Error {
  constructor(clave: string) {
    super(`No existe el objeto ${clave} en el almacenamiento`);
    this.name = "ArchivoNoEncontrado";
  }
}

/**
 * Contrato del almacenamiento de archivos. Hoy lo implementa MinIO; pasar a AWS S3 real (o a un
 * volumen local, "plan B" de la guía) es cambiar la implementación, no el resto de la aplicación.
 * Las claves son UUID generados por nosotros: nunca un nombre que venga del usuario.
 */
export interface StorageService {
  guardar(clave: string, contenido: Buffer, mime: string): Promise<void>;
  /** Contenido como flujo. Lanza `ArchivoNoEncontrado` si no existe. */
  leer(clave: string): Promise<Readable>;
  /** Borra el objeto; si ya no existe no es un error. */
  eliminar(clave: string): Promise<void>;
  /** Comprueba que el contenedor (bucket) exista y, si no, lo crea PRIVADO. */
  asegurarContenedor(): Promise<void>;
}
