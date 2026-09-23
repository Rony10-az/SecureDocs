/**
 * Datos de arranque (los usa `seed.ts` y también las pruebas unitarias, para que
 * lo que se prueba sea EXACTAMENTE lo que se siembra en la base de datos).
 */
import type { EstadoDocumento, EstadoUsuario, TipoContrato } from "@prisma/client";
import type { PoliticaDef } from "../src/authorization/abac/tipos";

export const PASSWORD_PRUEBA = "Secure123!";

// ---------- RBAC (sección 5 de la guía) ----------
export const PERMISOS: string[] = [
  "DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE",
  "DOC_DOWNLOAD", "AUDIT_READ", "USER_MANAGE", "ROLE_ASSIGN",
];

export const MATRIZ_RBAC: Record<string, string[]> = {
  ADMIN: PERMISOS,
  GERENTE: ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE", "DOC_DOWNLOAD", "AUDIT_READ"],
  SUPERVISOR: ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_APPROVE", "DOC_DOWNLOAD"],
  EMPLEADO: ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DOWNLOAD"],
  AUDITOR: ["DOC_READ", "DOC_DOWNLOAD", "AUDIT_READ"],
  INVITADO: ["DOC_READ"],
};

export const DEPARTAMENTOS: [string, string][] = [
  ["FINANZAS", "Finanzas"],
  ["RRHH", "Recursos Humanos"],
  ["LEGAL", "Legal"],
  ["TI", "Tecnologías de la Información"],
  ["OPERACIONES", "Operaciones"],
  ["GLOBAL", "Global (transversal)"],
];

// ---------- ABAC (sección 6 de la guía) ----------
const ACCIONES_DOC = ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE", "DOC_DOWNLOAD"];
const NIVEL_ALTO = { "recurso.nivel_confidencialidad": { gte: 4 } };

const politica = (p: Omit<PoliticaDef, "activa">): PoliticaDef => ({ ...p, activa: true });

/**
 * Orden de evaluación (menor = primero). Etapa ESTADO antes que RBAC; etapa ABAC después.
 * P8 va antes que P2 a propósito: un invitado que abre un documento confidencial incumple ambas,
 * y la guía (caso 12) espera que el motivo sea P8, la regla propia del invitado.
 */
export const POLITICAS: PoliticaDef[] = [
  politica({
    codigo: "P7", nombre: "Estado del usuario", etapa: "ESTADO", orden: 1,
    descripcion: "El usuario debe estar ACTIVO. Se evalúa antes que RBAC.",
    acciones: ["*"], roles_exceptuados: [],
    condicion: { "usuario.estado": { eq: "ACTIVO" } },
    motivo_denegacion: "Usuario inactivo o suspendido",
  }),
  politica({
    codigo: "P9", nombre: "Expiración de acceso externo", etapa: "ESTADO", orden: 2,
    descripcion: "Un usuario EXTERNO solo accede hasta su fecha de expiración.",
    acciones: ["*"], roles_exceptuados: [],
    condicion: {
      si: { "usuario.tipo_contrato": { eq: "EXTERNO" } },
      entonces: { "usuario.fecha_expiracion": { gteAttr: "entorno.fecha" } },
    },
    motivo_denegacion: "Acceso temporal vencido",
  }),
  politica({
    codigo: "P1", nombre: "Departamento", etapa: "ABAC", orden: 10,
    descripcion: "Solo se accede a documentos del propio departamento (ADMIN y AUDITOR son GLOBAL; INVITADO lo rige P8).",
    acciones: ACCIONES_DOC, roles_exceptuados: ["ADMIN", "AUDITOR", "INVITADO"],
    condicion: { "usuario.departamento": { eqAttr: "recurso.departamento" } },
    motivo_denegacion: "Documento de otro departamento",
  }),
  politica({
    codigo: "P8", nombre: "Invitado", etapa: "ABAC", orden: 15,
    descripcion: "El invitado solo lee documentos públicos (nivel 1) y publicados.",
    acciones: ["DOC_READ"], roles_exceptuados: [],
    condicion: {
      si: { "usuario.rol": { eq: "INVITADO" } },
      entonces: {
        all: [
          { "usuario.tipo_contrato": { eq: "EXTERNO" } },
          { "recurso.nivel_confidencialidad": { lte: 1 } },
          { "recurso.estado": { eq: "PUBLICADO" } },
        ],
      },
    },
    motivo_denegacion: "Invitado solo accede a documentos públicos publicados",
  }),
  politica({
    codigo: "P2", nombre: "Nivel de seguridad", etapa: "ABAC", orden: 20,
    descripcion: "El nivel de seguridad del usuario debe ser mayor o igual al nivel de confidencialidad del documento.",
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: { "usuario.nivel_seguridad": { gteAttr: "recurso.nivel_confidencialidad" } },
    motivo_denegacion: "Nivel de seguridad insuficiente",
  }),
  politica({
    codigo: "P3", nombre: "Propiedad", etapa: "ABAC", orden: 30,
    descripcion: "Solo el propietario modifica un documento (GERENTE y ADMIN exceptuados).",
    acciones: ["DOC_UPDATE"], roles_exceptuados: ["GERENTE", "ADMIN"],
    condicion: { "usuario.id": { eqAttr: "recurso.propietario_id" } },
    motivo_denegacion: "Solo puede modificar sus propios documentos",
  }),
  politica({
    codigo: "P4", nombre: "Horario laboral", etapa: "ABAC", orden: 40,
    descripcion: "Documentos de nivel 4 o 5: solo de 08:00 a 18:00 (hora de la empresa; a las 18:00 ya no).",
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: {
      si: NIVEL_ALTO,
      entonces: { all: [{ "entorno.hora": { gte: "08:00" } }, { "entorno.hora": { lt: "18:00" } }] },
    },
    motivo_denegacion: "Fuera del horario autorizado",
  }),
  politica({
    codigo: "P5", nombre: "País", etapa: "ABAC", orden: 50,
    descripcion: "El acceso debe hacerse desde el país del documento (sin ubicación informada = denegado).",
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: { "entorno.ubicacion": { eqAttr: "recurso.pais" } },
    motivo_denegacion: "Acceso desde país no autorizado",
  }),
  politica({
    codigo: "P6", nombre: "Dispositivo", etapa: "ABAC", orden: 60,
    descripcion: "Documentos de nivel 4 o 5: solo desde dispositivo CORPORATIVO.",
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: { si: NIVEL_ALTO, entonces: { "entorno.dispositivo": { eq: "CORPORATIVO" } } },
    motivo_denegacion: "Requiere dispositivo corporativo",
  }),
  politica({
    codigo: "P10", nombre: "Autoaprobación", etapa: "ABAC", orden: 80,
    descripcion: "Nadie aprueba su propio documento.",
    acciones: ["DOC_APPROVE"], roles_exceptuados: [],
    condicion: { "usuario.id": { neqAttr: "recurso.propietario_id" } },
    motivo_denegacion: "No puede aprobar su propio documento",
  }),
  // P11 no viene en la guía: sale de la línea de la API "nadie cambia su propio rol" (PUT /usuarios/:id).
  // Se modela como política (dato en la BD) y no como un `if` en el controlador, igual que P10.
  // Al CREAR un usuario todavía no existe `recurso.id`: el "si" hace que la política no estorbe en las altas.
  politica({
    codigo: "P11", nombre: "Autogestión de roles", etapa: "ABAC", orden: 90,
    descripcion: "Nadie cambia su propio rol (ni siquiera un administrador).",
    acciones: ["ROLE_ASSIGN"], roles_exceptuados: [],
    condicion: {
      si: { "recurso.id": { neq: null } },
      entonces: { "usuario.id": { neqAttr: "recurso.id" } },
    },
    motivo_denegacion: "No puede cambiar su propio rol",
  }),
];

// ---------- Usuarios de prueba (contraseña común: PASSWORD_PRUEBA) ----------
export interface UsuarioSeed {
  nombre: string;
  correo: string;
  rol: string;
  depto: string;
  nivel: number;
  tipo?: TipoContrato;
  estado?: EstadoUsuario;
  expira?: string;
}

export const USUARIOS: UsuarioSeed[] = [
  { nombre: "Ana Admin",         correo: "admin@techcorp.pe",            rol: "ADMIN",      depto: "GLOBAL",   nivel: 5 },
  { nombre: "Gabriel Gerente",   correo: "gerente.fin@techcorp.pe",      rol: "GERENTE",    depto: "FINANZAS", nivel: 5 },
  { nombre: "Sara Supervisora",  correo: "supervisor.fin@techcorp.pe",   rol: "SUPERVISOR", depto: "FINANZAS", nivel: 4 },
  { nombre: "Eduardo Empleado",  correo: "empleado.fin@techcorp.pe",     rol: "EMPLEADO",   depto: "FINANZAS", nivel: 3 },
  { nombre: "Elena Empleada",    correo: "empleado2.fin@techcorp.pe",    rol: "EMPLEADO",   depto: "FINANZAS", nivel: 3 },
  { nombre: "Pedro Practicante", correo: "practicante.fin@techcorp.pe",  rol: "EMPLEADO",   depto: "FINANZAS", nivel: 2 },
  { nombre: "Rita RRHH",         correo: "empleado.rrhh@techcorp.pe",    rol: "EMPLEADO",   depto: "RRHH",     nivel: 3 },
  { nombre: "Alberto Auditor",   correo: "auditor@techcorp.pe",          rol: "AUDITOR",    depto: "GLOBAL",   nivel: 5 },
  { nombre: "Iván Inactivo",     correo: "inactivo@techcorp.pe",         rol: "EMPLEADO",   depto: "FINANZAS", nivel: 3, estado: "INACTIVO" },
  { nombre: "Irene Invitada",    correo: "invitado@externo.com",         rol: "INVITADO",   depto: "GLOBAL",   nivel: 1, tipo: "EXTERNO", expira: "2027-12-31" },
  { nombre: "Víctor Vencido",    correo: "invitado.vencido@externo.com", rol: "INVITADO",   depto: "GLOBAL",   nivel: 1, tipo: "EXTERNO", expira: "2025-01-01" },
];

// ---------- Documentos de prueba (sin archivo todavía) ----------
export interface DocumentoSeed {
  titulo: string;
  depto: string;
  nivel: number;
  estado: EstadoDocumento;
  propietario: string;
}

export const DOCUMENTOS: DocumentoSeed[] = [
  { titulo: "Presupuesto 2026",              depto: "FINANZAS",    nivel: 2, estado: "PUBLICADO", propietario: "empleado.fin@techcorp.pe" },
  { titulo: "Informe trimestral Q3",         depto: "FINANZAS",    nivel: 3, estado: "PENDIENTE", propietario: "empleado.fin@techcorp.pe" },
  { titulo: "Plan de inversiones",           depto: "FINANZAS",    nivel: 4, estado: "PENDIENTE", propietario: "gerente.fin@techcorp.pe" },
  { titulo: "Estados financieros auditados", depto: "FINANZAS",    nivel: 5, estado: "PUBLICADO", propietario: "gerente.fin@techcorp.pe" },
  { titulo: "Propuesta de la supervisora",   depto: "FINANZAS",    nivel: 3, estado: "PENDIENTE", propietario: "supervisor.fin@techcorp.pe" },
  { titulo: "Documento para eliminar",       depto: "FINANZAS",    nivel: 2, estado: "BORRADOR",  propietario: "empleado.fin@techcorp.pe" },
  { titulo: "Planilla de sueldos",           depto: "RRHH",        nivel: 3, estado: "PUBLICADO", propietario: "empleado.rrhh@techcorp.pe" },
  { titulo: "Manual de bienvenida",          depto: "OPERACIONES", nivel: 1, estado: "PUBLICADO", propietario: "admin@techcorp.pe" },
  { titulo: "Contrato confidencial",         depto: "LEGAL",       nivel: 4, estado: "PUBLICADO", propietario: "admin@techcorp.pe" },
];
