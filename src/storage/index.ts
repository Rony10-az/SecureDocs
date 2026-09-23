import { Client } from "minio";
import { config } from "../config";
import { MinioStorage } from "./minio.storage";
import type { StorageService } from "./storage.service";

// Crear el cliente no abre ninguna conexión; recién se conecta al guardar/leer.
export const storage: StorageService = new MinioStorage(
  new Client({
    endPoint: config.MINIO_ENDPOINT,
    port: config.MINIO_PORT,
    useSSL: config.MINIO_USE_SSL,
    accessKey: config.MINIO_ROOT_USER,
    secretKey: config.MINIO_ROOT_PASSWORD,
  }),
  config.MINIO_BUCKET,
);

export type { StorageService } from "./storage.service";
export { ArchivoNoEncontrado } from "./storage.service";
