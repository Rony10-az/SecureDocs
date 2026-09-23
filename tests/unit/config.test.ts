/**
 * La configuración termina el proceso (process.exit) si algo está mal: se prueba lanzando un proceso hijo REAL
 * que importa `src/config.ts` con variables de entorno a medida. Dotenv no pisa variables ya definidas, así que
 * lo que se pase aquí manda sobre el .env de cada máquina.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

// Un módulo TypeScript compilado a CommonJS llega por import() con sus exports dentro de `default`
const PROGRAMA = 'import("./src/config.ts").then((m) => { const c = (m.default ?? m).config; console.log("CONFIG_OK", c.NODE_ENV, c.PORT, c.ZONA_HORARIA); })';

/**
 * `sinDefectos`: arranca SIN .env y quitando esas variables del entorno, para ver qué valor toma la aplicación
 * cuando nadie las define (si no, el .env de esta máquina ya las traería y no se probaría el valor por defecto).
 */
function arrancar(entorno: Record<string, string>, sinDefectos: string[] = []) {
  const env: Record<string, string | undefined> = { ...process.env, DOTENV_CONFIG_QUIET: "true", ...entorno };
  if (sinDefectos.length > 0) {
    env.DOTENV_CONFIG_PATH = join(process.cwd(), "este-archivo-no-existe.env");
    for (const clave of sinDefectos) delete env[clave];
  }
  const r = spawnSync(process.execPath, [tsx, "-e", PROGRAMA], { cwd: process.cwd(), env, encoding: "utf8", timeout: 60_000 });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

describe("configuración (src/config.ts)", () => {
  test("con variables válidas arranca", () => {
    const r = arrancar({ NODE_ENV: "development" });
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/CONFIG_OK development \d+ \S+/);
  });

  test("PORT llega como texto (variable de entorno) y se convierte a número", () => {
    const r = arrancar({ PORT: "4321" });
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/CONFIG_OK \S+ 4321 /);
  });

  test("si nadie los define, los valores por defecto son: desarrollo, puerto 3000 y la hora de Lima (P4 y P9 la necesitan)", () => {
    const r = arrancar({}, ["NODE_ENV", "PORT", "ZONA_HORARIA"]);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("CONFIG_OK development 3000 America/Lima");
  });

  test("en PRODUCCIÓN no arranca con el JWT_SECRET de ejemplo", () => {
    const r = arrancar({ NODE_ENV: "production", JWT_SECRET: "cambia-esto-por-un-secreto-largo-y-aleatorio" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("JWT_SECRET sigue con el valor de ejemplo");
  });

  test("en producción sí arranca con un secreto propio", () => {
    const r = arrancar({ NODE_ENV: "production", JWT_SECRET: "un-secreto-propio-largo-y-aleatorio-2026" });
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("CONFIG_OK production");
  });

  test("con un JWT_SECRET demasiado corto (menos de 16 caracteres) no arranca", () => {
    const r = arrancar({ JWT_SECRET: "corto" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("Variables de entorno inválidas");
  });

  test("sin DATABASE_URL no arranca: falla rápido con un mensaje claro, no a mitad de una petición", () => {
    const r = arrancar({ DATABASE_URL: "" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("Variables de entorno inválidas");
  });

  test("una zona horaria que no existe no arranca (P4 y P9 dependen de ella)", () => {
    const r = arrancar({ ZONA_HORARIA: "Marte/Olimpo" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/Zona horaria inválida/);
  });

  test("un NODE_ENV desconocido no arranca", () => {
    const r = arrancar({ NODE_ENV: "staging" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("Variables de entorno inválidas");
  });
});
