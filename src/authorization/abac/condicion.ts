/**
 * Intérprete de condiciones JSON (el "lenguaje" de las políticas ABAC).
 *
 *   Hoja        { "usuario.estado": { "eq": "ACTIVO" } }        (varias rutas / operadores = AND)
 *   Bloques     { "all": [c1, c2] }   { "any": [c1, c2] }   { "si": c1, "entonces": c2 }
 *   Operadores  eq neq gt gte lt lte in nin between            (contra un valor)
 *               eqAttr neqAttr gtAttr gteAttr ltAttr lteAttr   (contra otro atributo)
 *   Rutas       usuario.<campo> | recurso.<campo> | entorno.<campo>
 *
 * Regla de seguridad: si un atributo no existe (null/undefined) la comparación da FALSE.
 * Ante la duda, la condición NO se cumple (y por tanto se deniega).
 */

/** Atributos disponibles: { usuario, recurso, entorno } */
export type AtributosCondicion = Record<string, unknown>;

export class CondicionInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CondicionInvalida";
  }
}

const RUTA = /^(usuario|recurso|entorno)\.[A-Za-z_][A-Za-z0-9_]*$/;
const OPERADORES = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "between"]);
const OPERADORES_ATTR = new Set(["eqAttr", "neqAttr", "gtAttr", "gteAttr", "ltAttr", "lteAttr"]);

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const esEscalar = (v: unknown) =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const esOrdenable = (v: unknown) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
// Solo se comparan por orden dos valores del MISMO tipo (número con número, texto con texto)
const mismoTipoOrdenable = (a: unknown, b: unknown) => esOrdenable(a) && esOrdenable(b) && typeof a === typeof b;

/** Lee un atributo. Solo propiedades propias: `usuario.constructor` o `__proto__` no resuelven a nada. */
export function resolver(ruta: string, atributos: AtributosCondicion): unknown {
  if (!RUTA.test(ruta)) throw new CondicionInvalida(`Ruta de atributo inválida: "${ruta}"`);
  const [raiz, campo] = ruta.split(".");
  const objeto = atributos[raiz];
  if (!esObjeto(objeto) || !Object.hasOwn(objeto, campo)) return undefined;
  return objeto[campo];
}

/** -1 / 0 / 1, o null si no son comparables. */
function orden(a: unknown, b: unknown): number | null {
  if (!mismoTipoOrdenable(a, b)) return null;
  const x = a as string | number;
  const y = b as string | number;
  return x < y ? -1 : x > y ? 1 : 0;
}

function comparar(op: string, actual: unknown, esperado: unknown): boolean {
  switch (op) {
    case "eq":
      return esperado === null ? actual == null : actual != null && actual === esperado;
    case "neq":
      // Con atributo ausente NO se cumple: "desconocido" no equivale a "distinto"
      return esperado === null ? actual != null : actual != null && actual !== esperado;
    case "in":
      return Array.isArray(esperado) && actual != null && esperado.includes(actual);
    case "nin":
      return Array.isArray(esperado) && actual != null && !esperado.includes(actual);
    case "between": {
      if (!Array.isArray(esperado) || esperado.length !== 2) return false;
      const desdeMin = orden(actual, esperado[0]);
      const hastaMax = orden(actual, esperado[1]);
      return desdeMin !== null && hastaMax !== null && desdeMin >= 0 && hastaMax <= 0; // ambos extremos incluidos
    }
    case "gt":
      return (orden(actual, esperado) ?? -1) > 0;
    case "gte":
      return (orden(actual, esperado) ?? -1) >= 0;
    case "lt":
      return (orden(actual, esperado) ?? 1) < 0;
    case "lte":
      return (orden(actual, esperado) ?? 1) <= 0;
    default:
      throw new CondicionInvalida(`Operador desconocido: "${op}"`);
  }
}

function aplicarOperador(op: string, actual: unknown, esperado: unknown, atributos: AtributosCondicion): boolean {
  if (OPERADORES_ATTR.has(op)) {
    if (typeof esperado !== "string") throw new CondicionInvalida(`"${op}" espera una ruta de atributo`);
    const otro = resolver(esperado, atributos);
    if (actual == null || otro == null) return false; // falta un lado: no se cumple
    return comparar(op.slice(0, -"Attr".length), actual, otro);
  }
  if (!OPERADORES.has(op)) throw new CondicionInvalida(`Operador desconocido: "${op}"`);
  return comparar(op, actual, esperado);
}

function evaluarHoja(ruta: string, operadores: unknown, atributos: AtributosCondicion): boolean {
  if (!esObjeto(operadores) || Object.keys(operadores).length === 0) {
    throw new CondicionInvalida(`"${ruta}" debe llevar al menos un operador`);
  }
  const actual = resolver(ruta, atributos);
  return Object.entries(operadores).every(([op, esperado]) => aplicarOperador(op, actual, esperado, atributos));
}

function lista(valor: unknown, bloque: string): unknown[] {
  if (!Array.isArray(valor) || valor.length === 0) throw new CondicionInvalida(`"${bloque}" debe ser una lista no vacía`);
  return valor;
}

/**
 * Evalúa la condición. Lanza `CondicionInvalida` si está mal escrita.
 * (Llamar antes a `validarCondicion`: con cortocircuito, una rama con error puede no llegar a evaluarse.)
 */
export function evaluarCondicion(condicion: unknown, atributos: AtributosCondicion): boolean {
  if (!esObjeto(condicion)) throw new CondicionInvalida("La condición debe ser un objeto");
  const claves = Object.keys(condicion);
  if (claves.length === 0) throw new CondicionInvalida("La condición no puede estar vacía"); // vacía NO es "verdadera"
  if ("si" in condicion !== "entonces" in condicion) throw new CondicionInvalida('"si" y "entonces" van juntos');

  for (const clave of claves) {
    const valor = condicion[clave];
    let cumple: boolean;
    switch (clave) {
      case "all":
        cumple = lista(valor, "all").every((c) => evaluarCondicion(c, atributos));
        break;
      case "any":
        cumple = lista(valor, "any").some((c) => evaluarCondicion(c, atributos));
        break;
      case "si":
        // Implicación: si "si" no se da, la condición se cumple sin mirar "entonces"
        cumple = !evaluarCondicion(valor, atributos) || evaluarCondicion(condicion.entonces, atributos);
        break;
      case "entonces":
        continue; // ya se evaluó junto con "si"
      default:
        cumple = evaluarHoja(clave, valor, atributos);
    }
    if (!cumple) return false;
  }
  return true;
}

function validarHoja(ruta: string, operadores: unknown, en: string): string[] {
  const errores: string[] = [];
  if (!RUTA.test(ruta)) {
    errores.push(`${en}: "${ruta}" no es una ruta (usuario.x | recurso.x | entorno.x) ni un bloque (all/any/si/entonces)`);
  }
  if (!esObjeto(operadores) || Object.keys(operadores).length === 0) {
    errores.push(`${en}: debe llevar al menos un operador`);
    return errores;
  }
  for (const [op, valor] of Object.entries(operadores)) {
    const donde = `${en}.${op}`;
    if (OPERADORES_ATTR.has(op)) {
      if (typeof valor !== "string" || !RUTA.test(valor)) errores.push(`${donde}: debe ser una ruta de atributo`);
    } else if (!OPERADORES.has(op)) {
      errores.push(`${donde}: operador desconocido`);
    } else if (op === "in" || op === "nin") {
      if (!Array.isArray(valor) || valor.length === 0 || !valor.every(esEscalar)) {
        errores.push(`${donde}: debe ser una lista de valores simples`);
      }
    } else if (op === "between") {
      if (!Array.isArray(valor) || valor.length !== 2 || !mismoTipoOrdenable(valor[0], valor[1])) {
        errores.push(`${donde}: debe ser [mínimo, máximo] del mismo tipo`);
      }
    } else if (op === "eq" || op === "neq") {
      if (!esEscalar(valor)) errores.push(`${donde}: debe ser texto, número, booleano o null`);
    } else if (!esOrdenable(valor)) {
      errores.push(`${donde}: debe ser número o texto`);
    }
  }
  return errores;
}

/**
 * Revisa TODA la estructura sin evaluarla (incluidas las ramas que un cortocircuito se saltaría).
 * Devuelve la lista de problemas; vacía = condición bien escrita.
 */
export function validarCondicion(condicion: unknown, en = "condicion"): string[] {
  if (!esObjeto(condicion)) return [`${en}: debe ser un objeto`];
  const claves = Object.keys(condicion);
  if (claves.length === 0) return [`${en}: no puede estar vacía`];

  const errores: string[] = [];
  if ("si" in condicion !== "entonces" in condicion) errores.push(`${en}: "si" y "entonces" van juntos`);

  for (const clave of claves) {
    const valor = condicion[clave];
    const donde = `${en}.${clave}`;
    if (clave === "all" || clave === "any") {
      if (!Array.isArray(valor) || valor.length === 0) errores.push(`${donde}: debe ser una lista no vacía`);
      else valor.forEach((c, i) => errores.push(...validarCondicion(c, `${donde}[${i}]`)));
    } else if (clave === "si" || clave === "entonces") {
      errores.push(...validarCondicion(valor, donde));
    } else {
      errores.push(...validarHoja(clave, valor, donde));
    }
  }
  return errores;
}
