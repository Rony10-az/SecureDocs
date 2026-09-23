import { PrismaClient, Prisma, TipoContrato, EstadoUsuario, EstadoDocumento } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---------- RBAC ----------
const PERMISOS = [
  "DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE",
  "DOC_DOWNLOAD", "AUDIT_READ", "USER_MANAGE", "ROLE_ASSIGN",
];

const MATRIZ_RBAC: Record<string, string[]> = {
  ADMIN: PERMISOS,
  GERENTE: ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE", "DOC_DOWNLOAD", "AUDIT_READ"],
  SUPERVISOR: ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_APPROVE", "DOC_DOWNLOAD"],
  EMPLEADO: ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DOWNLOAD"],
  AUDITOR: ["DOC_READ", "DOC_DOWNLOAD", "AUDIT_READ"],
  INVITADO: ["DOC_READ"],
};

const DEPARTAMENTOS: [string, string][] = [
  ["FINANZAS", "Finanzas"],
  ["RRHH", "Recursos Humanos"],
  ["LEGAL", "Legal"],
  ["TI", "Tecnologías de la Información"],
  ["OPERACIONES", "Operaciones"],
  ["GLOBAL", "Global (transversal)"],
];

// ---------- ABAC ----------
const ACCIONES_DOC = ["DOC_CREATE", "DOC_READ", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE", "DOC_DOWNLOAD"];
const NIVEL_ALTO = { "recurso.nivel_confidencialidad": { gte: 4 } };

const POLITICAS: Prisma.PoliticaCreateInput[] = [
  {
    codigo: "P7", nombre: "Estado del usuario", etapa: "ESTADO", orden: 1,
    acciones: ["*"], roles_exceptuados: [],
    condicion: { "usuario.estado": { eq: "ACTIVO" } },
    motivo_denegacion: "Usuario inactivo o suspendido",
  },
  {
    codigo: "P9", nombre: "Expiración de acceso externo", etapa: "ESTADO", orden: 2,
    acciones: ["*"], roles_exceptuados: [],
    condicion: {
      si: { "usuario.tipo_contrato": { eq: "EXTERNO" } },
      entonces: { "usuario.fecha_expiracion": { gteAttr: "entorno.fecha" } },
    },
    motivo_denegacion: "Acceso temporal vencido",
  },
  {
    codigo: "P1", nombre: "Departamento", orden: 10,
    acciones: ACCIONES_DOC, roles_exceptuados: ["ADMIN", "AUDITOR", "INVITADO"],
    condicion: { "usuario.departamento": { eqAttr: "recurso.departamento" } },
    motivo_denegacion: "Documento de otro departamento",
  },
  {
    codigo: "P2", nombre: "Nivel de seguridad", orden: 20,
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: { "usuario.nivel_seguridad": { gteAttr: "recurso.nivel_confidencialidad" } },
    motivo_denegacion: "Nivel de seguridad insuficiente",
  },
  {
    codigo: "P3", nombre: "Propiedad", orden: 30,
    acciones: ["DOC_UPDATE"], roles_exceptuados: ["GERENTE", "ADMIN"],
    condicion: { "usuario.id": { eqAttr: "recurso.propietario_id" } },
    motivo_denegacion: "Solo puede modificar sus propios documentos",
  },
  {
    codigo: "P4", nombre: "Horario laboral", orden: 40,
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: {
      si: NIVEL_ALTO,
      entonces: { all: [{ "entorno.hora": { gte: "08:00" } }, { "entorno.hora": { lt: "18:00" } }] },
    },
    motivo_denegacion: "Fuera del horario autorizado",
  },
  {
    codigo: "P5", nombre: "País", orden: 50,
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: { "entorno.ubicacion": { eqAttr: "recurso.pais" } },
    motivo_denegacion: "Acceso desde país no autorizado",
  },
  {
    codigo: "P6", nombre: "Dispositivo", orden: 60,
    acciones: ACCIONES_DOC, roles_exceptuados: [],
    condicion: { si: NIVEL_ALTO, entonces: { "entorno.dispositivo": { eq: "CORPORATIVO" } } },
    motivo_denegacion: "Requiere dispositivo corporativo",
  },
  {
    codigo: "P8", nombre: "Invitado", orden: 70,
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
  },
  {
    codigo: "P10", nombre: "Autoaprobación", orden: 80,
    acciones: ["DOC_APPROVE"], roles_exceptuados: [],
    condicion: { "usuario.id": { neqAttr: "recurso.propietario_id" } },
    motivo_denegacion: "No puede aprobar su propio documento",
  },
];

// ---------- Usuarios de prueba (contraseña: Secure123!) ----------
interface UsuarioSeed {
  nombre: string; correo: string; rol: string; depto: string; nivel: number;
  tipo?: TipoContrato; estado?: EstadoUsuario; expira?: string;
}

const USUARIOS: UsuarioSeed[] = [
  { nombre: "Ana Admin",          correo: "admin@techcorp.pe",         rol: "ADMIN",      depto: "GLOBAL",   nivel: 5 },
  { nombre: "Gabriel Gerente",    correo: "gerente.fin@techcorp.pe",   rol: "GERENTE",    depto: "FINANZAS", nivel: 5 },
  { nombre: "Sara Supervisora",   correo: "supervisor.fin@techcorp.pe",rol: "SUPERVISOR", depto: "FINANZAS", nivel: 4 },
  { nombre: "Eduardo Empleado",   correo: "empleado.fin@techcorp.pe",  rol: "EMPLEADO",   depto: "FINANZAS", nivel: 3 },
  { nombre: "Elena Empleada",     correo: "empleado2.fin@techcorp.pe", rol: "EMPLEADO",   depto: "FINANZAS", nivel: 3 },
  { nombre: "Pedro Practicante",  correo: "practicante.fin@techcorp.pe", rol: "EMPLEADO", depto: "FINANZAS", nivel: 2 },
  { nombre: "Rita RRHH",          correo: "empleado.rrhh@techcorp.pe", rol: "EMPLEADO",   depto: "RRHH",     nivel: 3 },
  { nombre: "Alberto Auditor",    correo: "auditor@techcorp.pe",       rol: "AUDITOR",    depto: "GLOBAL",   nivel: 5 },
  { nombre: "Iván Inactivo",      correo: "inactivo@techcorp.pe",      rol: "EMPLEADO",   depto: "FINANZAS", nivel: 3, estado: "INACTIVO" },
  { nombre: "Irene Invitada",     correo: "invitado@externo.com",      rol: "INVITADO",   depto: "GLOBAL",   nivel: 1, tipo: "EXTERNO", expira: "2027-12-31" },
  { nombre: "Víctor Vencido",     correo: "invitado.vencido@externo.com", rol: "INVITADO", depto: "GLOBAL",  nivel: 1, tipo: "EXTERNO", expira: "2025-01-01" },
];

// ---------- Documentos de prueba (sin archivo todavía) ----------
interface DocumentoSeed {
  titulo: string; depto: string; nivel: number; estado: EstadoDocumento; propietario: string;
}

const DOCUMENTOS: DocumentoSeed[] = [
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

async function main() {
  // Departamentos
  for (const [codigo, nombre] of DEPARTAMENTOS) {
    await prisma.departamento.upsert({ where: { codigo }, update: { nombre }, create: { codigo, nombre } });
  }

  // Permisos
  for (const codigo of PERMISOS) {
    await prisma.permiso.upsert({ where: { codigo }, update: {}, create: { codigo } });
  }

  // Roles + matriz RBAC (se reescribe completa para reflejar cambios)
  for (const [nombre, codigos] of Object.entries(MATRIZ_RBAC)) {
    const rol = await prisma.rol.upsert({ where: { nombre }, update: {}, create: { nombre } });
    const permisos = await prisma.permiso.findMany({ where: { codigo: { in: codigos } } });
    await prisma.rolPermiso.deleteMany({ where: { rol_id: rol.id } });
    await prisma.rolPermiso.createMany({
      data: permisos.map((p) => ({ rol_id: rol.id, permiso_id: p.id })),
    });
  }

  // Políticas ABAC
  for (const politica of POLITICAS) {
    await prisma.politica.upsert({ where: { codigo: politica.codigo }, update: politica, create: politica });
  }

  // Mapas código -> id
  const deptos = Object.fromEntries((await prisma.departamento.findMany()).map((d) => [d.codigo, d.id]));
  const roles = Object.fromEntries((await prisma.rol.findMany()).map((r) => [r.nombre, r.id]));

  // Usuarios
  const hash = await bcrypt.hash("Secure123!", 10);
  for (const u of USUARIOS) {
    const datos = {
      nombre: u.nombre,
      correo: u.correo,
      password_hash: hash,
      rol_id: roles[u.rol],
      departamento_id: deptos[u.depto],
      nivel_seguridad: u.nivel,
      pais: "PERU",
      tipo_contrato: u.tipo ?? "INTERNO",
      estado: u.estado ?? "ACTIVO",
      fecha_expiracion: u.expira ? new Date(u.expira) : null,
    } satisfies Prisma.UsuarioUncheckedCreateInput;
    await prisma.usuario.upsert({ where: { correo: u.correo }, update: datos, create: datos });
  }

  // Documentos (solo si la tabla está vacía)
  if ((await prisma.documento.count()) === 0) {
    const usuarios = Object.fromEntries((await prisma.usuario.findMany()).map((u) => [u.correo, u.id]));
    for (const d of DOCUMENTOS) {
      await prisma.documento.create({
        data: {
          titulo: d.titulo,
          propietario_id: usuarios[d.propietario],
          departamento_id: deptos[d.depto],
          nivel_confidencialidad: d.nivel,
          estado: d.estado,
          pais: "PERU",
        },
      });
    }
  }

  console.log("Seed completado ✔");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
