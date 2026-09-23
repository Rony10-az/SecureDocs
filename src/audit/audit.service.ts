import type { EtapaAuditoria, PrismaClient, ResultadoAuditoria } from "@prisma/client";
import { prisma } from "../db";

export interface EntradaAuditoria {
  usuarioId: number | null;
  /** Correo con el que se actuó (o se intentó iniciar sesión) */
  usuarioCorreo: string | null;
  /** "documento:5", "auditoria", "sesion"... */
  recurso: string;
  accion: string;
  resultado: ResultadoAuditoria;
  etapa: EtapaAuditoria;
  /** Política que denegó (P1..P10) o null */
  politica: string | null;
  motivo: string;
  ip: string | null;
  ubicacion: string | null;
  dispositivo: string | null;
}

const cortar = (valor: string | null, max: number) => (valor === null ? null : valor.slice(0, max));

/**
 * Escritura de la auditoría. La tabla es inmutable (trigger en la BD): solo se inserta.
 * La fecha la pone la BD (`now()`), no la aplicación.
 */
export class AuditService {
  constructor(private readonly db: Pick<PrismaClient, "auditoria">) {}

  async registrar(e: EntradaAuditoria): Promise<void> {
    await this.db.auditoria.create({
      data: {
        usuario_id: e.usuarioId,
        usuario_correo: cortar(e.usuarioCorreo, 254),
        recurso: cortar(e.recurso, 100) ?? "",
        accion: cortar(e.accion, 50) ?? "",
        resultado: e.resultado,
        etapa: e.etapa,
        politica_codigo: cortar(e.politica, 20),
        motivo: cortar(e.motivo, 500) ?? "",
        ip: cortar(e.ip, 64),
        ubicacion: cortar(e.ubicacion, 40),
        dispositivo: cortar(e.dispositivo, 40),
      },
    });
  }
}

export const audit = new AuditService(prisma);
