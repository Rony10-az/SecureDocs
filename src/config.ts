import "dotenv/config";
import { z } from "zod";

// Mensajes de validación en español (afecta a todos los esquemas zod de la app)
z.config(z.locales.es());

const zonaValida = (zona: string) => {
  try {
    new Intl.DateTimeFormat("es", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
};

const esquema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("1h"),
  // Zona en la que se evalúan hora y fecha de las políticas (P4, P9)
  ZONA_HORARIA: z.string().default("America/Lima").refine(zonaValida, "Zona horaria inválida (ej. America/Lima)"),
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

if (resultado.data.NODE_ENV === "production" && resultado.data.JWT_SECRET.startsWith("cambia-esto")) {
  console.error("JWT_SECRET sigue con el valor de ejemplo: cámbialo antes de usar producción.");
  process.exit(1);
}

export const config = resultado.data;
