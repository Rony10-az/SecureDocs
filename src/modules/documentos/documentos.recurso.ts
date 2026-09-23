import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { usuarioActual } from "../../auth/authenticate";
import { DEPARTAMENTO_GLOBAL, type RecursoCtx } from "../../authorization/tipos";
import { normalizarTexto } from "../../context/entorno";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { crearDocumentoSchema, type CrearDocumentoDto } from "./documentos.schemas";
import { leerMultipart } from "./subida";

type DocumentoConDepartamento = Prisma.DocumentoGetPayload<{ include: { departamento: true } }>;

/** Atributos `recurso.*` que ven las políticas ABAC para un documento existente. */
export function recursoDesdeDocumento(d: DocumentoConDepartamento): RecursoCtx {
  return {
    tipo: "documento",
    id: d.id,
    departamento: d.departamento.codigo,
    nivel_confidencialidad: d.nivel_confidencialidad,
    propietario_id: d.propietario_id,
    estado: d.estado,
    pais: d.pais,
  };
}

/** El :id de la URL. Un id mal formado es un 400 y no llega a tocar la base de datos. */
export function idDeParams(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw AppError.validacion("El id debe ser un número entero positivo");
  return id;
}

/** El id del documento que `authorize` dejó cargado en la petición. */
export function idDelRecurso(req: Request): number {
  const id = req.recurso?.id;
  if (id === undefined) throw new Error("authorize no dejó el recurso cargado en la petición");
  return id;
}

/** Cargador para las rutas /documentos/:id... Un documento en la papelera (borrado lógico) cuenta como inexistente. */
export async function cargarDocumento(req: Request): Promise<RecursoCtx | null> {
  const d = await prisma.documento.findFirst({
    where: { id: idDeParams(req), eliminado_en: null },
    include: { departamento: true },
  });
  return d ? recursoDesdeDocumento(d) : null;
}

/** Lo que `cargarCandidato` deja en `res.locals.creacion` para que el controlador no repita el trabajo. */
export interface DatosCreacion {
  dto: CrearDocumentoDto;
  departamentoId: number;
  pais: string;
}

/**
 * Cargador para POST /documentos: todavía no existe el documento, así que se evalúa el "candidato"
 * (los atributos que TENDRÍA). Así P1 impide crear en otro departamento, P2 crear por encima de tu
 * nivel, y P4/P5/P6 aplican también al crear. Lee el multipart aquí (y no antes) para no gastar
 * memoria en quien ya fue rechazado por estado o por RBAC.
 */
export async function cargarCandidato(req: Request, res: Response): Promise<RecursoCtx> {
  const usuario = usuarioActual(req);
  await leerMultipart(req, res);
  const dto = crearDocumentoSchema.parse(req.body ?? {});

  const codigo = dto.departamento ?? usuario.departamento;
  if (codigo === DEPARTAMENTO_GLOBAL) {
    throw AppError.validacion("Indique el departamento del documento (GLOBAL no es un departamento donde se guarden documentos)");
  }
  const departamento = await prisma.departamento.findUnique({ where: { codigo } });
  if (!departamento) throw AppError.validacion(`El departamento "${codigo}" no existe`);

  const pais = normalizarTexto(dto.pais) ?? usuario.pais;
  const datos: DatosCreacion = { dto, departamentoId: departamento.id, pais };
  res.locals.creacion = datos;

  return {
    tipo: "documento",
    departamento: departamento.codigo,
    nivel_confidencialidad: dto.nivel_confidencialidad,
    propietario_id: usuario.id,
    estado: dto.enviar ? "PENDIENTE" : "BORRADOR",
    pais,
  };
}
