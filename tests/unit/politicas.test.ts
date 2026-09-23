/** Las políticas P1–P10 tal como las siembra `prisma/seed.ts`, evaluadas con el motor real. */
import { MATRIZ_RBAC, PERMISOS, POLITICAS } from "../../prisma/datos";
import { validarCondicion } from "../../src/authorization/abac/condicion";
import { evaluarPoliticas } from "../../src/authorization/abac/policy-engine";
import type { ContextoAutorizacion, Decision, RecursoCtx } from "../../src/authorization/tipos";
import { documento, entorno, usuario } from "./helpers";

const PERMITIDO: Decision = { permitido: true };
const denegado = (politica: string, motivo: string, etapa: "ABAC" | "ESTADO" = "ABAC"): Decision => ({
  permitido: false,
  etapa,
  politica,
  motivo,
});

const abac = (ctx: ContextoAutorizacion, accion: string) => evaluarPoliticas(POLITICAS, ctx, accion, "ABAC");
const estado = (ctx: ContextoAutorizacion, accion: string) => evaluarPoliticas(POLITICAS, ctx, accion, "ESTADO");

const eduardo = "empleado.fin@techcorp.pe"; // EMPLEADO · FINANZAS · nivel 3
const base = (): ContextoAutorizacion => ({
  usuario: usuario(eduardo),
  entorno: entorno(),
  recurso: documento("Presupuesto 2026"), // FINANZAS · nivel 2 · PERU
});

describe("datos del seed", () => {
  test("están las 11 políticas (P1..P10 de la guía + P11 del grupo), sin repetirse", () => {
    const codigos = POLITICAS.map((p) => p.codigo).sort();
    expect(codigos).toEqual(["P1", "P10", "P11", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]);
  });

  test("todas las condiciones están bien escritas", () => {
    for (const p of POLITICAS) expect({ codigo: p.codigo, problemas: validarCondicion(p.condicion) }).toEqual({ codigo: p.codigo, problemas: [] });
  });

  test("P7 y P9 son de la etapa ESTADO (antes de RBAC); el resto es ABAC", () => {
    const deEstado = POLITICAS.filter((p) => p.etapa === "ESTADO").map((p) => p.codigo).sort();
    expect(deEstado).toEqual(["P7", "P9"]);
  });

  test("el 'orden' no se repite dentro de una etapa (el desempate no depende del azar)", () => {
    for (const etapa of ["ESTADO", "ABAC"] as const) {
      const ordenes = POLITICAS.filter((p) => p.etapa === etapa).map((p) => p.orden);
      expect(new Set(ordenes).size).toBe(ordenes.length);
    }
  });

  test("P8 se evalúa antes que P2 (así el caso 12 se deniega por P8)", () => {
    const orden = (c: string) => POLITICAS.find((p) => p.codigo === c)!.orden;
    expect(orden("P8")).toBeLessThan(orden("P2"));
  });

  test("todas traen motivo de denegación y están activas", () => {
    for (const p of POLITICAS) {
      expect(p.motivo_denegacion.length).toBeGreaterThan(0);
      expect(p.activa).toBe(true);
    }
  });
});

describe("matriz RBAC del seed = matriz de la guía (sección 5)", () => {
  // Cada fila de la tabla de la guía: qué roles tienen ✓
  const filasDeLaGuia: Array<[string, string[]]> = [
    ["DOC_CREATE", ["ADMIN", "GERENTE", "SUPERVISOR", "EMPLEADO"]],
    ["DOC_READ", ["ADMIN", "GERENTE", "SUPERVISOR", "EMPLEADO", "AUDITOR", "INVITADO"]],
    ["DOC_UPDATE", ["ADMIN", "GERENTE", "SUPERVISOR", "EMPLEADO"]],
    ["DOC_DELETE", ["ADMIN", "GERENTE"]],
    ["DOC_APPROVE", ["ADMIN", "GERENTE", "SUPERVISOR"]],
    ["DOC_DOWNLOAD", ["ADMIN", "GERENTE", "SUPERVISOR", "EMPLEADO", "AUDITOR"]],
    ["AUDIT_READ", ["ADMIN", "GERENTE", "AUDITOR"]],
    ["USER_MANAGE", ["ADMIN"]],
    ["ROLE_ASSIGN", ["ADMIN"]],
  ];

  test.each(filasDeLaGuia)("%s", (accion, roles) => {
    const conPermiso = Object.keys(MATRIZ_RBAC).filter((rol) => MATRIZ_RBAC[rol].includes(accion));
    expect(conPermiso.sort()).toEqual([...roles].sort());
  });

  test("6 roles y 9 permisos", () => {
    expect(Object.keys(MATRIZ_RBAC)).toHaveLength(6);
    expect(PERMISOS).toHaveLength(9);
  });
});

describe("P7 · usuario activo (etapa ESTADO)", () => {
  test.each(["INACTIVO", "SUSPENDIDO"] as const)("usuario %s → denegado", (est) => {
    const ctx = { ...base(), usuario: usuario(eduardo, { estado: est }) };
    expect(estado(ctx, "DOC_READ")).toEqual(denegado("P7", "Usuario inactivo o suspendido", "ESTADO"));
  });

  test("aplica a TODAS las acciones, incluso las que no tienen recurso, y no exime a nadie (ni al ADMIN)", () => {
    const ctx = { usuario: usuario("admin@techcorp.pe", { estado: "SUSPENDIDO" }), entorno: entorno() };
    for (const accion of ["AUDIT_READ", "USER_MANAGE", "DOC_CREATE"]) {
      expect(estado(ctx, accion)).toEqual(denegado("P7", "Usuario inactivo o suspendido", "ESTADO"));
    }
  });

  test("usuario ACTIVO → pasa", () => {
    expect(estado(base(), "DOC_READ")).toEqual(PERMITIDO);
  });
});

describe("P9 · expiración del acceso externo (etapa ESTADO)", () => {
  const conExpiracion = (expira: string | null) => ({
    usuario: usuario("invitado@externo.com", { fecha_expiracion: expira }),
    entorno: entorno({ fecha: "2026-09-23" }),
  });
  const VENCIDO = denegado("P9", "Acceso temporal vencido", "ESTADO");

  test("expiró ayer → denegado", () => expect(estado(conExpiracion("2026-09-22"), "DOC_READ")).toEqual(VENCIDO));
  test("expira hoy → todavía permitido (hoy <= expiración)", () => expect(estado(conExpiracion("2026-09-23"), "DOC_READ")).toEqual(PERMITIDO));
  test("expira mañana → permitido", () => expect(estado(conExpiracion("2026-09-24"), "DOC_READ")).toEqual(PERMITIDO));
  test("externo SIN fecha de expiración → denegado (un acceso temporal debe tener fin)", () => {
    expect(estado(conExpiracion(null), "DOC_READ")).toEqual(VENCIDO);
  });
  test("un usuario INTERNO no se ve afectado aunque tenga una fecha pasada", () => {
    const ctx = { usuario: usuario(eduardo, { fecha_expiracion: "2020-01-01" }), entorno: entorno() };
    expect(estado(ctx, "DOC_READ")).toEqual(PERMITIDO);
  });
});

describe("P1 · departamento", () => {
  const DEPTO = denegado("P1", "Documento de otro departamento");

  test("documento de otro departamento → denegado", () => {
    expect(abac({ ...base(), recurso: documento("Planilla de sueldos") }, "DOC_READ")).toEqual(DEPTO);
  });
  test("documento del mismo departamento → permitido", () => {
    expect(abac(base(), "DOC_READ")).toEqual(PERMITIDO);
  });
  test("el GERENTE tampoco entra a otro departamento", () => {
    const ctx = { ...base(), usuario: usuario("gerente.fin@techcorp.pe"), recurso: documento("Planilla de sueldos") };
    expect(abac(ctx, "DOC_DELETE")).toEqual(DEPTO);
  });
  test.each(["admin@techcorp.pe", "auditor@techcorp.pe"])("%s (departamento GLOBAL) está exceptuado", (correo) => {
    const ctx = { ...base(), usuario: usuario(correo), recurso: documento("Planilla de sueldos") };
    expect(abac(ctx, "DOC_READ")).toEqual(PERMITIDO);
  });
  test("aplica a las demás acciones sobre documentos, no solo a la lectura", () => {
    for (const accion of ["DOC_CREATE", "DOC_UPDATE", "DOC_DELETE", "DOC_APPROVE", "DOC_DOWNLOAD"]) {
      expect(abac({ ...base(), recurso: documento("Planilla de sueldos") }, accion)).toEqual(DEPTO);
    }
  });
});

describe("P2 · nivel de seguridad", () => {
  const NIVEL = denegado("P2", "Nivel de seguridad insuficiente");
  const informe = documento("Informe trimestral Q3"); // nivel 3

  test("nivel menor que el del documento → denegado", () => {
    expect(abac({ ...base(), usuario: usuario(eduardo, { nivel_seguridad: 2 }), recurso: informe }, "DOC_READ")).toEqual(NIVEL);
  });
  test("nivel igual → permitido", () => {
    expect(abac({ ...base(), recurso: informe }, "DOC_READ")).toEqual(PERMITIDO);
  });
  test("nivel mayor → permitido", () => {
    expect(abac({ ...base(), usuario: usuario(eduardo, { nivel_seguridad: 5 }), recurso: informe }, "DOC_READ")).toEqual(PERMITIDO);
  });
});

describe("P3 · propiedad (solo DOC_UPDATE)", () => {
  const PROPIEDAD = denegado("P3", "Solo puede modificar sus propios documentos");
  const informe = documento("Informe trimestral Q3"); // propietario: Eduardo
  const ctx = (correo: string): ContextoAutorizacion => ({ usuario: usuario(correo), entorno: entorno(), recurso: informe });

  test("un compañero de área no puede modificarlo", () => expect(abac(ctx("empleado2.fin@techcorp.pe"), "DOC_UPDATE")).toEqual(PROPIEDAD));
  test("el propietario sí", () => expect(abac(ctx(eduardo), "DOC_UPDATE")).toEqual(PERMITIDO));
  test("el GERENTE está exceptuado", () => expect(abac(ctx("gerente.fin@techcorp.pe"), "DOC_UPDATE")).toEqual(PERMITIDO));
  test("el ADMIN está exceptuado", () => expect(abac(ctx("admin@techcorp.pe"), "DOC_UPDATE")).toEqual(PERMITIDO));
  test("el SUPERVISOR NO está exceptuado", () => expect(abac(ctx("supervisor.fin@techcorp.pe"), "DOC_UPDATE")).toEqual(PROPIEDAD));
  test("solo aplica a modificar: el compañero sí puede leer y descargar", () => {
    expect(abac(ctx("empleado2.fin@techcorp.pe"), "DOC_READ")).toEqual(PERMITIDO);
    expect(abac(ctx("empleado2.fin@techcorp.pe"), "DOC_DOWNLOAD")).toEqual(PERMITIDO);
  });
});

describe("P4 · horario (documentos de nivel 4 o 5: 08:00 <= hora < 18:00)", () => {
  const FUERA = denegado("P4", "Fuera del horario autorizado");
  const gerente = usuario("gerente.fin@techcorp.pe"); // nivel 5
  const a = (hora: string, doc: RecursoCtx, accion = "DOC_READ") =>
    abac({ usuario: gerente, entorno: entorno({ hora }), recurso: doc }, accion);

  test.each(["08:00", "12:30", "17:59"])("nivel 4 a las %s → permitido", (h) => {
    expect(a(h, documento("Plan de inversiones"))).toEqual(PERMITIDO);
  });
  test.each(["00:00", "07:59", "18:00", "20:00", "23:59"])("nivel 4 a las %s → denegado", (h) => {
    expect(a(h, documento("Plan de inversiones"))).toEqual(FUERA);
  });
  test("nivel 5 también está restringido", () => {
    expect(a("20:00", documento("Estados financieros auditados"))).toEqual(FUERA);
  });
  test("nivel 3 o menos no tiene restricción de horario", () => {
    expect(a("20:00", documento("Informe trimestral Q3"))).toEqual(PERMITIDO);
    expect(a("03:00", documento("Presupuesto 2026"))).toEqual(PERMITIDO);
  });
  test("aplica a todas las acciones sobre el documento", () => {
    for (const accion of ["DOC_UPDATE", "DOC_DELETE", "DOC_DOWNLOAD"]) {
      expect(a("20:00", documento("Plan de inversiones"), accion)).toEqual(FUERA);
    }
  });
});

describe("P5 · país", () => {
  const PAIS = denegado("P5", "Acceso desde país no autorizado");

  test("desde otro país → denegado", () => expect(abac({ ...base(), entorno: entorno({ ubicacion: "CHILE" }) }, "DOC_READ")).toEqual(PAIS));
  test("sin ubicación informada → denegado (denegar por defecto)", () => {
    expect(abac({ ...base(), entorno: entorno({ ubicacion: null }) }, "DOC_READ")).toEqual(PAIS);
  });
  test("desde el país del documento → permitido", () => expect(abac(base(), "DOC_READ")).toEqual(PERMITIDO));
  test("un documento de otro país exige ESE país", () => {
    const deChile = documento("Presupuesto 2026", { pais: "CHILE" });
    expect(abac({ ...base(), recurso: deChile, entorno: entorno({ ubicacion: "CHILE" }) }, "DOC_READ")).toEqual(PERMITIDO);
    expect(abac({ ...base(), recurso: deChile, entorno: entorno({ ubicacion: "PERU" }) }, "DOC_READ")).toEqual(PAIS);
  });
});

describe("P6 · dispositivo corporativo (documentos de nivel 4 o 5)", () => {
  const DISPOSITIVO = denegado("P6", "Requiere dispositivo corporativo");
  const gerente = usuario("gerente.fin@techcorp.pe");
  const a = (dispositivo: "CORPORATIVO" | "PERSONAL" | "DESCONOCIDO", doc: RecursoCtx) =>
    abac({ usuario: gerente, entorno: entorno({ dispositivo }), recurso: doc }, "DOC_READ");

  test("nivel 5 desde dispositivo PERSONAL → denegado", () => expect(a("PERSONAL", documento("Estados financieros auditados"))).toEqual(DISPOSITIVO));
  test("nivel 4 desde dispositivo DESCONOCIDO → denegado", () => expect(a("DESCONOCIDO", documento("Plan de inversiones"))).toEqual(DISPOSITIVO));
  test("nivel 4 desde CORPORATIVO → permitido", () => expect(a("CORPORATIVO", documento("Plan de inversiones"))).toEqual(PERMITIDO));
  test("nivel 3 desde PERSONAL → permitido (solo restringe desde nivel 4)", () => {
    expect(abac({ ...base(), entorno: entorno({ dispositivo: "PERSONAL" }), recurso: documento("Informe trimestral Q3") }, "DOC_READ")).toEqual(PERMITIDO);
  });
});

describe("P8 · invitado (solo DOC_READ)", () => {
  const INVITADO = denegado("P8", "Invitado solo accede a documentos públicos publicados");
  const lee = (doc: RecursoCtx, cambios = {}) =>
    abac({ usuario: usuario("invitado@externo.com", cambios), entorno: entorno(), recurso: doc }, "DOC_READ");

  test("nivel 1 y PUBLICADO → permitido", () => expect(lee(documento("Manual de bienvenida"))).toEqual(PERMITIDO));
  test("nivel 1 pero en BORRADOR → denegado", () => {
    expect(lee(documento("Manual de bienvenida", { estado: "BORRADOR" }))).toEqual(INVITADO);
  });
  test("publicado pero de nivel 2 → denegado", () => expect(lee(documento("Presupuesto 2026"))).toEqual(INVITADO));
  test("un INVITADO que no es EXTERNO no cumple", () => {
    expect(lee(documento("Manual de bienvenida"), { tipo_contrato: "INTERNO" })).toEqual(INVITADO);
  });
  test("no afecta a los demás roles (un empleado lee un borrador de su área)", () => {
    expect(abac({ ...base(), recurso: documento("Documento para eliminar") }, "DOC_READ")).toEqual(PERMITIDO);
  });
});

describe("P10 · autoaprobación (solo DOC_APPROVE)", () => {
  const AUTO = denegado("P10", "No puede aprobar su propio documento");
  const propuesta = documento("Propuesta de la supervisora"); // propietaria: Sara
  const ctx = (correo: string): ContextoAutorizacion => ({ usuario: usuario(correo), entorno: entorno(), recurso: propuesta });

  test("el propietario no aprueba lo suyo", () => expect(abac(ctx("supervisor.fin@techcorp.pe"), "DOC_APPROVE")).toEqual(AUTO));
  test("otra persona sí", () => expect(abac(ctx("gerente.fin@techcorp.pe"), "DOC_APPROVE")).toEqual(PERMITIDO));
  test("solo aplica a aprobar: la propietaria sí puede leer y modificar lo suyo", () => {
    expect(abac(ctx("supervisor.fin@techcorp.pe"), "DOC_READ")).toEqual(PERMITIDO);
    expect(abac(ctx("supervisor.fin@techcorp.pe"), "DOC_UPDATE")).toEqual(PERMITIDO);
  });
});

describe("P11 · autogestión de roles (solo ROLE_ASSIGN)", () => {
  const AUTO = denegado("P11", "No puede cambiar su propio rol");
  const admin = usuario("admin@techcorp.pe");
  // El "recurso" es el usuario cuyo rol se quiere cambiar. Sin `id` = un usuario que aún no existe (alta).
  const objetivo = (id?: number): RecursoCtx => ({
    tipo: "usuario",
    ...(id !== undefined && { id }),
    rol: "EMPLEADO",
    departamento: "FINANZAS",
    nivel_seguridad: 3,
    estado: "ACTIVO",
    tipo_contrato: "INTERNO",
    pais: "PERU",
  });
  const asigna = (id?: number, quien = admin, accion = "ROLE_ASSIGN") =>
    abac({ usuario: quien, entorno: entorno(), recurso: objetivo(id) }, accion);

  test("un administrador NO puede cambiarse su propio rol", () => expect(asigna(admin.id)).toEqual(AUTO));
  test("sí puede cambiar el de otra persona", () => expect(asigna(4)).toEqual(PERMITIDO));
  test("al CREAR un usuario todavía no hay id: la política no estorba las altas", () => expect(asigna(undefined)).toEqual(PERMITIDO));
  test("nadie está exceptuado: vale para cualquier rol", () => {
    const gerente = usuario("gerente.fin@techcorp.pe");
    expect(asigna(gerente.id, gerente)).toEqual(AUTO);
  });
  test("solo aplica a ROLE_ASSIGN: un administrador sí puede editar sus propios datos (USER_MANAGE)", () => {
    expect(asigna(admin.id, admin, "USER_MANAGE")).toEqual(PERMITIDO);
  });
  test("solo ADMIN tiene ROLE_ASSIGN y USER_MANAGE (RBAC)", () => {
    for (const permiso of ["ROLE_ASSIGN", "USER_MANAGE"]) {
      expect(Object.keys(MATRIZ_RBAC).filter((rol) => MATRIZ_RBAC[rol].includes(permiso))).toEqual(["ADMIN"]);
    }
  });
});

describe("varias violaciones a la vez: decide la primera según el orden de evaluación", () => {
  test("otro departamento Y otro país → P1 (no P5)", () => {
    const ctx = { ...base(), recurso: documento("Planilla de sueldos"), entorno: entorno({ ubicacion: "CHILE" }) };
    expect(abac(ctx, "DOC_READ")).toEqual(denegado("P1", "Documento de otro departamento"));
  });
  test("nivel insuficiente Y fuera de horario → P2 (no P4)", () => {
    const ctx = { ...base(), usuario: usuario("practicante.fin@techcorp.pe"), recurso: documento("Plan de inversiones"), entorno: entorno({ hora: "20:00" }) };
    expect(abac(ctx, "DOC_READ")).toEqual(denegado("P2", "Nivel de seguridad insuficiente"));
  });
  test("invitado + documento confidencial: incumple P8 y P2, decide P8", () => {
    const ctx = { ...base(), usuario: usuario("invitado@externo.com"), recurso: documento("Contrato confidencial") };
    expect(abac(ctx, "DOC_READ")).toEqual(denegado("P8", "Invitado solo accede a documentos públicos publicados"));
  });
  test("fuera de horario Y dispositivo personal → P4 (no P6)", () => {
    const ctx = {
      usuario: usuario("gerente.fin@techcorp.pe"),
      recurso: documento("Estados financieros auditados"),
      entorno: entorno({ hora: "20:00", dispositivo: "PERSONAL" }),
    };
    expect(abac(ctx, "DOC_READ")).toEqual(denegado("P4", "Fuera del horario autorizado"));
  });
});

test("una acción sin recurso (AUDIT_READ) no activa ninguna política ABAC de documentos", () => {
  const ctx = { usuario: usuario("auditor@techcorp.pe"), entorno: entorno({ ubicacion: null, dispositivo: "DESCONOCIDO" }) };
  expect(abac(ctx, "AUDIT_READ")).toEqual(PERMITIDO);
});
