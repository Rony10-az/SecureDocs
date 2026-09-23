/**
 * Gestión de usuarios (Bloque 5): USER_MANAGE, ROLE_ASSIGN (autorización condicional), P11 (nadie cambia su propio rol),
 * efecto inmediato de los cambios, política de contraseñas y siempre-un-gestor.
 *
 * Toca temporalmente al administrador sembrado en la prueba de la carrera del "último gestor" y lo RESTAURA siempre
 * en `afterAll`. Los usuarios que crea (correo único) quedan INACTIVOS; la auditoría es inmutable y no se pueden borrar.
 */
import bcrypt from "bcryptjs";
import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/db";
import {
  CORREOS,
  api,
  cerrar,
  documentoSembrado,
  fijarRelojDePruebas,
  iniciarSesion,
  limpiarDocumentos,
  restaurarReloj,
  sesiones,
  sinSesion,
  verificarEntorno,
} from "./soporte";

const PASS = "Clave-Segura-2026x";
const sinSecretos = (cuerpo: unknown) => !/password|\$2[aby]\$/i.test(JSON.stringify(cuerpo));
const estadoLogin = async (correo: string, password: string) => (await request(app).post("/auth/login").send({ correo, password })).status;

const gestoresActivos = () =>
  prisma.usuario.findMany({
    where: { estado: "ACTIVO", rol: { permisos: { some: { permiso: { codigo: "USER_MANAGE" } } } } },
    select: { id: true, correo: true },
  });

describe("Gestión de usuarios", () => {
  let T: Awaited<ReturnType<typeof sesiones>>;
  let ana: Awaited<ReturnType<typeof prisma.usuario.findUniqueOrThrow>>;
  let vencidoInicial: Awaited<ReturnType<typeof prisma.usuario.findUniqueOrThrow>>;
  const ts = Date.now();
  const creados: Array<{ id: number; correo: string }> = [];
  const contraseñasUsadas = [PASS];

  const correo = (n: string) => `zz.int.${ts}.${n}@techcorp.pe`;
  const alta = (n: string, extra: object = {}) => ({ nombre: `Prueba integración ${n}`, correo: correo(n), password: PASS, rol: "EMPLEADO", departamento: "FINANZAS", nivel_seguridad: 3, ...extra });
  const crear = async (n: string, extra: object = {}) => {
    const r = await api(T.admin).post("/usuarios").send(alta(n, extra));
    if (r.status === 201) creados.push({ id: r.body.id, correo: r.body.correo });
    return r;
  };
  const put = (id: number, body: object, token = T.admin) => api(token).put(`/usuarios/${id}`).send(body);

  beforeAll(async () => {
    await verificarEntorno();
    fijarRelojDePruebas();
    ana = await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS.admin } });
    vencidoInicial = await prisma.usuario.findUniqueOrThrow({ where: { correo: CORREOS.vencido } });
    T = await sesiones();
  }, 60_000);

  afterAll(async () => {
    // Todo lo que las pruebas pudieron tocar en los usuarios SEMBRADOS vuelve a como estaba
    await prisma.usuario.update({ where: { id: ana.id }, data: { estado: "ACTIVO", nombre: "Ana Admin", rol_id: ana.rol_id } });
    await prisma.usuario.update({ where: { id: vencidoInicial.id }, data: { estado: vencidoInicial.estado, fecha_expiracion: vencidoInicial.fecha_expiracion } });
    // Los usuarios creados quedan INACTIVOS y como EMPLEADO (así el rol de prueba se puede borrar)
    const rolEmpleado = await prisma.rol.findUniqueOrThrow({ where: { nombre: "EMPLEADO" } });
    await prisma.usuario.updateMany({ where: { correo: { startsWith: `zz.int.${ts}.` } }, data: { estado: "INACTIVO", rol_id: rolEmpleado.id } });
    await prisma.rol.deleteMany({ where: { nombre: "GESTOR_TEST" } });
    restaurarReloj();
    await limpiarDocumentos();
    await cerrar();
  });

  // -------------------------------------------------------------------------------------------------
  describe("solo quien tiene USER_MANAGE gestiona usuarios (RBAC y estado)", () => {
    test.each([
      ["Eduardo (EMPLEADO)", "eduardo"],
      ["Sara (SUPERVISOR)", "sara"],
      ["el Gerente", "gerente"],
      ["el Auditor", "auditor"],
      ["la empleada de RRHH", "rrhh"],
      ["el Invitado", "invitado"],
    ] as const)("%s: lista, detalle, alta y cambio -> 403 RBAC, y no se modifica nada", async (_nombre, persona) => {
      const antes = await prisma.usuario.count();
      const respuestas = await Promise.all([
        api(T[persona]).get("/usuarios"),
        api(T[persona]).get(`/usuarios/${ana.id}`),
        api(T[persona]).post("/usuarios").send(alta("no-debe-existir")),
        api(T[persona]).put(`/usuarios/${ana.id}`).send({ nombre: "Hackeada" }),
      ]);
      for (const r of respuestas) {
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ error: "ACCESO_DENEGADO", etapa: "RBAC", politica: null, motivo: "Denegado por RBAC" });
      }
      expect(await prisma.usuario.count()).toBe(antes);
      expect((await prisma.usuario.findUniqueOrThrow({ where: { id: ana.id } })).nombre).toBe("Ana Admin");
    });

    test("un usuario inactivo -> ESTADO P7; un invitado vencido -> ESTADO P9; sin token -> 401", async () => {
      expect((await api(T.inactivo).get("/usuarios")).body).toMatchObject({ etapa: "ESTADO", politica: "P7" });
      expect((await api(T.vencido).get("/usuarios")).body).toMatchObject({ etapa: "ESTADO", politica: "P9" });
      expect((await sinSesion().get("/usuarios")).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("alta de usuarios", () => {
    let U: { id: number; correo: string; [campo: string]: unknown };
    let respuesta: request.Response;

    beforeAll(async () => {
      respuesta = await crear("alta");
      U = respuesta.body;
    });

    test("201: devuelve el usuario con sus datos y SIN contraseña ni hash", () => {
      expect(respuesta.status).toBe(201);
      expect(U).toMatchObject({ rol: "EMPLEADO", departamento: "FINANZAS", nivel_seguridad: 3, pais: "PERU", tipo_contrato: "INTERNO", estado: "ACTIVO", fecha_expiracion: null });
      expect(U.creado_en).toEqual(expect.any(String));
      expect(sinSecretos(respuesta.body)).toBe(true);
      expect(respuesta.headers.location).toBe(`/usuarios/${U.id}`);
      expect(respuesta.headers["cache-control"]).toBe("no-store");
    });

    test("en la BD la contraseña es un hash bcrypt del costo del sistema (10), nunca el texto", async () => {
      const fila = await prisma.usuario.findUniqueOrThrow({ where: { id: U.id } });
      expect(fila.password_hash).not.toBe(PASS);
      expect(bcrypt.getRounds(fila.password_hash)).toBe(10);
      expect(await bcrypt.compare(PASS, fila.password_hash)).toBe(true);
    });

    test("el usuario nuevo inicia sesión y /auth/me muestra su rol y sus permisos, leídos de la BD", async () => {
      const token = await iniciarSesion(U.correo, PASS);
      const me = await api(token).get("/auth/me");
      expect(me.body.usuario.rol).toBe("EMPLEADO");
      expect(me.body.permisos).toEqual(expect.arrayContaining(["DOC_READ", "DOC_CREATE"]));
      expect(me.body.permisos).not.toContain("DOC_APPROVE");
    });

    test("un correo repetido -> 409, aunque venga en MAYÚSCULAS y con espacios (se normaliza)", async () => {
      expect((await api(T.admin).post("/usuarios").send(alta("alta"))).status).toBe(409);
      expect((await api(T.admin).post("/usuarios").send(alta("alta", { correo: `  ${correo("alta").toUpperCase()} ` }))).status).toBe(409);
    });

    test.each([
      ["contraseña débil", { password: "corta" }, "password"],
      ["contraseña sin números", { password: "SinNumerosAquiXY" }, "password"],
      ["contraseña de más de 72 bytes", { password: "Aa1" + "x".repeat(70) }, "password"],
      ["correo mal formado", { correo: "esto-no-es-correo" }, "correo"],
      ["nivel 9", { nivel_seguridad: 9 }, "nivel_seguridad"],
      ["nivel 0", { nivel_seguridad: 0 }, "nivel_seguridad"],
      ["tipo de contrato inválido", { tipo_contrato: "TEMPORAL" }, "tipo_contrato"],
      ["estado inválido", { estado: "BORRADO" }, "estado"],
      ["fecha con otro formato", { tipo_contrato: "EXTERNO", fecha_expiracion: "31/12/2030" }, "fecha_expiracion"],
    ])("validación: %s -> 400 señalando '%s'", async (_caso, extra, campo) => {
      const r = await api(T.admin).post("/usuarios").send(alta("val", extra));
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("VALIDACION");
      expect(r.body.detalles.map((d: { campo: string }) => d.campo)).toContain(campo);
    });

    test.each([
      ["un rol inexistente", { rol: "SUPERHEROE" }],
      ["un departamento inexistente", { departamento: "MARTE" }],
    ])("%s -> 400", async (_caso, extra) => {
      expect((await api(T.admin).post("/usuarios").send(alta("val", extra))).status).toBe(400);
    });

    test("una contraseña que contiene el correo del usuario -> 400", async () => {
      const local = correo("pwd").split("@")[0];
      expect((await api(T.admin).post("/usuarios").send(alta("pwd", { password: `Xx-${local}-9` }))).status).toBe(400);
    });

    test.each(["id", "password_hash", "creado_en", "permisos"])("mass assignment: el campo '%s' se rechaza (400), no se ignora", async (campo) => {
      expect((await api(T.admin).post("/usuarios").send({ ...alta("masa"), [campo]: 1 })).status).toBe(400);
    });

    test("un cuerpo vacío -> 400", async () => {
      expect((await api(T.admin).post("/usuarios").send({})).status).toBe(400);
    });

    test("un EXTERNO exige fecha futura; un INTERNO no lleva fecha", async () => {
      expect((await api(T.admin).post("/usuarios").send(alta("ext", { tipo_contrato: "EXTERNO" }))).status).toBe(400);
      expect((await api(T.admin).post("/usuarios").send(alta("ext", { tipo_contrato: "EXTERNO", fecha_expiracion: "2020-01-01" }))).status).toBe(400);
      expect((await api(T.admin).post("/usuarios").send(alta("int", { fecha_expiracion: "2030-01-01" }))).status).toBe(400);
      const ok = await crear("externo", { rol: "INVITADO", departamento: "GLOBAL", nivel_seguridad: 1, tipo_contrato: "EXTERNO", fecha_expiracion: "2030-12-31" });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ tipo_contrato: "EXTERNO", fecha_expiracion: "2030-12-31" }); // la fecha no se corre por la zona horaria
    });

    test("el país se normaliza (' chile ' -> CHILE) y se puede crear con otro rol", async () => {
      expect((await crear("pais", { pais: "  chile " })).body.pais).toBe("CHILE");
      expect((await crear("sup", { rol: "SUPERVISOR", nivel_seguridad: 4 })).body.rol).toBe("SUPERVISOR");
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("consultar", () => {
    let U: { id: number; correo: string };
    beforeAll(async () => {
      U = (await crear("consulta")).body;
      await crear("consulta-b", { rol: "AUDITOR", departamento: "GLOBAL", nivel_seguridad: 5 });
    });

    test("la lista con q= encuentra a los creados; nunca trae contraseñas ni hashes", async () => {
      const r = await api(T.admin).get(`/usuarios?q=zz.int.${ts}.consulta&limite=100`);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(2);
      expect(sinSecretos(r.body)).toBe(true);
    });

    test("filtros: rol, departamento, estado y tipo de contrato", async () => {
      const q = `q=zz.int.${ts}.consulta`;
      expect((await api(T.admin).get(`/usuarios?${q}&rol=auditor`)).body.total).toBe(1);
      expect((await api(T.admin).get(`/usuarios?${q}&departamento=global`)).body.total).toBe(1);
      expect((await api(T.admin).get(`/usuarios?${q}&estado=INACTIVO`)).body.total).toBe(0);
      expect((await api(T.admin).get(`/usuarios?${q}&tipo_contrato=EXTERNO`)).body.total).toBe(0);
      expect((await api(T.admin).get("/usuarios?estado=INACTIVO&q=inactivo@")).body.total).toBe(1); // el sembrado
    });

    test("se ordena por nombre y se pagina conservando el total", async () => {
      const todos = (await api(T.admin).get("/usuarios?limite=100")).body;
      // El orden que devuelve la API es el de la BD por nombre y, a igualdad, por id
      const esperado = await prisma.usuario.findMany({ orderBy: [{ nombre: "asc" }, { id: "asc" }], select: { id: true }, take: 100 });
      expect(todos.usuarios.map((u: { id: number }) => u.id)).toEqual(esperado.map((u) => u.id));

      const pagina = (await api(T.admin).get("/usuarios?limite=2&pagina=2")).body;
      expect(pagina.usuarios.map((u: { id: number }) => u.id)).toEqual(esperado.slice(2, 4).map((u) => u.id));
      expect(pagina).toMatchObject({ limite: 2, pagina: 2, total: todos.total });
    });

    test.each(["limite=1000", "pagina=0", "estado=BORRADO", "tipo_contrato=X"])("parámetro inválido ?%s -> 400", async (q) => {
      expect((await api(T.admin).get(`/usuarios?${q}`)).status).toBe(400);
    });

    test("detalle: 200 sin secretos; id inexistente 404; id mal formado 400", async () => {
      const r = await api(T.admin).get(`/usuarios/${U.id}`);
      expect(r.status).toBe(200);
      expect(r.body.correo).toBe(U.correo);
      expect(sinSecretos(r.body)).toBe(true);
      expect((await api(T.admin).get("/usuarios/99999999")).status).toBe(404);
      expect((await api(T.admin).get("/usuarios/abc")).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("cambios: surten efecto de inmediato (el token solo lleva el id, todo lo demás se lee de la BD)", () => {
    let U: { id: number; correo: string };
    let token: string;
    let presupuesto: number;

    beforeAll(async () => {
      U = (await crear("efectos")).body;
      token = await iniciarSesion(U.correo, PASS);
      presupuesto = (await documentoSembrado("Presupuesto 2026", { departamento: "FINANZAS", nivel: 2, estado: "PUBLICADO" })).id;
    });

    test("cambiar el nombre no toca lo demás; los mismos valores o un cuerpo vacío -> 400", async () => {
      const r = await put(U.id, { nombre: "Prueba renombrada" });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ nombre: "Prueba renombrada", rol: "EMPLEADO", nivel_seguridad: 3 });
      expect((await put(U.id, { nombre: "Prueba renombrada" })).status).toBe(400);
      expect((await put(U.id, {})).status).toBe(400);
    });

    test.each(["id", "password_hash", "creado_en"])("'%s' no se puede tocar (400)", async (campo) => {
      expect((await put(U.id, { [campo]: 1 })).status).toBe(400);
    });

    test("rol o departamento inexistentes -> 400; usuario inexistente -> 404; id mal formado -> 400", async () => {
      expect((await put(U.id, { rol: "SUPERHEROE" })).status).toBe(400);
      expect((await put(U.id, { departamento: "MARTE" })).status).toBe(400);
      expect((await put(99999999, { nombre: "Nadie" })).status).toBe(404);
      expect((await api(T.admin).put("/usuarios/abc").send({ nombre: "X" })).status).toBe(400);
    });

    test("cambiar el ROL: con el MISMO token de antes, /auth/me ya muestra el rol nuevo y sus permisos", async () => {
      expect((await put(U.id, { rol: "SUPERVISOR" })).body.rol).toBe("SUPERVISOR");
      const me = await api(token).get("/auth/me");
      expect(me.body.usuario.rol).toBe("SUPERVISOR");
      expect(me.body.permisos).toContain("DOC_APPROVE");
      await put(U.id, { rol: "EMPLEADO" });
      expect((await api(token).get("/auth/me")).body.permisos).not.toContain("DOC_APPROVE");
    });

    test("desactivar (o suspender): con el mismo token, ya recibe 403 P7; el login sigue funcionando; reactivar lo devuelve", async () => {
      for (const estado of ["INACTIVO", "SUSPENDIDO"]) {
        expect((await put(U.id, { estado })).body.estado).toBe(estado);
        expect((await api(token).get("/documentos")).body).toMatchObject({ etapa: "ESTADO", politica: "P7" });
        expect(await estadoLogin(U.correo, PASS)).toBe(200); // autenticar no es autorizar
      }
      await put(U.id, { estado: "ACTIVO" });
      expect((await api(token).get("/documentos")).status).toBe(200);
    });

    test("bajarle el nivel de seguridad: de inmediato ya no lee un documento de nivel 2 (P2)", async () => {
      expect((await api(token).get(`/documentos/${presupuesto}`)).status).toBe(200);
      await put(U.id, { nivel_seguridad: 1 });
      expect((await api(token).get(`/documentos/${presupuesto}`)).body).toMatchObject({ etapa: "ABAC", politica: "P2" });
      await put(U.id, { nivel_seguridad: 3 });
      expect((await api(token).get(`/documentos/${presupuesto}`)).status).toBe(200);
    });

    test("cambiarle el departamento: de inmediato ya no lee documentos de FINANZAS (P1)", async () => {
      expect((await put(U.id, { departamento: "rrhh" })).body.departamento).toBe("RRHH");
      expect((await api(token).get(`/documentos/${presupuesto}`)).body).toMatchObject({ etapa: "ABAC", politica: "P1" });
      await put(U.id, { departamento: "FINANZAS" });
      expect((await api(token).get(`/documentos/${presupuesto}`)).status).toBe(200);
    });

    test("restablecer la contraseña: la débil se rechaza; la vieja deja de servir y la nueva sirve; nunca se devuelve", async () => {
      const nueva = "Otra-Clave-2027y";
      contraseñasUsadas.push(nueva);
      expect((await put(U.id, { password: "corta" })).status).toBe(400);
      expect((await put(U.id, { password: `Zz-${correo("efectos").split("@")[0]}-1` })).status).toBe(400);
      const r = await put(U.id, { password: nueva });
      expect(r.status).toBe(200);
      expect(sinSecretos(r.body)).toBe(true);
      expect(await estadoLogin(U.correo, PASS)).toBe(401);
      expect(await estadoLogin(U.correo, nueva)).toBe(200);
      expect(bcrypt.getRounds((await prisma.usuario.findUniqueOrThrow({ where: { id: U.id } })).password_hash)).toBe(10);
    });

    test("cambiar el correo: entra con el nuevo y no con el viejo; uno que ya existe -> 409; el país se normaliza", async () => {
      const nuevo = correo("efectos-cambiado");
      const antesDelCambio = U.correo;
      expect((await put(U.id, { correo: nuevo })).status).toBe(200);
      U.correo = nuevo;
      expect(await estadoLogin(nuevo, "Otra-Clave-2027y")).toBe(200);
      expect(await estadoLogin(antesDelCambio, "Otra-Clave-2027y")).toBe(401);
      expect((await put(U.id, { correo: CORREOS.admin })).status).toBe(409);
      expect((await put(U.id, { pais: "Chile " })).body.pais).toBe("CHILE");
      expect((await put(U.id, { pais: "Perú" })).body.pais).toBe("PERU");
      expect((await put(U.id, { pais: " peru" })).status).toBe(400); // ya lo tenía: no es un cambio
    });

    test("contrato: INTERNO → EXTERNO exige fecha futura; EXTERNO → INTERNO borra la fecha sola", async () => {
      expect((await put(U.id, { tipo_contrato: "EXTERNO" })).status).toBe(400);
      expect((await put(U.id, { tipo_contrato: "EXTERNO", fecha_expiracion: "2020-01-01" })).status).toBe(400);
      expect((await put(U.id, { tipo_contrato: "EXTERNO", fecha_expiracion: "2031-05-05" })).body).toMatchObject({ tipo_contrato: "EXTERNO", fecha_expiracion: "2031-05-05" });
      expect((await put(U.id, { fecha_expiracion: null })).status).toBe(400); // un EXTERNO no puede quedarse sin fecha
      expect((await put(U.id, { tipo_contrato: "INTERNO" })).body).toMatchObject({ tipo_contrato: "INTERNO", fecha_expiracion: null });
      expect((await put(U.id, { fecha_expiracion: "2031-01-01" })).status).toBe(400); // INTERNO no lleva fecha
    });

    test("un invitado VENCIDO se puede suspender (la fecha vieja no bloquea otros cambios) y se le puede renovar el acceso", async () => {
      expect((await put(vencidoInicial.id, { estado: "SUSPENDIDO" })).status).toBe(200);
      await put(vencidoInicial.id, { estado: "ACTIVO" });
      expect((await put(vencidoInicial.id, { fecha_expiracion: "2031-06-30" })).body.fecha_expiracion).toBe("2031-06-30");
      expect((await api(T.vencido).get("/documentos")).status).toBe(200); // con su token de siempre, P9 ya no lo bloquea
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("roles: ROLE_ASSIGN, P11 (nadie cambia su propio rol) y la autorización condicional", () => {
    test("Ana no puede cambiarse su propio rol (ABAC P11) y sigue siendo ADMIN", async () => {
      const r = await put(ana.id, { rol: "EMPLEADO" });
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ etapa: "ABAC", politica: "P11", motivo: "No puede cambiar su propio rol" });
      expect((await prisma.usuario.findUniqueOrThrow({ where: { id: ana.id }, include: { rol: true } })).rol.nombre).toBe("ADMIN");
    });

    test("pedir el rol que YA tiene no cuenta como cambio de rol: no lo frena P11 (400 'nada que actualizar')", async () => {
      expect((await put(ana.id, { rol: "ADMIN" })).status).toBe(400);
    });

    test("un administrador sí puede editar sus propios datos (solo pide USER_MANAGE)", async () => {
      expect((await put(ana.id, { nombre: "Ana Admin (editada)" })).status).toBe(200);
      await put(ana.id, { nombre: "Ana Admin" });
    });

    test("crear un ADMIN (asignar el rol ADMIN); ese ADMIN tampoco puede cambiarse SU propio rol; Ana sí puede degradarlo", async () => {
      const b = await crear("admin-b", { rol: "ADMIN", departamento: "GLOBAL", nivel_seguridad: 5 });
      expect(b.status).toBe(201);
      const tokenB = await iniciarSesion(b.body.correo, PASS);
      expect((await put(b.body.id, { rol: "EMPLEADO" }, tokenB)).body).toMatchObject({ etapa: "ABAC", politica: "P11" });
      expect((await put(b.body.id, { rol: "EMPLEADO" })).body.rol).toBe("EMPLEADO");
      expect((await api(tokenB).get("/usuarios")).body).toMatchObject({ etapa: "RBAC" }); // ya no es administrador, con su token de antes
    });

    describe("un rol con USER_MANAGE pero SIN ROLE_ASSIGN prueba que la segunda autorización es real", () => {
      let G: { id: number; correo: string };
      let tokenG: string;
      let otro: { id: number };

      beforeAll(async () => {
        const permiso = await prisma.permiso.findUniqueOrThrow({ where: { codigo: "USER_MANAGE" } });
        const rol = await prisma.rol.upsert({ where: { nombre: "GESTOR_TEST" }, update: {}, create: { nombre: "GESTOR_TEST" } });
        await prisma.rolPermiso.createMany({ data: [{ rol_id: rol.id, permiso_id: permiso.id }], skipDuplicates: true });
        G = (await crear("gestor", { rol: "GESTOR_TEST" })).body;
        tokenG = await iniciarSesion(G.correo, PASS);
        otro = (await crear("gestionado")).body;
      });

      test("ese gestor lista usuarios y edita el nombre de otro (USER_MANAGE alcanza)", async () => {
        expect((await api(tokenG).get("/usuarios?limite=1")).status).toBe(200);
        expect((await put(otro.id, { nombre: "Editado por el gestor" }, tokenG)).status).toBe(200);
      });

      test("pero NO puede cambiar un rol: la segunda autorización (ROLE_ASSIGN) lo deniega por RBAC", async () => {
        const r = await put(otro.id, { rol: "AUDITOR" }, tokenG);
        expect(r.body).toMatchObject({ etapa: "RBAC", politica: null });
        expect((await prisma.usuario.findUniqueOrThrow({ where: { id: otro.id }, include: { rol: true } })).rol.nombre).toBe("EMPLEADO");
      });

      test("crear un usuario también asigna un rol: 403 RBAC en ROLE_ASSIGN y no se crea nada", async () => {
        const r = await api(tokenG).post("/usuarios").send(alta("por-gestor"));
        expect(r.body).toMatchObject({ etapa: "RBAC" });
        expect(await prisma.usuario.count({ where: { correo: correo("por-gestor") } })).toBe(0);
      });
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("siempre debe quedar al menos un usuario activo que pueda gestionar usuarios", () => {
    let soloAna: boolean;
    beforeAll(async () => {
      // El gestor de prueba de la sección anterior y los admins degradados ya no cuentan
      const rolEmpleado = await prisma.rol.findUniqueOrThrow({ where: { nombre: "EMPLEADO" } });
      await prisma.usuario.updateMany({ where: { correo: { startsWith: `zz.int.${ts}.` } }, data: { rol_id: rolEmpleado.id } });
      soloAna = (await gestoresActivos()).every((g) => g.id === ana.id);
      if (!soloAna) console.warn("Se omiten las pruebas del último gestor: hay otras personas activas con USER_MANAGE en esta BD.");
    });

    test("la ÚNICA gestora no puede desactivarse ni suspenderse (409) y sigue ACTIVA", async () => {
      if (!soloAna) return;
      for (const estado of ["INACTIVO", "SUSPENDIDO"]) {
        const r = await put(ana.id, { estado });
        expect(r.status).toBe(409);
        expect(r.body.error).toBe("CONFLICTO");
      }
      expect((await prisma.usuario.findUniqueOrThrow({ where: { id: ana.id } })).estado).toBe("ACTIVO");
    });

    test("con dos gestores, una puede desactivar a la otra (queda ella); y dos que se desactivan A LA VEZ: uno gana y nunca se queda sin gestor", async () => {
      if (!soloAna) return;
      const c = await crear("admin-c", { rol: "ADMIN", departamento: "GLOBAL", nivel_seguridad: 5 });
      expect(c.status).toBe(201);
      const C = c.body as { id: number; correo: string };
      const tokenC = await iniciarSesion(C.correo, PASS);
      expect((await gestoresActivos()).length).toBe(2);

      expect((await put(C.id, { estado: "INACTIVO" })).status).toBe(200);
      await prisma.usuario.update({ where: { id: C.id }, data: { estado: "ACTIVO" } });

      const resultados: string[] = [];
      for (let ronda = 1; ronda <= 6; ronda++) {
        await prisma.usuario.updateMany({ where: { id: { in: [ana.id, C.id] } }, data: { estado: "ACTIVO" } });
        const [a, b] = await Promise.all([put(C.id, { estado: "INACTIVO" }, T.admin), put(ana.id, { estado: "INACTIVO" }, tokenC)]);
        resultados.push(`${a.status}/${b.status}`);
        expect((await gestoresActivos()).length).toBeGreaterThanOrEqual(1); // NUNCA se queda sin gestor
        expect(a.status === 200 && b.status === 200).toBe(false); // y nunca triunfan los dos
      }
      expect(resultados).toHaveLength(6);
      await prisma.usuario.updateMany({ where: { id: { in: [ana.id, C.id] } }, data: { estado: "ACTIVO" } });
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("la auditoría deja constancia, con detalle y sin secretos", () => {
    const aud = async (q: string) => (await api(T.auditor).get(`/auditoria?${q}&limite=200`)).body.registros as Array<Record<string, string | null>>;

    test("USER_CREATE: el alta con el detalle de lo que se creó (correo, rol, departamento, nivel, contrato)", async () => {
      const altas = (await aud("accion=USER_CREATE")).filter((x) => String(x.motivo).includes(correo("alta")));
      expect(altas).toHaveLength(1);
      expect(altas[0]).toMatchObject({ usuario_correo: CORREOS.admin, resultado: "PERMITIDO", etapa: "COMPLETA" });
      expect(altas[0].motivo).toMatch(/^Creó al usuario .* \(rol EMPLEADO, departamento FINANZAS, nivel 3, INTERNO, ACTIVO\)$/);
      expect(altas[0].recurso).toMatch(/^usuario:\d+$/);
    });

    test("USER_UPDATE: cada cambio con qué campo y de qué valor a cuál; de la contraseña solo consta 'restablecida'", async () => {
      const motivos = (await aud("accion=USER_UPDATE")).map((x) => String(x.motivo)).join(" | ");
      expect(motivos).toContain("rol: EMPLEADO → SUPERVISOR");
      expect(motivos).toContain("estado: ACTIVO → INACTIVO");
      expect(motivos).toContain("nivel: 3 → 1");
      expect(motivos).toContain("contraseña restablecida");
    });

    test("ROLE_ASSIGN: quedaron las decisiones permitidas y las denegadas (P11 y RBAC), con el usuario afectado en 'recurso'", async () => {
      const filas = await aud("accion=ROLE_ASSIGN");
      expect(filas.some((x) => x.resultado === "PERMITIDO")).toBe(true);
      expect(filas.some((x) => x.politica_codigo === "P11" && x.usuario_correo === CORREOS.admin && x.recurso === `usuario:${ana.id}` && x.motivo === "No puede cambiar su propio rol")).toBe(true);
      expect(filas.some((x) => x.etapa === "RBAC" && x.resultado === "DENEGADO" && String(x.usuario_correo).includes(".gestor@"))).toBe(true);
    });

    test("NINGUNA contraseña (vieja, nueva o probada) aparece en la auditoría, ni nada que parezca un hash", async () => {
      const todo = JSON.stringify([...(await aud("accion=USER_CREATE")), ...(await aud("accion=USER_UPDATE")), ...(await aud("accion=ROLE_ASSIGN")), ...(await aud("accion=USER_MANAGE"))]);
      for (const p of contraseñasUsadas) expect(todo).not.toContain(p);
      expect(todo).not.toMatch(/\$2[aby]\$/);
    });

    test("el Gerente de FINANZAS NO ve la gestión de usuarios: la hace un usuario GLOBAL, fuera de su alcance", async () => {
      expect((await api(T.gerente).get("/auditoria?accion=USER_CREATE&limite=50")).body.total).toBe(0);
    });
  });
});
