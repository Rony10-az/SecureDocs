/** Auditoría: inmutable, completa, sin secretos, con alcance por departamento y obligatoria (sin rastro no hay acción). */
import { audit } from "../../src/audit/audit.service";
import { prisma } from "../../src/db";
import {
  CORREOS,
  api,
  auditoriaDesde,
  cerrar,
  crearDocumento,
  fijarRelojDePruebas,
  iniciarSesion,
  limpiarDocumentos,
  marcaAuditoria,
  restaurarReloj,
  sesiones,
  sinSesion,
  verificarEntorno,
} from "./soporte";
import request from "supertest";
import { app } from "../../src/app";

describe("Auditoría", () => {
  let T: Awaited<ReturnType<typeof sesiones<"eduardo" | "gerente" | "auditor" | "admin" | "rrhh" | "inactivo" | "vencido">>>;

  beforeAll(async () => {
    await verificarEntorno();
    fijarRelojDePruebas();
    T = await sesiones(["eduardo", "gerente", "auditor", "admin", "rrhh", "inactivo", "vencido"]);
  });

  afterAll(async () => {
    restaurarReloj();
    await limpiarDocumentos();
    await cerrar();
  });

  describe("inmutabilidad: un trigger de PostgreSQL rechaza UPDATE, DELETE y TRUNCATE", () => {
    // Cada intento corre dentro de una transacción que SIEMPRE se revierte: si el trigger faltara, la prueba
    // fallaría (el mensaje no sería el esperado) pero NO se perdería ningún dato de la auditoría.
    const REVERTIR = new Error("__revertir__");
    const intento = (sql: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        throw REVERTIR;
      });

    test("UPDATE de una fila", async () => {
      const fila = await prisma.auditoria.findFirstOrThrow({ orderBy: { id: "desc" } });
      await expect(intento(`UPDATE auditoria SET motivo = 'alterado' WHERE id = ${fila.id}`)).rejects.toThrow(/La tabla auditoria es inmutable: UPDATE no permitido/);
      expect((await prisma.auditoria.findUniqueOrThrow({ where: { id: fila.id } })).motivo).toBe(fila.motivo);
    });

    test("UPDATE de todas las filas", async () => {
      await expect(intento("UPDATE auditoria SET resultado = 'PERMITIDO'")).rejects.toThrow(/inmutable: UPDATE/);
    });

    test("DELETE de una fila", async () => {
      const antes = await prisma.auditoria.count();
      const fila = await prisma.auditoria.findFirstOrThrow({ orderBy: { id: "desc" } });
      await expect(intento(`DELETE FROM auditoria WHERE id = ${fila.id}`)).rejects.toThrow(/inmutable: DELETE/);
      expect(await prisma.auditoria.count()).toBe(antes); // no se perdió ni una fila
    });

    test("DELETE de toda la tabla", async () => {
      await expect(intento("DELETE FROM auditoria")).rejects.toThrow(/inmutable: DELETE/);
    });

    test("TRUNCATE", async () => {
      await expect(intento("TRUNCATE TABLE auditoria")).rejects.toThrow(/inmutable: TRUNCATE/);
    });

    test("en cambio, INSERT sí funciona: es lo que hace la API en cada decisión", async () => {
      const marca = await marcaAuditoria();
      await api(T.eduardo).get("/auth/me");
      await api(T.eduardo).get("/documentos?limite=1"); // decisión DOC_READ sobre la colección
      expect((await auditoriaDesde(marca)).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("cada inicio de sesión queda registrado", () => {
    test("login correcto: LOGIN / PERMITIDO / AUTENTICACION, ligado al usuario, con su entorno", async () => {
      const eduardo = await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS.eduardo } });
      const marca = await marcaAuditoria();
      await iniciarSesion(CORREOS.eduardo);
      const filas = await auditoriaDesde(marca, { usuario_correo: CORREOS.eduardo, accion: "LOGIN" });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        usuario_id: eduardo.id,
        recurso: "sesion",
        resultado: "PERMITIDO",
        etapa: "AUTENTICACION",
        politica_codigo: null,
        motivo: "Inicio de sesión exitoso",
        ubicacion: "PERU",
        dispositivo: "CORPORATIVO",
      });
      expect(filas[0].ip).toBeTruthy();
    });

    test("contraseña incorrecta de una cuenta que EXISTE: DENEGADO y ligado a esa cuenta (el gerente de su área lo ve)", async () => {
      const eduardo = await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS.eduardo } });
      const marca = await marcaAuditoria();
      const r = await request(app).post("/auth/login").send({ correo: CORREOS.eduardo, password: "contraseña-equivocada-1" });
      expect(r.status).toBe(401);
      const filas = await auditoriaDesde(marca, { accion: "LOGIN" });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ usuario_id: eduardo.id, usuario_correo: CORREOS.eduardo, resultado: "DENEGADO", etapa: "AUTENTICACION", motivo: "Credenciales inválidas" });
    });

    test("un correo que NO existe: DENEGADO con usuario_id nulo y el correo probado", async () => {
      const marca = await marcaAuditoria();
      const r = await request(app).post("/auth/login").send({ correo: "  Nadie.Existe@TechCorp.pe ", password: "cualquiera-123" });
      expect(r.status).toBe(401);
      const filas = await auditoriaDesde(marca, { accion: "LOGIN" });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ usuario_id: null, usuario_correo: "nadie.existe@techcorp.pe", resultado: "DENEGADO", motivo: "Credenciales inválidas" });
    });

    test("las contraseñas probadas NUNCA se guardan", async () => {
      const secreto = "Contraseña-Secreta-Que-No-Debe-Guardarse-7";
      const marca = await marcaAuditoria();
      await request(app).post("/auth/login").send({ correo: CORREOS.eduardo, password: secreto });
      const filas = await auditoriaDesde(marca);
      expect(filas.length).toBeGreaterThan(0);
      const texto = JSON.stringify(filas, (_clave, valor: unknown) => (typeof valor === "bigint" ? valor.toString() : valor));
      expect(texto).not.toContain(secreto);
    });

    test("un cuerpo inválido (400) no es un intento de login: no deja registro", async () => {
      const marca = await marcaAuditoria();
      expect((await request(app).post("/auth/login").send({ correo: "no-es-correo" })).status).toBe(400);
      expect(await auditoriaDesde(marca)).toHaveLength(0);
    });

    test("un usuario INACTIVO sí puede iniciar sesión (autenticar no es autorizar); lo deniega P7 y queda registrado", async () => {
      const marca = await marcaAuditoria();
      const r = await api(T.inactivo).get("/documentos");
      expect(r.status).toBe(403);
      const filas = await auditoriaDesde(marca, { usuario_correo: CORREOS.inactivo });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ resultado: "DENEGADO", etapa: "ESTADO", politica_codigo: "P7" });
    });
  });

  describe("qué NO se audita (para que nadie pueda inundar la tabla sin autenticarse)", () => {
    test("una petición sin token (401), una ruta que no existe (404) y un id mal formado (400) no dejan registro", async () => {
      const marca = await marcaAuditoria();
      expect((await sinSesion().get("/documentos")).status).toBe(401);
      expect((await sinSesion().get("/esta-ruta-no-existe")).status).toBe(404);
      expect((await api(T.eduardo).get("/documentos/abc")).status).toBe(400);
      expect(await auditoriaDesde(marca)).toHaveLength(0);
    });
  });

  describe("GET /auditoria", () => {
    test.each([
      ["Eduardo (EMPLEADO)", "eduardo"],
      ["la empleada de RRHH", "rrhh"],
    ] as const)("%s no tiene AUDIT_READ: 403 RBAC", async (_nombre, persona) => {
      const r = await api(T[persona]).get("/auditoria");
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ etapa: "RBAC", politica: null, motivo: "Denegado por RBAC" });
    });

    test("un usuario inactivo (P7) y un invitado vencido (P9) tampoco", async () => {
      expect((await api(T.inactivo).get("/auditoria")).body).toMatchObject({ etapa: "ESTADO", politica: "P7" });
      expect((await api(T.vencido).get("/auditoria")).body).toMatchObject({ etapa: "ESTADO", politica: "P9" });
    });

    test("sin token: 401", async () => {
      expect((await sinSesion().get("/auditoria")).status).toBe(401);
    });

    test("el auditor lista: forma { total, pagina, limite, registros } y CONSULTAR la auditoría también se audita", async () => {
      const r = await api(T.auditor).get("/auditoria?limite=5");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ pagina: 1, limite: 5 });
      expect(r.body.registros.length).toBeLessThanOrEqual(5);
      for (const fila of r.body.registros) {
        expect(fila).toEqual(expect.objectContaining({ id: expect.any(Number), fecha: expect.any(String), accion: expect.any(String), recurso: expect.any(String), resultado: expect.stringMatching(/^(PERMITIDO|DENEGADO)$/), etapa: expect.any(String), motivo: expect.any(String) }));
      }
      // El registro más reciente es la propia lectura del auditor
      expect(r.body.registros[0]).toMatchObject({ usuario_correo: CORREOS.auditor, accion: "AUDIT_READ", resultado: "PERMITIDO", etapa: "COMPLETA" });
    });

    test("filtros: usuario, acción (sin distinguir mayúsculas), resultado y etapa", async () => {
      await api(T.rrhh).get("/documentos"); // deja una decisión de RRHH
      const porUsuario = (await api(T.auditor).get(`/auditoria?usuario=${CORREOS.rrhh}&limite=50`)).body;
      expect(porUsuario.total).toBeGreaterThanOrEqual(1);
      expect(porUsuario.registros.every((f: { usuario_correo: string }) => f.usuario_correo === CORREOS.rrhh)).toBe(true);

      const login = (await api(T.auditor).get("/auditoria?accion=login&limite=20")).body;
      expect(login.registros.every((f: { accion: string }) => f.accion === "LOGIN")).toBe(true);

      const den = (await api(T.auditor).get("/auditoria?resultado=DENEGADO&etapa=RBAC&limite=20")).body;
      expect(den.total).toBeGreaterThanOrEqual(1);
      expect(den.registros.every((f: { resultado: string; etapa: string }) => f.resultado === "DENEGADO" && f.etapa === "RBAC")).toBe(true);
    });

    test("filtro por fechas: desde el futuro no devuelve nada; hasta el pasado tampoco", async () => {
      expect((await api(T.auditor).get("/auditoria?desde=2999-01-01T00:00:00Z")).body.total).toBe(0);
      expect((await api(T.auditor).get("/auditoria?hasta=2000-01-01T00:00:00Z")).body.total).toBe(0);
    });

    test("paginación estable: con `hasta` (una foto fija) las páginas no se repiten aunque sigan entrando registros", async () => {
      // Como consultar la auditoría también se audita, cada lectura agrega una fila nueva ARRIBA y desplaza las
      // páginas. Quien recorre la auditoría fija la foto con `hasta` = la fecha de su primera lectura.
      const primera = (await api(T.auditor).get("/auditoria?limite=1")).body.registros[0];
      const foto = `hasta=${encodeURIComponent(primera.fecha)}`;
      const p1 = (await api(T.auditor).get(`/auditoria?${foto}&limite=3&pagina=1`)).body;
      const p2 = (await api(T.auditor).get(`/auditoria?${foto}&limite=3&pagina=2`)).body;

      const ids1: number[] = p1.registros.map((f: { id: number }) => f.id);
      const ids2: number[] = p2.registros.map((f: { id: number }) => f.id);
      expect(ids1).toHaveLength(3);
      expect(ids2).toHaveLength(3);
      expect(ids1.some((id) => ids2.includes(id))).toBe(false);
      expect(p2.total).toBe(p1.total); // la foto no cambia aunque entraron filas nuevas entre una petición y otra
      expect(Math.max(...ids1)).toBe(Number(primera.id)); // y empieza justo donde estaba la primera lectura
    });

    test.each(["limite=1000", "limite=0", "pagina=0", "resultado=QUIZAS", "etapa=XYZ", "desde=ayer"])("parámetro inválido ?%s -> 400", async (q) => {
      const r = await api(T.auditor).get(`/auditoria?${q}`);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("VALIDACION");
    });
  });

  describe("alcance por departamento (se decide por el atributo, no por el nombre del rol)", () => {
    test("el GERENTE de FINANZAS solo ve la actividad de su departamento; ADMIN y AUDITOR (GLOBAL) ven todo", async () => {
      // Hay actividad de otros departamentos y de usuarios GLOBAL
      await api(T.rrhh).get("/documentos");
      await api(T.admin).get("/usuarios?limite=1");
      await api(T.auditor).get("/documentos?limite=1");

      const ajenos = [CORREOS.rrhh, CORREOS.admin, CORREOS.auditor, CORREOS.invitado, CORREOS.vencido];
      const gerente = (await api(T.gerente).get("/auditoria?limite=200")).body;
      expect(gerente.registros.length).toBeGreaterThan(0);
      expect(gerente.registros.some((f: { usuario_correo: string | null }) => ajenos.includes(f.usuario_correo as never))).toBe(false);
      expect(gerente.registros.every((f: { usuario_id: number | null }) => f.usuario_id !== null)).toBe(true); // ni intentos de correos inexistentes

      const auditor = (await api(T.auditor).get("/auditoria?limite=200")).body;
      const vistos = new Set(auditor.registros.map((f: { usuario_correo: string | null }) => f.usuario_correo));
      expect(vistos.has(CORREOS.rrhh)).toBe(true);
      expect(vistos.has(CORREOS.admin)).toBe(true);
      expect(auditor.total).toBeGreaterThan(gerente.total);
    });
  });

  describe("sin rastro no hay acción", () => {
    test("si NO se puede escribir la auditoría, la acción NO se ejecuta (500): no se permite nada sin dejar constancia", async () => {
      const doc = await crearDocumento(T.eduardo, { titulo: "Se borraría sin auditoría", nivel: 1 });
      const espia = jest.spyOn(audit, "registrar").mockRejectedValueOnce(new Error("la BD de auditoría no responde"));
      const consola = jest.spyOn(console, "error").mockImplementation(() => undefined);

      const r = await api(T.gerente).delete(`/documentos/${doc.id}`);
      espia.mockRestore();
      consola.mockRestore();

      expect(r.status).toBe(500);
      expect(r.body).toMatchObject({ error: "ERROR_INTERNO", mensaje: "Error interno del servidor" }); // sin detalles internos
      expect((await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } })).eliminado_en).toBeNull(); // no se borró
    });
  });
});
