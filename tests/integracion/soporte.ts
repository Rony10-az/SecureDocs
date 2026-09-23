/**
 * Soporte común de las pruebas de integración: la API real (Supertest, en el mismo proceso, sin abrir puertos)
 * con PostgreSQL y MinIO reales.
 */
import type { EstadoDocumento } from "@prisma/client";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import request from "supertest";
import type { Test } from "supertest";
import { PASSWORD_PRUEBA } from "../../prisma/datos";
import { app } from "../../src/app";
import { fijarReloj } from "../../src/context/clock";
import { prisma } from "../../src/db";
import { storage } from "../../src/storage";
import { pdfMuestra } from "../soporte/muestras";

/** Los usuarios sembrados (`prisma/datos.ts`), por el nombre con el que los llamamos en las pruebas. */
export const CORREOS = {
  admin: "admin@techcorp.pe",
  gerente: "gerente.fin@techcorp.pe",
  sara: "supervisor.fin@techcorp.pe",
  eduardo: "empleado.fin@techcorp.pe",
  elena: "empleado2.fin@techcorp.pe",
  practicante: "practicante.fin@techcorp.pe",
  rrhh: "empleado.rrhh@techcorp.pe",
  auditor: "auditor@techcorp.pe",
  inactivo: "inactivo@techcorp.pe",
  invitado: "invitado@externo.com",
  vencido: "invitado.vencido@externo.com",
} as const;
export type Persona = keyof typeof CORREOS;

/** Entorno "normal": en Perú, con laptop corporativa, a las 10:00. Cada prueba cambia solo lo que necesita. */
export const ENTORNO_NORMAL: Record<string, string> = {
  "X-Ubicacion": "PERU",
  "X-Dispositivo": "CORPORATIVO",
  "X-Hora": "10:00",
};

/**
 * Reloj de la aplicación fijado durante las pruebas: 23-sep-2026, 10:00 en Lima.
 * Así el resultado no depende del día en que se ejecuten (p. ej. el invitado sembrado vence el 2027-12-31).
 */
export const RELOJ_FIJO = new Date("2026-09-23T15:00:00Z");
export const fijarRelojDePruebas = () => fijarReloj({ ahora: () => RELOJ_FIJO });
export const restaurarReloj = () => fijarReloj();

/** Comprueba que Docker, la BD sembrada y MinIO estén listos; si no, falla con instrucciones claras. */
export async function verificarEntorno(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new Error("No hay conexión con PostgreSQL. ¿Levantaste Docker? Ejecuta: docker compose up -d");
  }
  const [usuarios, politicas] = await Promise.all([prisma.usuario.count(), prisma.politica.count()]);
  if (usuarios < 11 || politicas < 11) {
    throw new Error("La base de datos no tiene los datos de prueba. Ejecuta: npx prisma migrate deploy && npm run db:seed");
  }
  try {
    await storage.asegurarContenedor();
  } catch {
    throw new Error("No hay conexión con MinIO. ¿Levantaste Docker? Ejecuta: docker compose up -d");
  }
}

export async function iniciarSesion(correo: string, password: string = PASSWORD_PRUEBA): Promise<string> {
  const r = await request(app).post("/auth/login").set(ENTORNO_NORMAL).send({ correo, password });
  if (r.status !== 200) throw new Error(`No se pudo iniciar sesión como ${correo}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

/** Inicia sesión (de verdad, por POST /auth/login) con los usuarios sembrados que se pidan (por defecto, todos). */
export async function sesiones<P extends Persona = Persona>(personas: readonly P[] = Object.keys(CORREOS) as P[]): Promise<Record<P, string>> {
  const tokens = await Promise.all(personas.map((p) => iniciarSesion(CORREOS[p])));
  return Object.fromEntries(personas.map((p, i) => [p, tokens[i]])) as Record<P, string>;
}

/** Cliente HTTP con el token y los headers de entorno; `entorno` sobrescribe los del entorno normal. */
export function api(token: string, entorno: Record<string, string> = {}) {
  const cabeceras = { Authorization: `Bearer ${token}`, ...ENTORNO_NORMAL, ...entorno };
  return {
    get: (ruta: string): Test => request(app).get(ruta).set(cabeceras),
    post: (ruta: string): Test => request(app).post(ruta).set(cabeceras),
    put: (ruta: string): Test => request(app).put(ruta).set(cabeceras),
    delete: (ruta: string): Test => request(app).delete(ruta).set(cabeceras),
  };
}

/** Cliente sin token (para probar lo que pasa sin iniciar sesión). */
export const sinSesion = (entorno: Record<string, string> = {}) => ({
  get: (ruta: string): Test => request(app).get(ruta).set({ ...ENTORNO_NORMAL, ...entorno }),
  post: (ruta: string): Test => request(app).post(ruta).set({ ...ENTORNO_NORMAL, ...entorno }),
});

// ---------------------------------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------------------------------

/** El último id de auditoría hasta ahora: sirve para mirar solo lo que escribe la petición que sigue. */
export async function marcaAuditoria(): Promise<bigint> {
  const r = await prisma.auditoria.aggregate({ _max: { id: true } });
  return r._max.id ?? 0n;
}

export function auditoriaDesde(marca: bigint, filtro: { usuario_correo?: string; accion?: string; recurso?: string } = {}) {
  return prisma.auditoria.findMany({ where: { id: { gt: marca }, ...filtro }, orderBy: { id: "asc" } });
}

// ---------------------------------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------------------------------

export interface DocumentoSembrado {
  id: number;
  titulo: string;
}

/** Busca un documento sembrado por título y comprueba que siga como se sembró (nadie lo tocó a mano). */
export async function documentoSembrado(
  titulo: string,
  esperado: { departamento: string; nivel: number; estado: EstadoDocumento },
): Promise<DocumentoSembrado> {
  const d = await prisma.documento.findFirst({ where: { titulo, eliminado_en: null }, include: { departamento: true } });
  const actual = d && { departamento: d.departamento.codigo, nivel: d.nivel_confidencialidad, estado: d.estado };
  if (!d || JSON.stringify(actual) !== JSON.stringify(esperado)) {
    throw new Error(
      `El documento sembrado "${titulo}" no está como se sembró (esperado ${JSON.stringify(esperado)}, encontrado ${JSON.stringify(actual)}). ` +
        "¿Lo modificaste a mano? Reinicia los datos con: npm run db:reset",
    );
  }
  return { id: d.id, titulo: d.titulo };
}

const documentosCreados: number[] = [];

/**
 * Crea un documento de prueba POR LA API (multipart) como `token`. Se borra en `limpiarDocumentos`.
 * Por defecto lleva un PDF de muestra; `archivo: false` lo crea sin archivo.
 */
export async function crearDocumento(
  token: string,
  o: {
    titulo: string;
    nivel?: number;
    enviar?: boolean;
    archivo?: { nombre: string; contenido: Buffer } | false;
    entorno?: Record<string, string>;
  },
) {
  let peticion = api(token, o.entorno)
    .post("/documentos")
    .field("titulo", o.titulo)
    .field("nivel_confidencialidad", String(o.nivel ?? 2))
    .field("enviar", String(o.enviar ?? false));
  if (o.archivo !== false) {
    const a = o.archivo ?? { nombre: "documento.pdf", contenido: pdfMuestra(o.titulo) };
    peticion = peticion.attach("archivo", a.contenido, a.nombre);
  }

  const r = await peticion;
  if (r.status !== 201) throw new Error(`No se pudo crear el documento de prueba "${o.titulo}": HTTP ${r.status} ${JSON.stringify(r.body)}`);
  documentosCreados.push(r.body.id);
  return r.body as {
    id: number;
    estado: EstadoDocumento;
    archivo: { nombre: string; mime: string; tamano: number; sha256: string } | null;
    [campo: string]: unknown;
  };
}

/** Para documentos creados sin pasar por `crearDocumento` (p. ej. con un cuerpo JSON): que también se limpien. */
export const registrarDocumento = (id: number): void => {
  documentosCreados.push(id);
};

/** Borra de verdad (fila y archivo en MinIO) los documentos que crearon las pruebas. */
export async function limpiarDocumentos(extra: number[] = []): Promise<void> {
  const ids = [...documentosCreados, ...extra];
  if (ids.length === 0) return;
  const filas = await prisma.documento.findMany({ where: { id: { in: ids } }, select: { archivo_clave: true } });
  for (const f of filas) if (f.archivo_clave) await storage.eliminar(f.archivo_clave).catch(() => undefined);
  await prisma.documento.deleteMany({ where: { id: { in: ids } } });
  documentosCreados.length = 0;
}

/** Descarga binaria (GET .../archivo): devuelve el contenido como Buffer. */
export async function descargar(token: string, ruta: string, entorno: Record<string, string> = {}) {
  const r = await api(token, entorno)
    .get(ruta)
    .buffer(true)
    .parse((res, terminar) => {
      const trozos: Buffer[] = [];
      res.on("data", (t: Buffer) => trozos.push(t));
      res.on("end", () => terminar(null, Buffer.concat(trozos)));
    });
  return { status: r.status, headers: r.headers, contenido: r.body as Buffer };
}

export const sha256 = (contenido: Buffer): string => createHash("sha256").update(contenido).digest("hex");

/** Los títulos de los documentos que este usuario puede leer, recorriendo TODAS las páginas de GET /documentos. */
export async function titulosVisibles(token: string, filtros = "", entorno: Record<string, string> = {}): Promise<string[]> {
  const titulos: string[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await api(token, entorno).get(`/documentos?limite=100&pagina=${pagina}${filtros ? "&" + filtros : ""}`);
    if (r.status !== 200) throw new Error(`GET /documentos respondió ${r.status}: ${JSON.stringify(r.body)}`);
    titulos.push(...r.body.documentos.map((d: { titulo: string }) => d.titulo));
    if (titulos.length >= r.body.total || r.body.documentos.length === 0) return titulos;
  }
}

export async function leerTodo(flujo: Readable): Promise<Buffer> {
  const trozos: Buffer[] = [];
  for await (const t of flujo) trozos.push(Buffer.from(t));
  return Buffer.concat(trozos);
}

/** Cierra la conexión a la BD (Jest no termina si queda abierta). */
export const cerrar = () => prisma.$disconnect();
