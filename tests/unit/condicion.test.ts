import {
  CondicionInvalida,
  evaluarCondicion as ev,
  resolver,
  validarCondicion,
} from "../../src/authorization/abac/condicion";

const attrs = {
  usuario: { id: 4, estado: "ACTIVO", rol: "EMPLEADO", nivel_seguridad: 3, departamento: "FINANZAS", fecha_expiracion: null },
  recurso: { nivel_confidencialidad: 4, departamento: "FINANZAS", propietario_id: 4, pais: "PERU" },
  entorno: { hora: "10:00", fecha: "2026-09-23", ubicacion: "PERU", dispositivo: null },
};

describe("operadores contra un valor", () => {
  test("eq / neq", () => {
    expect(ev({ "usuario.estado": { eq: "ACTIVO" } }, attrs)).toBe(true);
    expect(ev({ "usuario.estado": { eq: "INACTIVO" } }, attrs)).toBe(false);
    expect(ev({ "usuario.estado": { neq: "INACTIVO" } }, attrs)).toBe(true);
    expect(ev({ "usuario.estado": { neq: "ACTIVO" } }, attrs)).toBe(false);
  });

  test("eq es estricto: el número 3 no es el texto '3'", () => {
    expect(ev({ "usuario.nivel_seguridad": { eq: 3 } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { eq: "3" } }, attrs)).toBe(false);
  });

  test("gt / gte / lt / lte con números", () => {
    expect(ev({ "usuario.nivel_seguridad": { gt: 2 } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { gt: 3 } }, attrs)).toBe(false);
    expect(ev({ "usuario.nivel_seguridad": { gte: 3 } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { lt: 4 } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { lt: 3 } }, attrs)).toBe(false);
    expect(ev({ "usuario.nivel_seguridad": { lte: 3 } }, attrs)).toBe(true);
  });

  test("horas y fechas 'HH:mm' / 'YYYY-MM-DD' se comparan bien como texto", () => {
    expect(ev({ "entorno.hora": { gte: "08:00" } }, attrs)).toBe(true);
    expect(ev({ "entorno.hora": { lt: "09:59" } }, attrs)).toBe(false);
    expect(ev({ "entorno.fecha": { gt: "2026-09-22" } }, attrs)).toBe(true);
    expect(ev({ "entorno.fecha": { lte: "2026-09-23" } }, attrs)).toBe(true);
  });

  test("between incluye ambos extremos", () => {
    expect(ev({ "entorno.hora": { between: ["08:00", "18:00"] } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { between: [3, 5] } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { between: [1, 3] } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { between: [4, 5] } }, attrs)).toBe(false);
  });

  test("in / nin", () => {
    expect(ev({ "usuario.rol": { in: ["ADMIN", "EMPLEADO"] } }, attrs)).toBe(true);
    expect(ev({ "usuario.rol": { in: ["ADMIN", "GERENTE"] } }, attrs)).toBe(false);
    expect(ev({ "usuario.rol": { nin: ["ADMIN", "GERENTE"] } }, attrs)).toBe(true);
    expect(ev({ "usuario.rol": { nin: ["EMPLEADO"] } }, attrs)).toBe(false);
  });

  test("varios operadores sobre una ruta, y varias rutas: todos deben cumplirse (AND)", () => {
    expect(ev({ "recurso.nivel_confidencialidad": { gte: 3, lte: 4 } }, attrs)).toBe(true);
    expect(ev({ "recurso.nivel_confidencialidad": { gte: 5, lte: 6 } }, attrs)).toBe(false);
    expect(ev({ "usuario.estado": { eq: "ACTIVO" }, "usuario.rol": { eq: "EMPLEADO" } }, attrs)).toBe(true);
    expect(ev({ "usuario.estado": { eq: "ACTIVO" }, "usuario.rol": { eq: "ADMIN" } }, attrs)).toBe(false);
  });
});

describe("operadores contra otro atributo", () => {
  test("eqAttr / neqAttr", () => {
    expect(ev({ "usuario.departamento": { eqAttr: "recurso.departamento" } }, attrs)).toBe(true);
    expect(ev({ "usuario.id": { eqAttr: "recurso.propietario_id" } }, attrs)).toBe(true);
    expect(ev({ "usuario.id": { neqAttr: "recurso.propietario_id" } }, attrs)).toBe(false);
    expect(ev({ "entorno.ubicacion": { eqAttr: "recurso.pais" } }, attrs)).toBe(true);
  });

  test("gteAttr / gtAttr / lteAttr / ltAttr", () => {
    expect(ev({ "recurso.nivel_confidencialidad": { gteAttr: "usuario.nivel_seguridad" } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { gteAttr: "recurso.nivel_confidencialidad" } }, attrs)).toBe(false);
    expect(ev({ "usuario.nivel_seguridad": { ltAttr: "recurso.nivel_confidencialidad" } }, attrs)).toBe(true);
    expect(ev({ "usuario.nivel_seguridad": { lteAttr: "recurso.nivel_confidencialidad" } }, attrs)).toBe(true);
    expect(ev({ "recurso.nivel_confidencialidad": { gtAttr: "usuario.nivel_seguridad" } }, attrs)).toBe(true);
  });
});

describe("si falta información la condición NO se cumple (fail-closed)", () => {
  test("atributo inexistente: ninguna comparación da true, ni siquiera neq", () => {
    for (const op of [{ eq: "X" }, { neq: "X" }, { gt: 1 }, { lt: 1 }, { in: ["X"] }, { nin: ["X"] }, { between: [1, 9] }]) {
      expect(ev({ "usuario.inexistente": op }, attrs)).toBe(false);
    }
  });

  test("atributo null: no cumple comparaciones normales", () => {
    expect(ev({ "entorno.dispositivo": { eq: "CORPORATIVO" } }, attrs)).toBe(false);
    expect(ev({ "entorno.dispositivo": { neq: "PERSONAL" } }, attrs)).toBe(false);
    expect(ev({ "usuario.fecha_expiracion": { gteAttr: "entorno.fecha" } }, attrs)).toBe(false);
  });

  test("el literal null sí se puede comprobar explícitamente", () => {
    expect(ev({ "usuario.fecha_expiracion": { eq: null } }, attrs)).toBe(true);
    expect(ev({ "usuario.fecha_expiracion": { neq: null } }, attrs)).toBe(false);
    expect(ev({ "usuario.estado": { neq: null } }, attrs)).toBe(true);
  });

  test("sin recurso, las rutas recurso.* no resuelven a nada", () => {
    const sinRecurso = { usuario: attrs.usuario, entorno: attrs.entorno };
    expect(ev({ "recurso.nivel_confidencialidad": { gte: 1 } }, sinRecurso)).toBe(false);
    expect(ev({ "usuario.departamento": { eqAttr: "recurso.departamento" } }, sinRecurso)).toBe(false);
  });

  test("tipos distintos no se comparan por orden (número vs texto)", () => {
    expect(ev({ "usuario.nivel_seguridad": { gte: "3" } }, attrs)).toBe(false);
    expect(ev({ "entorno.hora": { gte: 8 } }, attrs)).toBe(false);
  });
});

describe("bloques all / any / si-entonces", () => {
  const cierto = { "usuario.estado": { eq: "ACTIVO" } };
  const falso = { "usuario.estado": { eq: "INACTIVO" } };

  test("all exige todas; any basta una", () => {
    expect(ev({ all: [cierto, cierto] }, attrs)).toBe(true);
    expect(ev({ all: [cierto, falso] }, attrs)).toBe(false);
    expect(ev({ any: [falso, cierto] }, attrs)).toBe(true);
    expect(ev({ any: [falso, falso] }, attrs)).toBe(false);
  });

  test("si/entonces es una implicación: si el 'si' no se da, se cumple sin mirar 'entonces'", () => {
    expect(ev({ si: falso, entonces: falso }, attrs)).toBe(true);
    expect(ev({ si: cierto, entonces: cierto }, attrs)).toBe(true);
    expect(ev({ si: cierto, entonces: falso }, attrs)).toBe(false);
  });

  test("se pueden anidar (como P4: si nivel>=4 entonces all[hora>=08:00, hora<18:00])", () => {
    const p4 = {
      si: { "recurso.nivel_confidencialidad": { gte: 4 } },
      entonces: { all: [{ "entorno.hora": { gte: "08:00" } }, { "entorno.hora": { lt: "18:00" } }] },
    };
    expect(ev(p4, attrs)).toBe(true);
    expect(ev(p4, { ...attrs, entorno: { ...attrs.entorno, hora: "20:00" } })).toBe(false);
  });

  test("un bloque junto a rutas en el mismo objeto también es AND", () => {
    expect(ev({ "usuario.estado": { eq: "ACTIVO" }, any: [falso, cierto] }, attrs)).toBe(true);
    expect(ev({ "usuario.estado": { eq: "INACTIVO" }, any: [cierto] }, attrs)).toBe(false);
  });
});

describe("condiciones mal escritas lanzan CondicionInvalida (nunca se dan por buenas)", () => {
  test.each([
    ["operador desconocido", { "usuario.estado": { igual: "ACTIVO" } }],
    ["ruta sin raíz", { estado: { eq: "ACTIVO" } }],
    ["raíz desconocida", { "sistema.hora": { eq: "10:00" } }],
    ["objeto vacío", {}],
    ["no es un objeto", []],
    ["entonces sin si", { entonces: { "usuario.estado": { eq: "ACTIVO" } } }],
    ["si sin entonces", { si: { "usuario.estado": { eq: "ACTIVO" } } }],
    ["all vacío", { all: [] }],
    ["all que no es lista", { all: { "usuario.estado": { eq: "ACTIVO" } } }],
    ["hoja sin operadores", { "usuario.estado": {} }],
    ["eqAttr que no es texto", { "usuario.id": { eqAttr: 5 } }],
    ["eqAttr con ruta inválida", { "usuario.id": { eqAttr: "propietario" } }],
  ])("%s", (_nombre, condicion) => {
    expect(() => ev(condicion, attrs)).toThrow(CondicionInvalida);
  });
});

describe("resolver: solo propiedades propias", () => {
  test("no se puede llegar al prototipo", () => {
    expect(resolver("usuario.constructor", attrs)).toBeUndefined();
    expect(resolver("usuario.__proto__", attrs)).toBeUndefined();
    expect(resolver("usuario.toString", attrs)).toBeUndefined();
  });

  test("lee valores normales y devuelve undefined si no existe", () => {
    expect(resolver("usuario.rol", attrs)).toBe("EMPLEADO");
    expect(resolver("usuario.nada", attrs)).toBeUndefined();
  });

  test("una ruta mal formada es un error, no un undefined silencioso", () => {
    expect(() => resolver("usuario", attrs)).toThrow(CondicionInvalida);
    expect(() => resolver("a.b.c", attrs)).toThrow(CondicionInvalida);
  });
});

describe("validarCondicion", () => {
  test("una condición bien escrita no tiene problemas", () => {
    expect(validarCondicion({ "usuario.estado": { eq: "ACTIVO" } })).toEqual([]);
    expect(
      validarCondicion({
        si: { "usuario.rol": { in: ["A", "B"] } },
        entonces: { all: [{ "entorno.hora": { between: ["08:00", "18:00"] } }, { "usuario.id": { neqAttr: "recurso.propietario_id" } }] },
      }),
    ).toEqual([]);
  });

  test("detecta errores en ramas que el cortocircuito NUNCA evaluaría", () => {
    const conTypo = { si: { "usuario.estado": { eq: "X" } }, entonces: { "usuario.estado": { igual: "Y" } } };
    // Evaluada, "pasa" porque el 'si' no se da y 'entonces' ni se mira...
    expect(ev(conTypo, attrs)).toBe(true);
    // ...pero la validación estructural sí ve el error escondido:
    expect(validarCondicion(conTypo).join(" ")).toMatch(/operador desconocido/);
  });

  test("reporta todos los problemas, con su ubicación", () => {
    const errores = validarCondicion({ all: [{ "usuario.x": { foo: 1 } }, { "usuario.y": { in: [] } }, { malaruta: { eq: 1 } }] });
    expect(errores.length).toBeGreaterThanOrEqual(3);
    expect(errores.join("\n")).toContain("condicion.all[0]");
  });

  test.each([
    ["between con 3 valores", { "entorno.hora": { between: ["08:00", "12:00", "18:00"] } }],
    ["between con tipos mezclados", { "entorno.hora": { between: ["08:00", 18] } }],
    ["in con un objeto", { "usuario.rol": { in: [{ a: 1 }] } }],
    ["gte con un booleano", { "usuario.nivel_seguridad": { gte: true } }],
    ["eq con un arreglo", { "usuario.rol": { eq: ["A"] } }],
  ])("%s es inválido", (_nombre, condicion) => {
    expect(validarCondicion(condicion).length).toBeGreaterThan(0);
  });
});
