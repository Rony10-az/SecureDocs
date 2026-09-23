/**
 * Los 17 casos de prueba de la guía (sección 11) a nivel de motor: estado -> RBAC -> ABAC,
 * con la matriz RBAC y las políticas del seed, sin base de datos ni HTTP.
 * (El Bloque 6 repite los mismos casos contra la API real y comprueba además la auditoría.)
 */
import { POLITICAS } from "../../prisma/datos";
import type { Accion, ContextoAutorizacion, Decision } from "../../src/authorization/tipos";
import { contexto, crearAutorizador } from "./helpers";

const PERMITIDO: Decision = { permitido: true };
const RBAC: Decision = { permitido: false, etapa: "RBAC", politica: null, motivo: "Denegado por RBAC" };
const abac = (politica: string, motivo: string): Decision => ({ permitido: false, etapa: "ABAC", politica, motivo });
const estado = (politica: string, motivo: string): Decision => ({ permitido: false, etapa: "ESTADO", politica, motivo });

const eduardo = "empleado.fin@techcorp.pe";
const elena = "empleado2.fin@techcorp.pe";
const practicante = "practicante.fin@techcorp.pe";
const supervisor = "supervisor.fin@techcorp.pe";
const gerente = "gerente.fin@techcorp.pe";
const auditor = "auditor@techcorp.pe";
const inactivo = "inactivo@techcorp.pe";
const invitado = "invitado@externo.com";
const vencido = "invitado.vencido@externo.com";

type Caso = [numero: number, escenario: string, ctx: ContextoAutorizacion, accion: Accion, esperado: Decision];

const casos: Caso[] = [
  [1, "Empleado consulta documento de su área", contexto(eduardo, "Presupuesto 2026"), "DOC_READ", PERMITIDO],
  [2, "Empleado consulta documento de otra área", contexto(eduardo, "Planilla de sueldos"), "DOC_READ", abac("P1", "Documento de otro departamento")],
  [3, "Supervisor aprueba documento de su área (ajeno)", contexto(supervisor, "Informe trimestral Q3"), "DOC_APPROVE", PERMITIDO],
  [4, "Empleado intenta aprobar", contexto(eduardo, "Informe trimestral Q3"), "DOC_APPROVE", RBAC],
  [5, "Usuario nivel 2 consulta documento nivel 4", contexto(practicante, "Plan de inversiones"), "DOC_READ", abac("P2", "Nivel de seguridad insuficiente")],
  [6, "Gerente elimina documento de su área", contexto(gerente, "Documento para eliminar"), "DOC_DELETE", PERMITIDO],
  [7, "Auditor intenta modificar", contexto(auditor, "Presupuesto 2026"), "DOC_UPDATE", RBAC],
  [8, "Usuario inactivo intenta acceder", contexto(inactivo, "Presupuesto 2026"), "DOC_READ", estado("P7", "Usuario inactivo o suspendido")],
  [9, "Documento nivel >= 4 fuera de horario (X-Hora 20:00)", contexto(supervisor, "Plan de inversiones", { hora: "20:00" }), "DOC_READ", abac("P4", "Fuera del horario autorizado")],
  [10, "Documento nivel 5 desde dispositivo PERSONAL", contexto(gerente, "Estados financieros auditados", { dispositivo: "PERSONAL" }), "DOC_READ", abac("P6", "Requiere dispositivo corporativo")],
  [11, "Invitado accede a documento nivel 1 PUBLICADO", contexto(invitado, "Manual de bienvenida"), "DOC_READ", PERMITIDO],
  [12, "Invitado accede a documento confidencial", contexto(invitado, "Contrato confidencial"), "DOC_READ", abac("P8", "Invitado solo accede a documentos públicos publicados")],
  [13, "Supervisor aprueba su propio documento", contexto(supervisor, "Propuesta de la supervisora"), "DOC_APPROVE", abac("P10", "No puede aprobar su propio documento")],
  [14, "Invitado con fecha_expiracion vencida", contexto(vencido, "Manual de bienvenida"), "DOC_READ", estado("P9", "Acceso temporal vencido")],
  [15, "Empleado consulta desde CHILE documento de PERU", contexto(eduardo, "Presupuesto 2026", { ubicacion: "CHILE" }), "DOC_READ", abac("P5", "Acceso desde país no autorizado")],
  [16, "Empleado modifica documento de un compañero de su área", contexto(elena, "Informe trimestral Q3"), "DOC_UPDATE", abac("P3", "Solo puede modificar sus propios documentos")],
  [17, "Gerente modifica documento de un empleado de su área", contexto(gerente, "Informe trimestral Q3"), "DOC_UPDATE", PERMITIDO],
];

const autorizador = crearAutorizador();

test.each(casos)("caso %i · %s", async (_numero, _escenario, ctx, accion, esperado) => {
  expect(await autorizador.decidir(ctx, accion)).toEqual(esperado);
});

test("los 17 casos ejercitan las 10 políticas y las tres etapas de denegación", () => {
  const denegaciones = casos.map((c) => c[4]).filter((d): d is Extract<Decision, { permitido: false }> => !d.permitido);
  const politicasCubiertas = new Set(denegaciones.map((d) => d.politica).filter(Boolean));
  expect(politicasCubiertas).toEqual(new Set(POLITICAS.map((p) => p.codigo)));
  expect(new Set(denegaciones.map((d) => d.etapa))).toEqual(new Set(["ESTADO", "RBAC", "ABAC"]));
});
