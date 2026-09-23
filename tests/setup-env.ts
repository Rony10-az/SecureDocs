// Se ejecuta antes de cada archivo de pruebas. Deja las variables mínimas para que `src/config.ts`
// valide, sin depender de que cada máquina tenga el mismo .env.
import { config as cargarEnv } from "dotenv";

process.env.NODE_ENV = "test";
process.env.DOTENV_CONFIG_QUIET = "true";
cargarEnv({ quiet: true }); // lo que haya en .env (si existe); no pisa NODE_ENV

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5434/test";
process.env.JWT_SECRET ??= "secreto-solo-para-pruebas-unitarias";
process.env.MINIO_ENDPOINT ??= "localhost";
process.env.MINIO_ROOT_USER ??= "minioadmin";
process.env.MINIO_ROOT_PASSWORD ??= "minioadmin123";
process.env.MINIO_BUCKET ??= "securedocs";
