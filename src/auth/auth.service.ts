import bcrypt from "bcryptjs";
import type { UsuarioCtx } from "../context/tipos";
import { incluirRelaciones, usuarioDesdeBD } from "../context/usuario";
import { prisma } from "../db";
import { AppError } from "../errors";

// Se compara contra este hash cuando el correo no existe: así la respuesta tarda lo mismo
// que con un correo real y no se puede averiguar qué cuentas existen midiendo tiempos.
const HASH_FALSO = bcrypt.hashSync("contraseña-inexistente", 10);

/**
 * Verifica correo + contraseña. Solo AUTENTICA (¿quién eres?).
 *
 * A propósito NO mira `estado` ni la expiración: un usuario INACTIVO o un invitado vencido
 * sí puede iniciar sesión, y luego `authorize` lo deniega con P7 / P9 y lo deja en auditoría.
 * (Si el login lo rechazara, los casos de prueba 8 y 14 no dejarían rastro.)
 */
export async function autenticar(correo: string, password: string): Promise<UsuarioCtx> {
  const u = await prisma.usuario.findUnique({ where: { correo }, include: incluirRelaciones });
  const coincide = await bcrypt.compare(password, u?.password_hash ?? HASH_FALSO);
  if (!u || !coincide) throw AppError.credencialesInvalidas();
  return usuarioDesdeBD(u);
}
