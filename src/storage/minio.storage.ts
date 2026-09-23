import type { Client } from "minio";
import type { Readable } from "node:stream";
import { AppError } from "../errors";
import { ArchivoNoEncontrado, type StorageService } from "./storage.service";

const ERRORES_DE_RED = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"]);

function codigoDe(e: unknown): string | undefined {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const codigo = err?.code ?? err?.cause?.code;
  return typeof codigo === "string" ? codigo : undefined;
}

/** Si MinIO no responde, el cliente recibe un 503 claro en vez de un 500 genérico. */
function traducir(e: unknown): never {
  const codigo = codigoDe(e);
  if (codigo && ERRORES_DE_RED.has(codigo)) {
    console.error("[storage] MinIO no responde:", codigo);
    throw AppError.almacenamientoNoDisponible();
  }
  throw e;
}

export class MinioStorage implements StorageService {
  constructor(
    private readonly cliente: Client,
    private readonly bucket: string,
  ) {}

  async guardar(clave: string, contenido: Buffer, mime: string): Promise<void> {
    try {
      await this.cliente.putObject(this.bucket, clave, contenido, contenido.length, { "Content-Type": mime });
    } catch (e) {
      traducir(e);
    }
  }

  async leer(clave: string): Promise<Readable> {
    try {
      return await this.cliente.getObject(this.bucket, clave);
    } catch (e) {
      if (codigoDe(e) === "NoSuchKey") throw new ArchivoNoEncontrado(clave);
      return traducir(e);
    }
  }

  async eliminar(clave: string): Promise<void> {
    try {
      await this.cliente.removeObject(this.bucket, clave);
    } catch (e) {
      traducir(e);
    }
  }

  async asegurarContenedor(): Promise<void> {
    if (!(await this.cliente.bucketExists(this.bucket))) {
      await this.cliente.makeBucket(this.bucket); // los buckets de MinIO nacen privados
    }
  }
}
