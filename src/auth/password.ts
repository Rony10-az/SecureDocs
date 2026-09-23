import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * Costo de bcrypt: UNO solo para todo el sistema (seed, altas, cambios y el hash "falso" del login).
 * Si el login comparara contra un hash de otro costo, la diferencia de tiempo delataría qué correos existen.
 */
export const COSTO_BCRYPT = 10;

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, COSTO_BCRYPT);

/**
 * Política de contraseñas para las que se DEFINEN (alta de usuario y restablecimiento).
 * El login no la exige: solo verifica lo que ya está guardado.
 *  - 10 caracteres como mínimo y 72 bytes como máximo (bcrypt ignora en silencio lo que pase de 72 bytes)
 *  - mayúsculas, minúsculas y números
 */
export const passwordNuevaSchema = z
  .string({ error: "La contraseña es obligatoria" })
  .min(10, "La contraseña debe tener al menos 10 caracteres")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "La contraseña admite hasta 72 bytes (límite de bcrypt)")
  .refine(
    (p) => /\p{Ll}/u.test(p) && /\p{Lu}/u.test(p) && /\p{Nd}/u.test(p),
    "La contraseña debe incluir mayúsculas, minúsculas y números",
  );
