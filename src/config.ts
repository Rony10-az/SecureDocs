import "dotenv/config";
import { z } from "zod";

const esquema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("1h"),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z.string().default("false").transform((v) => v === "true"),
  MINIO_ROOT_USER: z.string().min(1),
  MINIO_ROOT_PASSWORD: z.string().min(8),
  MINIO_BUCKET: z.string().min(1),
});

const resultado = esquema.safeParse(process.env);
if (!resultado.success) {
  console.error("Variables de entorno inválidas:", resultado.error.issues);
  process.exit(1);
}

export const config = resultado.data;
