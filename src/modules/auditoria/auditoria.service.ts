import type { Prisma } from "@prisma/client";
import { DEPARTAMENTO_GLOBAL } from "../../authorization/tipos";
import type { UsuarioCtx } from "../../context/tipos";
import { prisma } from "../../db";
import type { FiltrosAuditoria } from "./auditoria.schemas";

/**
 * Lectura de la auditoría.
 *
 * Alcance: quien es de departamento GLOBAL (ADMIN, AUDITOR) ve todo; el resto solo ve la actividad
 * de los usuarios de SU departamento (p. ej. el GERENTE de FINANZAS ve lo que hace su gente,
 * incluidos sus intentos denegados). Se decide por el atributo "departamento", no por el nombre del rol.
 */
export async function listarAuditoria(solicitante: UsuarioCtx, f: FiltrosAuditoria) {
  const where: Prisma.AuditoriaWhereInput = {};
  if (f.usuario) where.usuario_correo = { contains: f.usuario, mode: "insensitive" };
  if (f.accion) where.accion = f.accion.toUpperCase();
  if (f.resultado) where.resultado = f.resultado;
  if (f.etapa) where.etapa = f.etapa;
  if (f.desde || f.hasta) where.fecha = { ...(f.desde && { gte: f.desde }), ...(f.hasta && { lte: f.hasta }) };
  if (solicitante.departamento !== DEPARTAMENTO_GLOBAL) {
    where.usuario = { is: { departamento: { codigo: solicitante.departamento } } };
  }

  const [total, filas] = await prisma.$transaction([
    prisma.auditoria.count({ where }),
    prisma.auditoria.findMany({
      where,
      orderBy: [{ fecha: "desc" }, { id: "desc" }],
      skip: (f.pagina - 1) * f.limite,
      take: f.limite,
    }),
  ]);

  return {
    total,
    pagina: f.pagina,
    limite: f.limite,
    registros: filas.map((r) => ({ ...r, id: Number(r.id), fecha: r.fecha.toISOString() })),
  };
}
