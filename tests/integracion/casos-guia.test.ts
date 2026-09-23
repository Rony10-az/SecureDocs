/**
 * LOS 17 CASOS DE PRUEBA DE LA GUÍA (sección 11) — Jest + Supertest contra la API, PostgreSQL y MinIO reales.
 *
 * Cada caso comprueba:
 *   1. la respuesta HTTP (200/204 si se permite; 403 si se deniega);
 *   2. el detalle de la denegación que exige la guía: `etapa` (ESTADO / RBAC / ABAC), `politica` y `motivo`;
 *   3. que se creó EXACTAMENTE UN registro de auditoría, con el motivo correcto, la acción, el recurso y el
 *      entorno (IP, ubicación, dispositivo);
 *   4. el efecto (o la falta de efecto) en la base de datos: lo denegado no cambia nada.
 *
 * Requiere `docker compose up -d` y la BD sembrada. Al terminar escribe `evidencias/casos-guia.md`.
 */
import type { Response, Test } from "supertest";
import { config } from "../../src/config";
import { prisma } from "../../src/db";
import { escribirEvidencia, renderizarEvidencia, type EvidenciaCaso } from "../soporte/evidencia";
import {
  CORREOS,
  RELOJ_FIJO,
  api,
  auditoriaDesde,
  cerrar,
  crearDocumento,
  documentoSembrado,
  fijarRelojDePruebas,
  limpiarDocumentos,
  marcaAuditoria,
  restaurarReloj,
  sesiones,
  verificarEntorno,
  type DocumentoSembrado,
  type Persona,
} from "./soporte";

type Esperado =
  | { permitido: true; status: number }
  | { permitido: false; etapa: "ESTADO" | "RBAC" | "ABAC"; politica: string | null; motivo: string };

interface DefinicionCaso {
  numero: number;
  escenario: string;
  actor: Persona;
  accion: string;
  recurso: string;
  metodo: "GET" | "POST" | "PUT" | "DELETE";
  ruta: string;
  peticion: () => Test;
  esperado: Esperado;
  /** El entorno que debe quedar anotado en la auditoría (por defecto PERU / CORPORATIVO) */
  entorno?: { ubicacion?: string; dispositivo?: string };
  /** Comprobaciones extra sobre la respuesta y sobre la BD */
  despues?: (r: Response) => Promise<void>;
}

const PERMITIDO = (status = 200): Esperado => ({ permitido: true, status });
const DENEGADO = (etapa: "ESTADO" | "RBAC" | "ABAC", politica: string | null, motivo: string): Esperado => ({ permitido: false, etapa, politica, motivo });
const RBAC = DENEGADO("RBAC", null, "Denegado por RBAC");

const evidencias: EvidenciaCaso[] = [];

/** Ejecuta un caso y comprueba la respuesta, la auditoría y lo que pida `despues`. Anota la evidencia. */
async function caso(d: DefinicionCaso): Promise<void> {
  const correo = CORREOS[d.actor];
  const esperado = d.esperado;
  const ev: EvidenciaCaso = {
    numero: d.numero,
    escenario: d.escenario,
    actor: correo,
    peticion: `${d.metodo} ${d.ruta}`,
    esperado: esperado.permitido ? `Permitido (HTTP ${esperado.status})` : `Denegado · ${esperado.etapa}${esperado.politica ? " " + esperado.politica : ""} · ${esperado.motivo}`,
    obtenido: "(sin respuesta)",
    auditoria: null,
    correcto: false,
  };

  try {
    const marca = await marcaAuditoria();
    const r = await d.peticion();
    ev.obtenido = esperado.permitido || r.status !== 403 ? `HTTP ${r.status}` : `HTTP 403 · ${r.body.etapa}${r.body.politica ? " " + r.body.politica : ""} · ${r.body.motivo}`;

    // 1 y 2. La respuesta
    if (esperado.permitido) {
      expect(r.status).toBe(esperado.status);
    } else {
      expect(r.status).toBe(403);
      // Exactamente lo que exige la guía: etapa, política y motivo (y nada más: no se filtra información del documento)
      expect(r.body).toEqual({
        error: "ACCESO_DENEGADO",
        mensaje: esperado.motivo,
        etapa: esperado.etapa,
        politica: esperado.politica,
        motivo: esperado.motivo,
      });
    }

    // 3. La auditoría: un solo registro nuevo de este usuario y esta acción, con el motivo correcto
    const filas = await auditoriaDesde(marca, { usuario_correo: correo, accion: d.accion });
    expect(filas).toHaveLength(1);
    const f = filas[0];
    ev.auditoria = {
      id: Number(f.id),
      fecha: f.fecha.toISOString(),
      usuario_correo: f.usuario_correo,
      accion: f.accion,
      recurso: f.recurso,
      resultado: f.resultado,
      etapa: f.etapa,
      politica_codigo: f.politica_codigo,
      motivo: f.motivo,
      ip: f.ip,
      ubicacion: f.ubicacion,
      dispositivo: f.dispositivo,
    };
    expect(f).toMatchObject(
      esperado.permitido
        ? { resultado: "PERMITIDO", etapa: "COMPLETA", politica_codigo: null, motivo: "Acceso permitido" }
        : { resultado: "DENEGADO", etapa: esperado.etapa, politica_codigo: esperado.politica, motivo: esperado.motivo },
    );
    expect(f).toMatchObject({ accion: d.accion, recurso: d.recurso, usuario_correo: correo });
    expect(f.usuario_id).not.toBeNull();
    expect(f.ip).toBeTruthy();
    expect(f.ubicacion).toBe(d.entorno?.ubicacion ?? "PERU");
    expect(f.dispositivo).toBe(d.entorno?.dispositivo ?? "CORPORATIVO");

    // 4. El efecto en la base de datos
    await d.despues?.(r);
    ev.correcto = true;
  } finally {
    evidencias.push(ev);
  }
}

describe("Los 17 casos de prueba de la guía (sección 11)", () => {
  let T: Record<Persona, string>;
  let presupuesto: DocumentoSembrado; // FINANZAS · nivel 2 · PUBLICADO
  let planilla: DocumentoSembrado; //    RRHH · nivel 3
  let plan: DocumentoSembrado; //        FINANZAS · nivel 4
  let estados: DocumentoSembrado; //     FINANZAS · nivel 5
  let manual: DocumentoSembrado; //      OPERACIONES · nivel 1 · PUBLICADO
  let contrato: DocumentoSembrado; //    LEGAL · nivel 4 · PUBLICADO
  // Documentos que crean las propias pruebas (por la API) para los casos que modifican datos
  let docCaso3: { id: number };
  let docCaso4: { id: number };
  let docCaso6: { id: number };
  let docCaso13: { id: number };
  let docCaso16: { id: number };

  beforeAll(async () => {
    await verificarEntorno();
    fijarRelojDePruebas();
    T = await sesiones();

    presupuesto = await documentoSembrado("Presupuesto 2026", { departamento: "FINANZAS", nivel: 2, estado: "PUBLICADO" });
    planilla = await documentoSembrado("Planilla de sueldos", { departamento: "RRHH", nivel: 3, estado: "PUBLICADO" });
    plan = await documentoSembrado("Plan de inversiones", { departamento: "FINANZAS", nivel: 4, estado: "PENDIENTE" });
    estados = await documentoSembrado("Estados financieros auditados", { departamento: "FINANZAS", nivel: 5, estado: "PUBLICADO" });
    manual = await documentoSembrado("Manual de bienvenida", { departamento: "OPERACIONES", nivel: 1, estado: "PUBLICADO" });
    contrato = await documentoSembrado("Contrato confidencial", { departamento: "LEGAL", nivel: 4, estado: "PUBLICADO" });

    docCaso3 = await crearDocumento(T.eduardo, { titulo: "Caso 3 - informe para aprobar", nivel: 2, enviar: true });
    docCaso4 = await crearDocumento(T.eduardo, { titulo: "Caso 4 - informe pendiente", nivel: 2, enviar: true });
    docCaso6 = await crearDocumento(T.eduardo, { titulo: "Caso 6 - documento para eliminar", nivel: 1 });
    docCaso13 = await crearDocumento(T.sara, { titulo: "Caso 13 - propuesta de Sara", nivel: 2, enviar: true });
    docCaso16 = await crearDocumento(T.eduardo, { titulo: "Caso 16 y 17 - informe de Eduardo", nivel: 2, enviar: true });
  }, 60_000);

  afterAll(async () => {
    restaurarReloj();
    await limpiarDocumentos();
    const baseDeDatos = new URL(config.DATABASE_URL);
    escribirEvidencia(
      "casos-guia.md",
      renderizarEvidencia(evidencias, {
        ejecutadoEn: new Date().toISOString(),
        node: process.version,
        baseDeDatos: `PostgreSQL ${baseDeDatos.hostname}:${baseDeDatos.port}${baseDeDatos.pathname}`,
        almacenamiento: `MinIO ${config.MINIO_ENDPOINT}:${config.MINIO_PORT} (bucket "${config.MINIO_BUCKET}", privado)`,
        relojFijado: `${RELOJ_FIJO.toISOString()} (10:00 en Lima)`,
      }),
    );
    await cerrar();
  });

  test("Caso 1 · Empleado consulta documento de su área → Permitido", () =>
    caso({
      numero: 1, escenario: "Empleado consulta documento de su área", actor: "eduardo",
      accion: "DOC_READ", recurso: `documento:${presupuesto.id}`, metodo: "GET", ruta: `/documentos/${presupuesto.id}`,
      peticion: () => api(T.eduardo).get(`/documentos/${presupuesto.id}`),
      esperado: PERMITIDO(200),
      despues: async (r) => {
        expect(r.body).toMatchObject({ id: presupuesto.id, titulo: "Presupuesto 2026", departamento: "FINANZAS", estado: "PUBLICADO" });
      },
    }));

  test("Caso 2 · Empleado consulta documento de otra área → Denegado (P1)", () =>
    caso({
      numero: 2, escenario: "Empleado consulta documento de otra área", actor: "eduardo",
      accion: "DOC_READ", recurso: `documento:${planilla.id}`, metodo: "GET", ruta: `/documentos/${planilla.id}`,
      peticion: () => api(T.eduardo).get(`/documentos/${planilla.id}`),
      esperado: DENEGADO("ABAC", "P1", "Documento de otro departamento"),
    }));

  test("Caso 3 · Supervisor aprueba documento de su área (ajeno) → Permitido", () =>
    caso({
      numero: 3, escenario: "Supervisor aprueba documento de su área (ajeno)", actor: "sara",
      accion: "DOC_APPROVE", recurso: `documento:${docCaso3.id}`, metodo: "POST", ruta: `/documentos/${docCaso3.id}/aprobar`,
      peticion: () => api(T.sara).post(`/documentos/${docCaso3.id}/aprobar`),
      esperado: PERMITIDO(200),
      despues: async (r) => {
        expect(r.body).toMatchObject({ estado: "PUBLICADO", aprobado_por: { nombre: "Sara Supervisora" } });
        const fila = await prisma.documento.findUniqueOrThrow({ where: { id: docCaso3.id }, include: { aprobador: true } });
        expect(fila.estado).toBe("PUBLICADO");
        expect(fila.aprobador?.correo).toBe(CORREOS.sara);
        expect(fila.fecha_aprobacion).toEqual(RELOJ_FIJO); // la aprobación usa el reloj de la aplicación
      },
    }));

  test("Caso 4 · Empleado intenta aprobar → Denegado por RBAC", () =>
    caso({
      numero: 4, escenario: "Empleado intenta aprobar", actor: "eduardo",
      accion: "DOC_APPROVE", recurso: `documento:${docCaso4.id}`, metodo: "POST", ruta: `/documentos/${docCaso4.id}/aprobar`,
      peticion: () => api(T.eduardo).post(`/documentos/${docCaso4.id}/aprobar`),
      esperado: RBAC,
      despues: async () => {
        const fila = await prisma.documento.findUniqueOrThrow({ where: { id: docCaso4.id } });
        expect(fila.estado).toBe("PENDIENTE"); // no cambió nada
        expect(fila.aprobado_por).toBeNull();
      },
    }));

  test("Caso 5 · Usuario nivel 2 consulta documento nivel 4 → Denegado (P2)", () =>
    caso({
      numero: 5, escenario: "Usuario nivel 2 consulta documento nivel 4", actor: "practicante",
      accion: "DOC_READ", recurso: `documento:${plan.id}`, metodo: "GET", ruta: `/documentos/${plan.id}`,
      peticion: () => api(T.practicante).get(`/documentos/${plan.id}`),
      esperado: DENEGADO("ABAC", "P2", "Nivel de seguridad insuficiente"),
    }));

  test("Caso 6 · Gerente elimina documento de su área → Permitido", () =>
    caso({
      numero: 6, escenario: "Gerente elimina documento de su área", actor: "gerente",
      accion: "DOC_DELETE", recurso: `documento:${docCaso6.id}`, metodo: "DELETE", ruta: `/documentos/${docCaso6.id}`,
      peticion: () => api(T.gerente).delete(`/documentos/${docCaso6.id}`),
      esperado: PERMITIDO(204),
      despues: async () => {
        // Borrado lógico: la fila sigue en la BD (papelera), pero la API ya no la muestra
        const fila = await prisma.documento.findUniqueOrThrow({ where: { id: docCaso6.id } });
        expect(fila.eliminado_en).toEqual(RELOJ_FIJO);
        expect((await api(T.eduardo).get(`/documentos/${docCaso6.id}`)).status).toBe(404);
      },
    }));

  test("Caso 7 · Auditor intenta modificar → Denegado por RBAC", () =>
    caso({
      numero: 7, escenario: "Auditor intenta modificar", actor: "auditor",
      accion: "DOC_UPDATE", recurso: `documento:${presupuesto.id}`, metodo: "PUT", ruta: `/documentos/${presupuesto.id}`,
      peticion: () => api(T.auditor).put(`/documentos/${presupuesto.id}`).send({ titulo: "Modificado por el auditor" }),
      esperado: RBAC,
      despues: async () => {
        expect((await prisma.documento.findUniqueOrThrow({ where: { id: presupuesto.id } })).titulo).toBe("Presupuesto 2026");
      },
    }));

  test("Caso 8 · Usuario inactivo intenta acceder → Denegado (P7)", () =>
    caso({
      numero: 8, escenario: "Usuario inactivo intenta acceder", actor: "inactivo",
      accion: "DOC_READ", recurso: `documento:${presupuesto.id}`, metodo: "GET", ruta: `/documentos/${presupuesto.id}`,
      peticion: () => api(T.inactivo).get(`/documentos/${presupuesto.id}`),
      esperado: DENEGADO("ESTADO", "P7", "Usuario inactivo o suspendido"),
    }));

  test("Caso 9 · Documento nivel ≥ 4 accedido fuera de horario (X-Hora 20:00) → Denegado (P4)", () =>
    caso({
      numero: 9, escenario: "Documento nivel ≥ 4 accedido fuera de horario (X-Hora 20:00)", actor: "sara",
      accion: "DOC_READ", recurso: `documento:${plan.id}`, metodo: "GET", ruta: `/documentos/${plan.id}  [X-Hora: 20:00]`,
      peticion: () => api(T.sara, { "X-Hora": "20:00" }).get(`/documentos/${plan.id}`),
      esperado: DENEGADO("ABAC", "P4", "Fuera del horario autorizado"),
    }));

  test("Caso 10 · Documento nivel 5 desde dispositivo PERSONAL → Denegado (P6)", () =>
    caso({
      numero: 10, escenario: "Documento nivel 5 desde dispositivo PERSONAL", actor: "gerente",
      accion: "DOC_READ", recurso: `documento:${estados.id}`, metodo: "GET", ruta: `/documentos/${estados.id}  [X-Dispositivo: PERSONAL]`,
      peticion: () => api(T.gerente, { "X-Dispositivo": "PERSONAL" }).get(`/documentos/${estados.id}`),
      esperado: DENEGADO("ABAC", "P6", "Requiere dispositivo corporativo"),
      entorno: { dispositivo: "PERSONAL" },
    }));

  test("Caso 11 · Invitado accede a documento nivel 1 PUBLICADO → Permitido", () =>
    caso({
      numero: 11, escenario: "Invitado accede a documento nivel 1 PUBLICADO", actor: "invitado",
      accion: "DOC_READ", recurso: `documento:${manual.id}`, metodo: "GET", ruta: `/documentos/${manual.id}`,
      peticion: () => api(T.invitado).get(`/documentos/${manual.id}`),
      esperado: PERMITIDO(200),
      despues: async (r) => {
        expect(r.body).toMatchObject({ titulo: "Manual de bienvenida", nivel_confidencialidad: 1, estado: "PUBLICADO" });
      },
    }));

  test("Caso 12 · Invitado accede a documento confidencial → Denegado (P8)", () =>
    caso({
      numero: 12, escenario: "Invitado accede a documento confidencial", actor: "invitado",
      accion: "DOC_READ", recurso: `documento:${contrato.id}`, metodo: "GET", ruta: `/documentos/${contrato.id}`,
      peticion: () => api(T.invitado).get(`/documentos/${contrato.id}`),
      // El invitado incumple P8 y también P2 (nivel 1 < 4): decide P8 porque se evalúa antes (orden 15 frente a 20)
      esperado: DENEGADO("ABAC", "P8", "Invitado solo accede a documentos públicos publicados"),
    }));

  test("Caso 13 ⭐ · Supervisor aprueba su propio documento → Denegado (P10)", () =>
    caso({
      numero: 13, escenario: "Supervisor aprueba su propio documento", actor: "sara",
      accion: "DOC_APPROVE", recurso: `documento:${docCaso13.id}`, metodo: "POST", ruta: `/documentos/${docCaso13.id}/aprobar`,
      peticion: () => api(T.sara).post(`/documentos/${docCaso13.id}/aprobar`),
      esperado: DENEGADO("ABAC", "P10", "No puede aprobar su propio documento"),
      despues: async () => {
        const fila = await prisma.documento.findUniqueOrThrow({ where: { id: docCaso13.id } });
        expect(fila.estado).toBe("PENDIENTE"); // sigue esperando a otra persona
        expect(fila.aprobado_por).toBeNull();
      },
    }));

  test("Caso 14 ⭐ · Invitado con fecha_expiracion vencida → Denegado (P9)", () =>
    caso({
      numero: 14, escenario: "Invitado con fecha_expiracion vencida", actor: "vencido",
      accion: "DOC_READ", recurso: `documento:${manual.id}`, metodo: "GET", ruta: `/documentos/${manual.id}`,
      peticion: () => api(T.vencido).get(`/documentos/${manual.id}`),
      esperado: DENEGADO("ESTADO", "P9", "Acceso temporal vencido"),
    }));

  test("Caso 15 ⭐ · Empleado consulta desde CHILE documento de PERU → Denegado (P5)", () =>
    caso({
      numero: 15, escenario: "Empleado consulta desde CHILE documento de PERU", actor: "eduardo",
      accion: "DOC_READ", recurso: `documento:${presupuesto.id}`, metodo: "GET", ruta: `/documentos/${presupuesto.id}  [X-Ubicacion: CHILE]`,
      peticion: () => api(T.eduardo, { "X-Ubicacion": "CHILE" }).get(`/documentos/${presupuesto.id}`),
      esperado: DENEGADO("ABAC", "P5", "Acceso desde país no autorizado"),
      entorno: { ubicacion: "CHILE" },
    }));

  test("Caso 16 ⭐ · Empleado modifica documento de un compañero de su área → Denegado (P3)", () =>
    caso({
      numero: 16, escenario: "Empleado modifica documento de un compañero de su área", actor: "elena",
      accion: "DOC_UPDATE", recurso: `documento:${docCaso16.id}`, metodo: "PUT", ruta: `/documentos/${docCaso16.id}`,
      peticion: () => api(T.elena).put(`/documentos/${docCaso16.id}`).send({ titulo: "Modificado por una compañera" }),
      esperado: DENEGADO("ABAC", "P3", "Solo puede modificar sus propios documentos"),
      despues: async () => {
        expect((await prisma.documento.findUniqueOrThrow({ where: { id: docCaso16.id } })).titulo).toBe("Caso 16 y 17 - informe de Eduardo");
      },
    }));

  test("Caso 17 ⭐ · Gerente modifica documento de un empleado de su área → Permitido (excepción P3)", () =>
    caso({
      numero: 17, escenario: "Gerente modifica documento de un empleado de su área", actor: "gerente",
      accion: "DOC_UPDATE", recurso: `documento:${docCaso16.id}`, metodo: "PUT", ruta: `/documentos/${docCaso16.id}`,
      peticion: () => api(T.gerente).put(`/documentos/${docCaso16.id}`).send({ descripcion: "Revisado por gerencia" }),
      esperado: PERMITIDO(200),
      despues: async (r) => {
        expect(r.body.descripcion).toBe("Revisado por gerencia");
        const fila = await prisma.documento.findUniqueOrThrow({ where: { id: docCaso16.id } });
        expect(fila.descripcion).toBe("Revisado por gerencia");
        expect(fila.propietario_id).toBe((await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS.eduardo } })).id); // sigue siendo de Eduardo
      },
    }));

  test("Los 17 casos quedaron ejecutados y cubren las 10 políticas de la guía y las tres etapas de denegación", () => {
    expect(evidencias.map((e) => e.numero).sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    const denegaciones = evidencias.map((e) => e.auditoria).filter((a) => a?.resultado === "DENEGADO");
    expect(new Set(denegaciones.map((a) => a?.politica_codigo).filter(Boolean))).toEqual(new Set(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]));
    expect(new Set(denegaciones.map((a) => a?.etapa))).toEqual(new Set(["ESTADO", "RBAC", "ABAC"]));
    expect(evidencias.every((e) => e.correcto)).toBe(true);
  });
});
