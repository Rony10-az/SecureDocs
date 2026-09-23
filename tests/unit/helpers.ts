/** Constructores de contextos para las pruebas, armados con los MISMOS datos que el seed. */
import { DOCUMENTOS, MATRIZ_RBAC, POLITICAS, USUARIOS } from "../../prisma/datos";
import { PolicyEngine } from "../../src/authorization/abac/policy-engine";
import type { PoliticaDef, PoliticasPort } from "../../src/authorization/abac/tipos";
import { Autorizador, type PermisosPort } from "../../src/authorization/autorizador";
import type { ContextoAutorizacion, RecursoCtx } from "../../src/authorization/tipos";
import type { EntornoCtx, UsuarioCtx } from "../../src/context/tipos";

/** Usuario del seed como lo vería `authenticate`. El id es su posición (1, 2, 3...) como en una BD recién sembrada. */
export function usuario(correo: string, cambios: Partial<UsuarioCtx> = {}): UsuarioCtx {
  const i = USUARIOS.findIndex((u) => u.correo === correo);
  if (i < 0) throw new Error(`No existe el usuario de prueba ${correo}`);
  const u = USUARIOS[i];
  return {
    id: i + 1,
    nombre: u.nombre,
    correo: u.correo,
    rol: u.rol,
    departamento: u.depto,
    nivel_seguridad: u.nivel,
    pais: "PERU",
    tipo_contrato: u.tipo ?? "INTERNO",
    estado: u.estado ?? "ACTIVO",
    fecha_expiracion: u.expira ?? null,
    ...cambios,
  };
}

/** Documento del seed como recurso (atributos que ven las políticas). */
export function documento(titulo: string, cambios: Partial<RecursoCtx> = {}): RecursoCtx {
  const i = DOCUMENTOS.findIndex((d) => d.titulo === titulo);
  if (i < 0) throw new Error(`No existe el documento de prueba "${titulo}"`);
  const d = DOCUMENTOS[i];
  return {
    tipo: "documento",
    id: i + 1,
    departamento: d.depto,
    nivel_confidencialidad: d.nivel,
    propietario_id: usuario(d.propietario).id,
    estado: d.estado,
    pais: "PERU",
    ...cambios,
  };
}

/** Entorno "normal": en Perú, laptop corporativa, 10:00 de un día hábil. */
export function entorno(cambios: Partial<EntornoCtx> = {}): EntornoCtx {
  return {
    hora: "10:00",
    fecha: "2026-09-23",
    ubicacion: "PERU",
    dispositivo: "CORPORATIVO",
    direccion_ip: "127.0.0.1",
    ...cambios,
  };
}

export function contexto(correo: string, titulo: string, cambiosEntorno: Partial<EntornoCtx> = {}): ContextoAutorizacion {
  return { usuario: usuario(correo), entorno: entorno(cambiosEntorno), recurso: documento(titulo) };
}

/** RBAC con la matriz del seed (en producción sale de la tabla rol_permiso). */
export const rbacDeSeed: PermisosPort = {
  tienePermiso: async (rol, permiso) => MATRIZ_RBAC[rol]?.includes(permiso) ?? false,
};

/** Políticas en memoria. El motor filtra por `activa` por su cuenta (esto solo separa por etapa). */
export const repoDe = (politicas: PoliticaDef[]): PoliticasPort => ({
  activas: async (etapa) => politicas.filter((p) => p.etapa === etapa),
});

export const crearAutorizador = (politicas: PoliticaDef[] = POLITICAS) =>
  new Autorizador(rbacDeSeed, new PolicyEngine(repoDe(politicas)));
