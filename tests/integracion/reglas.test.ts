/**
 * Catálogos (para llenar formularios), reglas de acceso (matriz RBAC y políticas ABAC leídas de la base de datos) y el
 * filtro `recurso` de la auditoría, que usa el frontend para mostrar el historial de un documento.
 */
import { DEPARTAMENTOS, MATRIZ_RBAC, PERMISOS, POLITICAS } from "../../prisma/datos";
import {
  api,
  auditoriaDesde,
  cerrar,
  crearDocumento,
  fijarRelojDePruebas,
  limpiarDocumentos,
  marcaAuditoria,
  restaurarReloj,
  sesiones,
  sinSesion,
  verificarEntorno,
} from "./soporte";

const ordenados = (xs: string[]) => [...xs].sort();

describe("Catálogos y reglas de acceso", () => {
  let T: Awaited<ReturnType<typeof sesiones<"eduardo" | "gerente" | "auditor" | "admin" | "inactivo" | "vencido">>>;

  beforeAll(async () => {
    await verificarEntorno();
    fijarRelojDePruebas();
    T = await sesiones(["eduardo", "gerente", "auditor", "admin", "inactivo", "vencido"]);
  });

  afterAll(async () => {
    restaurarReloj();
    await limpiarDocumentos();
    await cerrar();
  });

  describe("GET /catalogos", () => {
    test("sin sesión: 401", async () => {
      expect((await sinSesion().get("/catalogos")).status).toBe(401);
    });

    test("con sesión devuelve los roles, departamentos y permisos sembrados, y no deja rastro en la auditoría", async () => {
      const marca = await marcaAuditoria();
      const r = await api(T.eduardo).get("/catalogos");

      expect(r.status).toBe(200);
      expect(ordenados(r.body.roles)).toEqual(ordenados(Object.keys(MATRIZ_RBAC)));
      expect(ordenados(r.body.departamentos.map((d: { codigo: string }) => d.codigo))).toEqual(ordenados(DEPARTAMENTOS.map(([codigo]) => codigo)));
      expect(ordenados(r.body.permisos)).toEqual(ordenados(PERMISOS));
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(await auditoriaDesde(marca)).toHaveLength(0); // no es una decisión de autorización
    });
  });

  describe("GET /reglas", () => {
    test("sin sesión: 401 y sin rastro", async () => {
      const marca = await marcaAuditoria();
      expect((await sinSesion().get("/reglas")).status).toBe(401);
      expect(await auditoriaDesde(marca)).toHaveLength(0);
    });

    test.each(["auditor", "gerente", "admin"] as const)("%s (tiene AUDIT_READ) la lee y queda UN registro de auditoría sobre el recurso «reglas»", async (quien) => {
      const marca = await marcaAuditoria();
      const r = await api(T[quien]).get("/reglas");

      expect(r.status).toBe(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      const filas = await auditoriaDesde(marca);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ accion: "AUDIT_READ", recurso: "reglas", resultado: "PERMITIDO", etapa: "COMPLETA" });
    });

    test("trae la matriz RBAC exacta: la misma que se siembra", async () => {
      const r = await api(T.auditor).get("/reglas");
      const porRol = Object.fromEntries(r.body.rbac.roles.map((x: { nombre: string; permisos: string[] }) => [x.nombre, x.permisos]));

      expect(ordenados(r.body.rbac.permisos)).toEqual(ordenados(PERMISOS));
      expect(ordenados(Object.keys(porRol))).toEqual(ordenados(Object.keys(MATRIZ_RBAC)));
      for (const [rol, permisos] of Object.entries(MATRIZ_RBAC)) expect(ordenados(porRol[rol])).toEqual(ordenados(permisos));
    });

    test("trae las 11 políticas ABAC con su condición, en el orden real de evaluación (ESTADO y luego ABAC, por orden)", async () => {
      const r = await api(T.auditor).get("/reglas");
      const abac = r.body.abac as Array<{ codigo: string }>;

      expect(abac.map((p) => p.codigo)).toEqual(["P7", "P9", "P1", "P8", "P2", "P3", "P4", "P5", "P6", "P10", "P11"]);
      for (const esperada of POLITICAS) {
        expect(abac.find((p) => p.codigo === esperada.codigo)).toMatchObject({
          nombre: esperada.nombre,
          etapa: esperada.etapa,
          orden: esperada.orden,
          acciones: esperada.acciones,
          roles_exceptuados: esperada.roles_exceptuados,
          motivo_denegacion: esperada.motivo_denegacion,
          condicion: esperada.condicion,
          activa: true,
        });
      }
      expect(abac.some((p) => "id" in p)).toBe(false); // no se exponen ids internos
    });

    test("un empleado no puede leerlas: 403 por RBAC, auditado y sin filtrar nada", async () => {
      const marca = await marcaAuditoria();
      const r = await api(T.eduardo).get("/reglas");

      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: "ACCESO_DENEGADO", mensaje: "Denegado por RBAC", etapa: "RBAC", politica: null, motivo: "Denegado por RBAC" });
      const filas = await auditoriaDesde(marca);
      expect(filas).toHaveLength(1);
      // Una denegación en ESTADO o RBAC ocurre ANTES de cargar el recurso: se etiqueta por el tipo de la acción
      expect(filas[0]).toMatchObject({ accion: "AUDIT_READ", recurso: "auditoria", resultado: "DENEGADO", etapa: "RBAC" });
    });

    test.each([
      ["inactivo", "P7", "Usuario inactivo o suspendido"],
      ["vencido", "P9", "Acceso temporal vencido"],
    ] as const)("%s: se deniega en la etapa ESTADO (%s), antes de mirar el rol", async (quien, politica, motivo) => {
      const r = await api(T[quien]).get("/reglas");
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ etapa: "ESTADO", politica, motivo });
    });
  });

  describe("GET /auditoria?recurso= (historial de un documento)", () => {
    test("devuelve solo lo ocurrido con ese documento", async () => {
      const doc = await crearDocumento(T.eduardo, { titulo: "zz-reglas-historial", nivel: 1, archivo: false });
      await api(T.eduardo).get(`/documentos/${doc.id}`);
      await api(T.eduardo).put(`/documentos/${doc.id}`).send({ titulo: "zz-reglas-historial-2" });

      const r = await api(T.auditor).get(`/auditoria?recurso=documento:${doc.id}&limite=50`);
      const registros = r.body.registros as Array<{ recurso: string; accion: string }>;

      expect(r.status).toBe(200);
      expect(registros.every((x) => x.recurso === `documento:${doc.id}`)).toBe(true);
      expect(registros.map((x) => x.accion).sort()).toEqual(["DOC_READ", "DOC_UPDATE"]);
      expect(r.body.total).toBe(2);
    });

    test("un recurso sin historial devuelve una lista vacía", async () => {
      const r = await api(T.auditor).get("/auditoria?recurso=documento:2147483000");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ total: 0, registros: [] });
    });

    test("un recurso demasiado largo es un 400 de validación", async () => {
      expect((await api(T.auditor).get(`/auditoria?recurso=${"x".repeat(61)}`)).status).toBe(400);
    });
  });
});
