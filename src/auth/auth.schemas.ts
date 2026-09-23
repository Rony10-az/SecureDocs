import { z } from "zod";

export const loginSchema = z.object({
  // Se normaliza (espacios y mayúsculas) antes de validar el formato del correo
  correo: z
    .string({ error: "El correo es obligatorio" })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Ingrese un correo válido" })),
  // Tope de longitud: evita que alguien mande megabytes al hash de bcrypt
  password: z
    .string({ error: "La contraseña es obligatoria" })
    .min(1, "La contraseña es obligatoria")
    .max(128, "La contraseña es demasiado larga"),
});

export type LoginDto = z.infer<typeof loginSchema>;
