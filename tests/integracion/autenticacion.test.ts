/** Autenticación (login y JWT), contexto de entorno, matriz RBAC por HTTP, errores uniformes y cabeceras de seguridad. */
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../../src/app";
import { config } from "../../src/config";
import { prisma } from "../../src/db";
import { CORREOS, ENTORNO_NORMAL, api, cerrar, fijarRelojDePruebas, iniciarSesion, restaurarReloj, sesiones, sinSesion, verificarEntorno } from "./soporte";

const sinSecretos = (cuerpo: unknown) => !/password|\$2[aby]\$/i.test(JSON.stringify(cuerpo));
const base64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("Autenticación", () => {
  let eduardoId: number;

  beforeAll(async () => {
    await verificarEntorno();
    fijarRelojDePruebas();
    eduardoId = (await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS.eduardo } })).id;
  });

  afterAll(async () => {
    restaurarReloj();
    await cerrar();
  });

  const login = (cuerpo: object | string) => request(app).post("/auth/login").set(ENTORNO_NORMAL).send(cuerpo as object);

  // -------------------------------------------------------------------------------------------------
  describe("POST /auth/login", () => {
    test("correcto: 200 con { token, tipo, expira_en, usuario } y sin contraseñas ni hashes", async () => {
      const r = await login({ correo: CORREOS.eduardo, password: "Secure123!" });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        tipo: "Bearer",
        expira_en: config.JWT_EXPIRES_IN,
        usuario: { id: eduardoId, correo: CORREOS.eduardo, rol: "EMPLEADO", departamento: "FINANZAS", nivel_seguridad: 3, estado: "ACTIVO" },
      });
      expect(sinSecretos(r.body)).toBe(true);
    });

    test("el token solo lleva la identidad (sub, iss, iat, exp): NADA de rol, estado ni nivel", async () => {
      const { token } = (await login({ correo: CORREOS.eduardo, password: "Secure123!" })).body;
      // Un JWT son tres partes: cabecera, cuerpo y firma (binaria: solo se decodifican las dos primeras)
      const [cabecera, cuerpo] = token.split(".").slice(0, 2).map((p: string) => JSON.parse(Buffer.from(p, "base64url").toString()));
      expect(cabecera).toMatchObject({ alg: "HS256", typ: "JWT" });
      expect(Object.keys(cuerpo).sort()).toEqual(["exp", "iat", "iss", "sub"]);
      expect(cuerpo).toMatchObject({ sub: String(eduardoId), iss: "securedocs" });
      expect(cuerpo.exp - cuerpo.iat).toBe(3600);
    });

    test("un correo con MAYÚSCULAS y espacios funciona (se normaliza)", async () => {
      expect((await login({ correo: "  EMPLEADO.FIN@TECHCORP.PE ", password: "Secure123!" })).status).toBe(200);
    });

    test("contraseña incorrecta y correo inexistente dan EXACTAMENTE la misma respuesta (no revelan qué cuentas existen)", async () => {
      const mala = await login({ correo: CORREOS.eduardo, password: "incorrecta-123" });
      const fantasma = await login({ correo: "nadie@techcorp.pe", password: "Secure123!" });
      expect(mala.status).toBe(401);
      expect(fantasma.status).toBe(401);
      expect(mala.body).toEqual(fantasma.body);
      expect(mala.body).toEqual({ error: "CREDENCIALES_INVALIDAS", mensaje: "Correo o contraseña incorrectos" });
    });

    test.each([
      ["falta la contraseña", { correo: CORREOS.eduardo }, "password"],
      ["correo mal formado", { correo: "esto-no-es-correo", password: "x" }, "correo"],
      ["contraseña de 200 caracteres", { correo: CORREOS.eduardo, password: "a".repeat(200) }, "password"],
      ["campos con objetos (intento de inyección tipo NoSQL)", { correo: { $ne: null }, password: { $ne: null } }, "correo"],
    ])("validación: %s -> 400", async (_caso, cuerpo, campo) => {
      const r = await login(cuerpo);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("VALIDACION");
      expect(r.body.detalles.map((d: { campo: string }) => d.campo)).toContain(campo);
    });

    test("un JSON mal formado y un cuerpo vacío -> 400", async () => {
      const malo = await request(app).post("/auth/login").set("Content-Type", "application/json").send('{"correo": ');
      expect(malo.status).toBe(400);
      expect(malo.body.error).toBe("VALIDACION");
      expect((await request(app).post("/auth/login")).status).toBe(400);
    });

    test("un usuario INACTIVO y un invitado VENCIDO SÍ inician sesión (autenticar no es autorizar); es P7/P9 quien los frena", async () => {
      const inactivo = await iniciarSesion(CORREOS.inactivo);
      const vencido = await iniciarSesion(CORREOS.vencido);
      expect((await api(inactivo).get("/auth/me")).body.usuario.estado).toBe("INACTIVO"); // /auth/me solo autentica
      expect((await api(inactivo).get("/documentos")).body).toMatchObject({ etapa: "ESTADO", politica: "P7" });
      expect((await api(vencido).get("/documentos")).body).toMatchObject({ etapa: "ESTADO", politica: "P9" });
    });

    test("las respuestas de /auth/* no se guardan en caché (llevan token y datos personales)", async () => {
      const r = await login({ correo: CORREOS.eduardo, password: "Secure123!" });
      expect(r.headers["cache-control"]).toBe("no-store");
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("GET /auth/me: verificación del token", () => {
    const firmar = (opciones: jwt.SignOptions = {}, clave: string = config.JWT_SECRET) =>
      jwt.sign({}, clave, { algorithm: "HS256", issuer: "securedocs", subject: String(eduardoId), expiresIn: "1h", ...opciones });
    const me = (autorizacion?: string) => {
      const p = request(app).get("/auth/me").set(ENTORNO_NORMAL);
      return autorizacion === undefined ? p : p.set("Authorization", autorizacion);
    };

    test("un token válido: 200", async () => {
      expect((await me(`Bearer ${firmar()}`)).status).toBe(200);
    });

    test.each([
      ["sin cabecera Authorization", undefined],
      ["esquema Basic en vez de Bearer", "Basic abc123"],
      ["'Bearer' sin token", "Bearer"],
    ])("%s -> 401 NO_AUTENTICADO", async (_caso, autorizacion) => {
      const r = await me(autorizacion);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("NO_AUTENTICADO");
    });

    test("un token EXPIRADO -> 401 TOKEN_EXPIRADO", async () => {
      const r = await me(`Bearer ${firmar({ expiresIn: -10 })}`);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("TOKEN_EXPIRADO");
    });

    test.each([
      ["basura que no es un JWT", () => "esto.no.es.un.jwt"],
      ["firmado con OTRA clave", () => firmar({}, "otra-clave-que-no-es-la-del-servidor-1234")],
      ["de OTRO emisor", () => firmar({ issuer: "otro-sistema" })],
      ["con algoritmo 'none' (sin firma)", () => `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ sub: String(eduardoId), iss: "securedocs", exp: 9999999999 })}.`],
      ["de un usuario que no existe", () => firmar({ subject: "99999999" })],
      ["con un 'sub' que no es un número", () => firmar({ subject: "abc" })],
      ["con la firma alterada", () => firmar().slice(0, -3) + "AAA"],
    ])("un token %s -> 401 TOKEN_INVALIDO", async (_caso, fabricar) => {
      const r = await me(`Bearer ${fabricar()}`);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("TOKEN_INVALIDO");
    });

    test("un token con el cuerpo modificado (otro 'sub' pero la firma vieja) -> 401", async () => {
      const [cabecera, , firma] = firmar().split(".");
      const forjado = `${cabecera}.${base64url({ sub: "1", iss: "securedocs", iat: 1, exp: 9999999999 })}.${firma}`;
      expect((await me(`Bearer ${forjado}`)).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("contexto de entorno (lo que ven las políticas P4, P5 y P6)", () => {
    let token: string;
    beforeAll(async () => {
      token = await iniciarSesion(CORREOS.eduardo);
    });
    const entorno = async (cabeceras: Record<string, string>) => (await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`).set(cabeceras)).body.entorno;

    test("sin headers NO se asume nada: ubicación null y dispositivo DESCONOCIDO (P5 y P6 denegarán); hora y fecha de la empresa", async () => {
      expect(await entorno({})).toMatchObject({ ubicacion: null, dispositivo: "DESCONOCIDO", hora: "10:00", fecha: "2026-09-23" });
    });

    test("la ubicación se normaliza ('Perú ' -> PERU) y el dispositivo también ('corporativo' -> CORPORATIVO)", async () => {
      expect(await entorno({ "X-Ubicacion": " Perú ", "X-Dispositivo": "corporativo" })).toMatchObject({ ubicacion: "PERU", dispositivo: "CORPORATIVO" });
    });

    test("un dispositivo desconocido queda como DESCONOCIDO", async () => {
      expect((await entorno({ "X-Dispositivo": "laptop-del-primo" })).dispositivo).toBe("DESCONOCIDO");
    });

    test("X-Hora simula la hora (fuera de producción); vacía se ignora; inválida -> 400", async () => {
      expect((await entorno({ "X-Hora": "20:00" })).hora).toBe("20:00");
      expect((await entorno({ "X-Hora": "" })).hora).toBe("10:00");
      for (const mala of ["25:99", "24:00", "9:00", "abc"]) {
        const r = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`).set({ "X-Hora": mala });
        expect(r.status).toBe(400);
      }
    });

    test("la IP sale de la conexión, no de un header que el cliente pueda inventar", async () => {
      const ip = (await entorno({ "X-Forwarded-For": "6.6.6.6" })).direccion_ip;
      expect(ip).toBeTruthy();
      expect(ip).not.toBe("6.6.6.6");
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("matriz RBAC de la guía (sección 5), verificada por HTTP con los permisos que lee cada rol de la BD", () => {
    const MATRIZ = {
      ADMIN: ["AUDIT_READ", "DOC_APPROVE", "DOC_CREATE", "DOC_DELETE", "DOC_DOWNLOAD", "DOC_READ", "DOC_UPDATE", "ROLE_ASSIGN", "USER_MANAGE"],
      GERENTE: ["AUDIT_READ", "DOC_APPROVE", "DOC_CREATE", "DOC_DELETE", "DOC_DOWNLOAD", "DOC_READ", "DOC_UPDATE"],
      SUPERVISOR: ["DOC_APPROVE", "DOC_CREATE", "DOC_DOWNLOAD", "DOC_READ", "DOC_UPDATE"],
      EMPLEADO: ["DOC_CREATE", "DOC_DOWNLOAD", "DOC_READ", "DOC_UPDATE"],
      AUDITOR: ["AUDIT_READ", "DOC_DOWNLOAD", "DOC_READ"],
      INVITADO: ["DOC_READ"],
    } as const;
    const PERSONA = { ADMIN: "admin", GERENTE: "gerente", SUPERVISOR: "sara", EMPLEADO: "eduardo", AUDITOR: "auditor", INVITADO: "invitado" } as const;
    let T: Awaited<ReturnType<typeof sesiones>>;
    beforeAll(async () => {
      T = await sesiones();
    });

    test.each(Object.entries(MATRIZ))("%s tiene exactamente sus permisos", async (rol, permisos) => {
      const r = await api(T[PERSONA[rol as keyof typeof PERSONA]]).get("/auth/me");
      expect(r.body.usuario.rol).toBe(rol);
      expect([...r.body.permisos].sort()).toEqual([...permisos].sort());
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("errores uniformes y cabeceras de seguridad", () => {
    test("una ruta que no existe -> 404 JSON con la forma { error, mensaje }", async () => {
      const r = await sinSesion().get("/esta-ruta-no-existe");
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "NO_ENCONTRADO", mensaje: "No existe GET /esta-ruta-no-existe" });
    });

    test("un método equivocado (GET /auth/login) -> 404 JSON", async () => {
      expect((await sinSesion().get("/auth/login")).status).toBe(404);
    });

    test("/health responde sin token y confirma la conexión con la BD", async () => {
      const r = await request(app).get("/health");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ estado: "ok", bd: "ok" });
    });

    test("helmet: nosniff, sin X-Powered-By y con política de contenido", async () => {
      const r = await request(app).get("/health");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["x-powered-by"]).toBeUndefined();
      expect(r.headers["content-security-policy"]).toBeDefined();
      expect(r.headers["strict-transport-security"]).toBeDefined();
    });
  });
});
