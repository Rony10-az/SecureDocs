import { z } from "zod";
import { passwordNuevaSchema } from "../../auth/password";

const nombre = z
  .string({ error: "El nombre es obligatorio" })
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres")
  .max(100, "El nombre admite hasta 100 caracteres");

// Se normaliza (espacios y mayúsculas) antes de validar el formato, igual que en el login
const correo = z
  .string({ error: "El correo es obligatorio" })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Ingrese un correo válido" }));

const nombreRol = z.string({ error: "El rol es obligatorio" }).trim().toUpperCase().min(1, "El rol es obligatorio").max(30);
const codigoDepartamento = z
  .string({ error: "El departamento es obligatorio" })
  .trim()
  .toUpperCase()
  .min(1, "El departamento es obligatorio")
  .max(30);

const nivelSeguridad = z.coerce
  .number({ error: "El nivel de seguridad es obligatorio (1 a 5)" })
  .int("El nivel debe ser un número entero")
  .min(1, "El nivel mínimo es 1")
  .max(5, "El nivel máximo es 5");

const pais = z.string().trim().min(1, "El país no puede estar vacío").max(40);
const tipoContrato = z.enum(["INTERNO", "EXTERNO"], { error: "El tipo de contrato debe ser INTERNO o EXTERNO" });
const estado = z.enum(["ACTIVO", "INACTIVO", "SUSPENDIDO"], { error: "El estado debe ser ACTIVO, INACTIVO o SUSPENDIDO" });
const fechaExpiracion = z.iso.date({ error: "Use el formato AAAA-MM-DD" });

/**
 * POST /usuarios. `strictObject`: un campo que no esté aquí (id, password_hash, creado_en...) se RECHAZA
 * en vez de ignorarse, para que nadie intente colar datos que solo el sistema debe decidir.
 */
export const crearUsuarioSchema = z.strictObject({
  nombre,
  correo,
  password: passwordNuevaSchema,
  rol: nombreRol,
  departamento: codigoDepartamento,
  nivel_seguridad: nivelSeguridad,
  /** Si se omite: PERU */
  pais: pais.optional(),
  tipo_contrato: tipoContrato.default("INTERNO"),
  estado: estado.default("ACTIVO"),
  /** Obligatoria para EXTERNO, no admitida para INTERNO (la regla la aplica `resolverContrato`) */
  fecha_expiracion: fechaExpiracion.nullable().optional(),
});

/** PUT /usuarios/:id: todo es opcional. `password` restablece la contraseña; `fecha_expiracion: null` la borra. */
export const actualizarUsuarioSchema = z.strictObject({
  nombre: nombre.optional(),
  correo: correo.optional(),
  password: passwordNuevaSchema.optional(),
  rol: nombreRol.optional(),
  departamento: codigoDepartamento.optional(),
  nivel_seguridad: nivelSeguridad.optional(),
  pais: pais.optional(),
  tipo_contrato: tipoContrato.optional(),
  estado: estado.optional(),
  fecha_expiracion: fechaExpiracion.nullable().optional(),
});

/** GET /usuarios */
export const listaUsuariosSchema = z.object({
  q: z.string().trim().max(100).optional(),
  rol: nombreRol.optional(),
  departamento: codigoDepartamento.optional(),
  estado: estado.optional(),
  tipo_contrato: tipoContrato.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

export type CrearUsuarioDto = z.infer<typeof crearUsuarioSchema>;
export type ActualizarUsuarioDto = z.infer<typeof actualizarUsuarioSchema>;
export type ListaUsuariosDto = z.infer<typeof listaUsuariosSchema>;
