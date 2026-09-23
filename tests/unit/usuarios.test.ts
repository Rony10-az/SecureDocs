/** Gestión de usuarios: contraseñas, esquemas de entrada y reglas de negocio (sin BD). */
import bcrypt from "bcryptjs";
import { COSTO_BCRYPT, hashPassword, passwordNuevaSchema } from "../../src/auth/password";
import { AppError } from "../../src/errors";
import {
  PERMISO_GESTION,
  dejaSinGestores,
  resolverContrato,
  resumenAlta,
  resumenCambios,
  validarPasswordContraCorreo,
} from "../../src/modules/usuarios/usuarios.reglas";
import {
  actualizarUsuarioSchema,
  crearUsuarioSchema,
  listaUsuariosSchema,
} from "../../src/modules/usuarios/usuarios.schemas";
import { usuario } from "./helpers";

function status(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.status : -1;
  }
}

describe("política de contraseñas (passwordNuevaSchema)", () => {
  const ok = (p: unknown) => passwordNuevaSchema.safeParse(p).success;

  test.each(["Secure123!", "abcDEF1234", "ÁrbolÑandú2026", "Una-Frase-Larga-Y-Segura-2026"])("acepta %j", (p) => {
    expect(ok(p)).toBe(true);
  });

  test.each([
    ["muy corta", "Ab1"],
    ["9 caracteres", "Abcdef123"],
    ["sin mayúsculas", "sinmayusculas123"],
    ["sin minúsculas", "SINMINUSCULAS123"],
    ["sin números", "SinNumerosAqui"],
    ["solo números", "1234567890123"],
    ["espacios", "          "],
  ])("rechaza: %s", (_caso, p) => {
    expect(ok(p)).toBe(false);
  });

  test("bcrypt ignora en silencio todo lo que pase de 72 BYTES: se rechaza en vez de truncar", () => {
    expect(ok("Aa1" + "x".repeat(69))).toBe(true); // 72 bytes exactos
    expect(ok("Aa1" + "x".repeat(70))).toBe(false); // 73 bytes
  });

  test("el límite es en BYTES, no en caracteres: una ñ ocupa 2", () => {
    expect(ok("Aa1" + "ñ".repeat(34))).toBe(true); // 3 + 68 = 71 bytes
    expect(ok("Aa1" + "ñ".repeat(35))).toBe(false); // 3 + 70 = 73 bytes (solo 38 caracteres)
  });

  test("no es texto", () => {
    expect(ok(undefined)).toBe(false);
    expect(ok(12345678901)).toBe(false);
  });
});

describe("hashPassword", () => {
  test("usa el costo único del sistema y verifica bien", async () => {
    const hash = await hashPassword("Secure123!");
    expect(bcrypt.getRounds(hash)).toBe(COSTO_BCRYPT);
    expect(await bcrypt.compare("Secure123!", hash)).toBe(true);
    expect(await bcrypt.compare("secure123!", hash)).toBe(false);
  });

  test("dos hashes de la misma contraseña son distintos (sal aleatoria)", async () => {
    expect(await hashPassword("Secure123!")).not.toBe(await hashPassword("Secure123!"));
  });
});

describe("crearUsuarioSchema (POST /usuarios)", () => {
  const valido = {
    nombre: "María López",
    correo: "maria.lopez@techcorp.pe",
    password: "Secure123!x",
    rol: "EMPLEADO",
    departamento: "FINANZAS",
    nivel_seguridad: 3,
  };
  const campos = (datos: unknown) => {
    const r = crearUsuarioSchema.safeParse(datos);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  test("lo mínimo, con los valores por defecto (INTERNO y ACTIVO)", () => {
    const r = crearUsuarioSchema.safeParse(valido);
    expect(r.success && r.data).toMatchObject({ tipo_contrato: "INTERNO", estado: "ACTIVO", nivel_seguridad: 3 });
  });

  test("normaliza: correo en minúsculas y sin espacios, rol y departamento en mayúsculas", () => {
    const r = crearUsuarioSchema.safeParse({ ...valido, correo: "  MARIA.Lopez@TechCorp.PE ", rol: " supervisor", departamento: "rrhh" });
    expect(r.success && r.data).toMatchObject({ correo: "maria.lopez@techcorp.pe", rol: "SUPERVISOR", departamento: "RRHH" });
  });

  test("el nivel llega como texto en algunos clientes: '4' se convierte en 4", () => {
    const r = crearUsuarioSchema.safeParse({ ...valido, nivel_seguridad: "4" });
    expect(r.success && r.data.nivel_seguridad).toBe(4);
  });

  test.each([
    ["sin nombre", { ...valido, nombre: undefined }, "nombre"],
    ["nombre de una letra", { ...valido, nombre: "M" }, "nombre"],
    ["sin correo", { ...valido, correo: undefined }, "correo"],
    ["correo mal formado", { ...valido, correo: "esto-no-es-correo" }, "correo"],
    ["sin contraseña", { ...valido, password: undefined }, "password"],
    ["contraseña débil", { ...valido, password: "corta" }, "password"],
    ["sin rol", { ...valido, rol: undefined }, "rol"],
    ["sin departamento", { ...valido, departamento: undefined }, "departamento"],
    ["sin nivel", { ...valido, nivel_seguridad: undefined }, "nivel_seguridad"],
    ["nivel 0", { ...valido, nivel_seguridad: 0 }, "nivel_seguridad"],
    ["nivel 6", { ...valido, nivel_seguridad: 6 }, "nivel_seguridad"],
    ["nivel decimal", { ...valido, nivel_seguridad: 2.5 }, "nivel_seguridad"],
    ["tipo de contrato inválido", { ...valido, tipo_contrato: "TEMPORAL" }, "tipo_contrato"],
    ["estado inválido", { ...valido, estado: "BORRADO" }, "estado"],
    ["fecha en otro formato", { ...valido, fecha_expiracion: "31/12/2027" }, "fecha_expiracion"],
    ["fecha imposible", { ...valido, fecha_expiracion: "2027-02-30" }, "fecha_expiracion"],
  ])("rechaza: %s", (_caso, datos, campo) => {
    expect(campos(datos)).toContain(campo);
  });

  test("fecha_expiracion admite AAAA-MM-DD y null", () => {
    expect(crearUsuarioSchema.safeParse({ ...valido, tipo_contrato: "EXTERNO", fecha_expiracion: "2027-12-31" }).success).toBe(true);
    expect(crearUsuarioSchema.safeParse({ ...valido, fecha_expiracion: null }).success).toBe(true);
  });

  test.each(["id", "password_hash", "creado_en", "permisos", "es_admin"])(
    "mass assignment: el campo '%s' NO se ignora en silencio, se rechaza",
    (campo) => {
      expect(crearUsuarioSchema.safeParse({ ...valido, [campo]: "x" }).success).toBe(false);
    },
  );
});

describe("actualizarUsuarioSchema (PUT /usuarios/:id)", () => {
  test("todo es opcional", () => {
    expect(actualizarUsuarioSchema.safeParse({}).success).toBe(true);
    expect(actualizarUsuarioSchema.safeParse({ estado: "INACTIVO" }).success).toBe(true);
  });

  test("fecha_expiracion: null sirve para borrarla", () => {
    const r = actualizarUsuarioSchema.safeParse({ fecha_expiracion: null });
    expect(r.success && r.data.fecha_expiracion).toBeNull();
  });

  test("la contraseña nueva también debe cumplir la política", () => {
    expect(actualizarUsuarioSchema.safeParse({ password: "corta" }).success).toBe(false);
    expect(actualizarUsuarioSchema.safeParse({ password: "Nueva-Clave-2026" }).success).toBe(true);
  });

  test.each(["id", "password_hash", "creado_en"])("'%s' no se puede tocar", (campo) => {
    expect(actualizarUsuarioSchema.safeParse({ [campo]: 1 }).success).toBe(false);
  });

  test.each([{ estado: "X" }, { nivel_seguridad: 9 }, { tipo_contrato: "Y" }, { correo: "no" }])("rechaza %j", (datos) => {
    expect(actualizarUsuarioSchema.safeParse(datos).success).toBe(false);
  });
});

describe("listaUsuariosSchema (GET /usuarios)", () => {
  test("valores por defecto", () => {
    expect(listaUsuariosSchema.parse({})).toEqual({ pagina: 1, limite: 20 });
  });
  test("filtros normalizados", () => {
    expect(listaUsuariosSchema.parse({ rol: "auditor", departamento: "global", estado: "INACTIVO", limite: "5", q: " ana " })).toEqual({
      rol: "AUDITOR",
      departamento: "GLOBAL",
      estado: "INACTIVO",
      limite: 5,
      pagina: 1,
      q: "ana",
    });
  });
  test.each([{ limite: "101" }, { limite: "0" }, { pagina: "0" }, { estado: "BORRADO" }])("rechaza %j", (q) => {
    expect(listaUsuariosSchema.safeParse(q).success).toBe(false);
  });
});

describe("resolverContrato (tipo de contrato y fecha de expiración)", () => {
  const HOY = "2026-09-23";

  test("INTERNO nuevo sin fecha", () => {
    expect(resolverContrato(null, { tipo_contrato: "INTERNO" }, HOY)).toEqual({ tipo: "INTERNO", expira: null });
  });
  test("sin datos = INTERNO", () => {
    expect(resolverContrato(null, {}, HOY)).toEqual({ tipo: "INTERNO", expira: null });
  });
  test("INTERNO con fecha -> 400", () => {
    expect(status(() => resolverContrato(null, { tipo_contrato: "INTERNO", fecha_expiracion: "2027-01-01" }, HOY))).toBe(400);
  });
  test("EXTERNO con fecha futura", () => {
    expect(resolverContrato(null, { tipo_contrato: "EXTERNO", fecha_expiracion: "2027-12-31" }, HOY)).toEqual({ tipo: "EXTERNO", expira: "2027-12-31" });
  });
  test("EXTERNO que vence hoy es válido (hoy <= fecha)", () => {
    expect(resolverContrato(null, { tipo_contrato: "EXTERNO", fecha_expiracion: HOY }, HOY).expira).toBe(HOY);
  });
  test("EXTERNO con fecha pasada -> 400", () => {
    expect(status(() => resolverContrato(null, { tipo_contrato: "EXTERNO", fecha_expiracion: "2026-09-22" }, HOY))).toBe(400);
  });
  test("EXTERNO sin fecha -> 400", () => {
    expect(status(() => resolverContrato(null, { tipo_contrato: "EXTERNO" }, HOY))).toBe(400);
    expect(status(() => resolverContrato(null, { tipo_contrato: "EXTERNO", fecha_expiracion: null }, HOY))).toBe(400);
  });

  describe("al actualizar", () => {
    const interno = { tipo: "INTERNO" as const, expira: null };
    const externoVencido = { tipo: "EXTERNO" as const, expira: "2025-01-01" };
    const externoVigente = { tipo: "EXTERNO" as const, expira: "2027-12-31" };

    test("pasar de INTERNO a EXTERNO exige indicar la fecha", () => {
      expect(status(() => resolverContrato(interno, { tipo_contrato: "EXTERNO" }, HOY))).toBe(400);
      expect(resolverContrato(interno, { tipo_contrato: "EXTERNO", fecha_expiracion: "2027-01-01" }, HOY)).toEqual({ tipo: "EXTERNO", expira: "2027-01-01" });
    });
    test("pasar de EXTERNO a INTERNO borra la fecha solo", () => {
      expect(resolverContrato(externoVigente, { tipo_contrato: "INTERNO" }, HOY)).toEqual({ tipo: "INTERNO", expira: null });
    });
    test("cambios que no tocan el contrato conservan lo que había", () => {
      expect(resolverContrato(externoVigente, {}, HOY)).toEqual(externoVigente);
    });
    test("una fecha VIEJA que ya tenía no impide otros cambios (p. ej. desactivar a un invitado vencido)", () => {
      expect(resolverContrato(externoVencido, {}, HOY)).toEqual(externoVencido);
    });
    test("pero ESTABLECER una fecha nueva en el pasado sí falla", () => {
      expect(status(() => resolverContrato(externoVigente, { fecha_expiracion: "2020-01-01" }, HOY))).toBe(400);
    });
    test("renovar el acceso de un invitado vencido con una fecha futura", () => {
      expect(resolverContrato(externoVencido, { fecha_expiracion: "2027-06-30" }, HOY).expira).toBe("2027-06-30");
    });
    test("un EXTERNO no puede quedarse sin fecha", () => {
      expect(status(() => resolverContrato(externoVigente, { fecha_expiracion: null }, HOY))).toBe(400);
    });
    test("un INTERNO con fecha null explícita no es un error", () => {
      expect(resolverContrato(interno, { fecha_expiracion: null }, HOY)).toEqual(interno);
    });
  });
});

describe("validarPasswordContraCorreo", () => {
  test("la contraseña no puede contener la parte local del correo (sin distinguir mayúsculas)", () => {
    expect(status(() => validarPasswordContraCorreo("MariaLopez2026!", "maria.lopez@techcorp.pe"))).toBeNull(); // "maria.lopez" != "marialopez"
    expect(status(() => validarPasswordContraCorreo("Xmaria.LOPEZx1234", "maria.lopez@techcorp.pe"))).toBe(400);
    expect(status(() => validarPasswordContraCorreo("Clave-empleado.fin-1", "empleado.fin@techcorp.pe"))).toBe(400);
  });
  test("una parte local muy corta (menos de 4 letras) no se restringe", () => {
    expect(status(() => validarPasswordContraCorreo("Ana123456789", "ana@techcorp.pe"))).toBeNull();
  });
  test("una contraseña sin relación con el correo pasa", () => {
    expect(status(() => validarPasswordContraCorreo("Secure123!x", "gerente.fin@techcorp.pe"))).toBeNull();
  });
});

describe("dejaSinGestores (siempre debe quedar alguien que pueda gestionar usuarios)", () => {
  test("solo bloquea si era gestor, deja de serlo y no queda ningún otro", () => {
    expect(dejaSinGestores(true, false, 0)).toBe(true);
  });
  test.each([
    ["queda otro gestor activo", true, false, 1],
    ["queda más de uno", true, false, 5],
    ["sigue siendo gestor", true, true, 0],
    ["no era gestor (p. ej. un empleado)", false, false, 0],
    ["no era gestor y pasa a serlo", false, true, 0],
  ])("permite: %s", (_caso, era, sera, otros) => {
    expect(dejaSinGestores(era, sera, otros)).toBe(false);
  });
  test("el gestor se define por el permiso, no por el nombre de un rol", () => {
    expect(PERMISO_GESTION).toBe("USER_MANAGE");
  });
});

describe("detalle para la auditoría", () => {
  const antes = usuario("empleado.fin@techcorp.pe");

  test("alta: dice quién se creó y con qué atributos (sin contraseña)", () => {
    const texto = resumenAlta({ ...antes, correo: "nueva@techcorp.pe", rol: "AUDITOR", tipo_contrato: "EXTERNO", fecha_expiracion: "2027-12-31" });
    expect(texto).toBe("Creó al usuario nueva@techcorp.pe (rol AUDITOR, departamento FINANZAS, nivel 3, EXTERNO, vence 2027-12-31, ACTIVO)");
  });

  test("cambio: lista solo lo que cambió, de qué a qué", () => {
    const despues = { ...antes, rol: "SUPERVISOR", estado: "INACTIVO" as const };
    expect(resumenCambios(antes, despues, false)).toBe(`Modificó a ${antes.correo}: rol: EMPLEADO → SUPERVISOR; estado: ACTIVO → INACTIVO`);
  });

  test("de la contraseña solo se deja constancia de que se restableció", () => {
    const texto = resumenCambios(antes, antes, true);
    expect(texto).toBe(`Modificó a ${antes.correo}: contraseña restablecida`);
    expect(texto).not.toMatch(/\$2[aby]\$/); // nada que parezca un hash bcrypt
  });

  test("una fecha que aparece o desaparece se muestra legible", () => {
    const despues = { ...antes, tipo_contrato: "EXTERNO" as const, fecha_expiracion: "2027-01-01" };
    expect(resumenCambios(antes, despues, false)).toContain("expira: (ninguna) → 2027-01-01");
  });
});
