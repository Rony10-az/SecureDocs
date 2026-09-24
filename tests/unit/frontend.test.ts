/**
 * Frontend estático (public/). No necesita Docker ni base de datos: comprueba que la página se sirve con la CSP
 * de helmet, que todo lo que referencia existe, que no hay nada que esa CSP bloquearía y que el texto que viene
 * del servidor nunca entra a la página como HTML. El comportamiento de las pantallas se prueba a mano en el navegador.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { PASSWORD_PRUEBA, USUARIOS } from "../../prisma/datos";
import { app } from "../../src/app";

const publico = join(process.cwd(), "public");
const html = readFileSync(join(publico, "index.html"), "utf8");
const modulos = readdirSync(publico).filter((f) => f.endsWith(".js"));
const codigoDe = (archivo: string) => readFileSync(join(publico, archivo), "utf8");
// Sin comentarios: pueden nombrar lo que está prohibido para explicar por qué lo está
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("frontend (public/)", () => {
  test("GET / sirve la página con una CSP que solo admite recursos propios", async () => {
    const r = await request(app).get("/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.headers["content-security-policy"]).toContain("script-src 'self'");
  });

  test("todo lo que la página referencia existe: scripts, estilos y módulos que se importan entre sí", async () => {
    const rutas = new Set<string>();
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) rutas.add(m[1]);
    for (const archivo of modulos) {
      for (const m of codigoDe(archivo).matchAll(/from "\.\/([^"]+)"/g)) rutas.add(`/${m[1]}`);
    }
    expect(rutas.size).toBeGreaterThanOrEqual(8);
    for (const ruta of rutas) {
      const r = await request(app).get(ruta);
      expect({ ruta, estado: r.status }).toEqual({ ruta, estado: 200 });
    }
  });

  test("los archivos se sirven con su tipo correcto (un módulo con tipo equivocado no se ejecuta)", async () => {
    expect((await request(app).get("/app.js")).headers["content-type"]).toMatch(/javascript/);
    expect((await request(app).get("/vendor/bootstrap/bootstrap.min.css")).headers["content-type"]).toMatch(/text\/css/);
  });

  test("la página no tiene scripts en línea ni manejadores on…= (la CSP los bloquearía)", () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  test("ningún módulo arma HTML con texto ajeno ni usa eval: lo del servidor entra siempre como texto", () => {
    expect(modulos.length).toBeGreaterThanOrEqual(7);
    for (const archivo of modulos) {
      const prohibido = sinComentarios(codigoDe(archivo)).match(/\.(?:inner|outer)HTML|insertAdjacentHTML|document\.write|\beval\(|new Function/g);
      expect({ archivo, prohibido }).toEqual({ archivo, prohibido: null });
    }
  });

  test("el token vive en sessionStorage: ningún módulo usa localStorage", () => {
    for (const archivo of modulos) expect({ archivo, usaLocalStorage: /localStorage/.test(sinComentarios(codigoDe(archivo))) }).toEqual({ archivo, usaLocalStorage: false });
    expect(codigoDe("api.js")).toContain("sessionStorage");
  });

  test("fuera de producción se sirven los usuarios de demostración y coinciden con los del seed", async () => {
    const r = await request(app).get("/demo/usuarios.json");
    expect(r.status).toBe(200);
    expect(r.body.password).toBe(PASSWORD_PRUEBA);
    expect(r.body.usuarios.map((u: { correo: string }) => u.correo).sort()).toEqual(USUARIOS.map((u) => u.correo).sort());
    for (const u of r.body.usuarios) expect(u.nota.length).toBeGreaterThan(10);
  });

  test("en producción /demo NO se sirve, pero la aplicación sí", async () => {
    const antes = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET };
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "un-secreto-propio-largo-y-aleatorio-2026";
    try {
      let appProduccion!: typeof app;
      jest.isolateModules(() => {
        appProduccion = require("../../src/app").app; // config lee NODE_ENV al cargarse: hay que cargarla de nuevo
      });
      expect((await request(appProduccion).get("/demo/usuarios.json")).status).toBe(404);
      expect((await request(appProduccion).get("/")).status).toBe(200);
    } finally {
      process.env.NODE_ENV = antes.NODE_ENV;
      process.env.JWT_SECRET = antes.JWT_SECRET;
    }
  });
});
