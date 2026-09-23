import bcrypt from "bcryptjs";
import type { UsuarioCtx } from "../context/tipos";
import { incluirRelaciones, usuarioDesdeBD } from "../context/usuario";
import { prisma } from "../db";
import { COSTO_BCRYPT } from "./password";

// Se compara contra este hash cuando el correo no existe: así la respuesta tarda lo mismo
// que con un correo real y no se puede averiguar qué cuentas existen midiendo tiempos.
// Por eso usa el MISMO costo que las contraseñas reales (COSTO_BCRYPT).
const HASH_FALSO = bcrypt.hashSync("contraseña-inexistente", COSTO_BCRYPT);

export type ResultadoLogin =
  | { ok: true; usuario: UsuarioCtx }
  /** `usuarioId` es la cuenta a la que se apuntó (si existe): solo para la auditoría, nunca se le dice al cliente */
  | { ok: false; usuarioId: number | null };

/**
 * Verifica correo + contraseña. Solo AUTENTICA (¿quién eres?).
 *
 * A propósito NO mira `estado` ni la expiración: un usuario INACTIVO o un invitado vencido
 * sí puede iniciar sesión, y luego `authorize` lo deniega con P7 / P9 y lo deja en auditoría.
 * (Si el login lo rechazara, los casos de prueba 8 y 14 no dejarían rastro.)
 *
 * No lanza error en caso de fallo: devuelve el resultado para que la ruta lo audite y luego responda.
 */
export async function autenticar(correo: string, password: string): Promise<ResultadoLogin> {
  const u = await prisma.usuario.findUnique({ where: { correo }, include: incluirRelaciones });
  const coincide = await bcrypt.compare(password, u?.password_hash ?? HASH_FALSO);
  if (!u || !coincide) return { ok: false, usuarioId: u?.id ?? null };
  return { ok: true, usuario: usuarioDesdeBD(u) };
}
