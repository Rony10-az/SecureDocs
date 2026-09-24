/**
 * Frontend estático (public/). No necesita Docker ni base de datos: comprueba que la página se sirve con la CSP de
 * helmet, que todo lo que referencia existe, que no hay nada que esa CSP bloquearía, que el texto que viene del
 * servidor nunca entra a la página como HTML y que las piezas de lógica pura hacen lo que deben. El comportamiento de
 * las pantallas se prueba a mano en el navegador.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import request from "supertest";
import { POLITICAS, PASSWORD_PRUEBA, USUARIOS } from "../../prisma/datos";
import { app } from "../../src/app";

const publico = join(process.cwd(), "public");
const html = readFileSync(join(publico, "index.html"), "utf8");

/** Todos los .js de public/, también los de las subcarpetas. */
function modulosEn(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return modulosEn(ruta);
    return nombre.endsWith(".js") ? [ruta] : [];
  });
}

const modulos = modulosEn(join(publico, "js"));
const nombreDe = (ruta: string) => ruta.slice(publico.length + 1).replace(/\\/g, "/");
const codigoDe = (ruta: string) => readFileSync(ruta, "utf8");
// Sin comentarios: pueden nombrar lo que está prohibido para explicar por qué lo está
const sinComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Saca una función pura de un módulo ES (sin sus import) para probarla aquí. */
function extraerFuncion<T>(ruta: string, nombre: string): T {
  const fuente = /(?:export )?function nombre\([^\n]*\) \{[\s\S]*?\n\}/.exec(codigoDe(ruta).replace(new RegExp(`function ${nombre}\\b`), "function nombre"))?.[0];
  if (!fuente) throw new Error(`No se encontró la función ${nombre} en ${ruta}`);
  return new Function(`${fuente.replace("export ", "").replace("function nombre", `function ${nombre}`)}; return ${nombre};`)() as T;
}

describe("frontend (public/)", () => {
  test("GET / sirve la página con una CSP que solo admite recursos propios", async () => {
    const r = await request(app).get("/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.headers["content-security-policy"]).toContain("script-src 'self'");
  });

  test("la CSP admite blob: solo para la vista previa (imagen y marco) y sigue sin permitir scripts ajenos ni en línea", async () => {
    const csp = String((await request(app).get("/")).headers["content-security-policy"]);
    const directiva = (nombre: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${nombre} `));
    expect(directiva("img-src")).toBe("img-src 'self' data: blob:");
    expect(directiva("frame-src")).toBe("frame-src 'self' blob:");
    expect(directiva("script-src")).toBe("script-src 'self'");
    expect(directiva("script-src-attr")).toBe("script-src-attr 'none'");
    expect(directiva("object-src")).toBe("object-src 'none'");
  });

  test("las fotos de la portada y de los banners existen, se sirven como imagen y tienen su atribución", async () => {
    const fotos = new Set<string>();
    for (const fuente of [...modulos, join(publico, "css", "estilos.css")]) {
      for (const m of codigoDe(fuente).matchAll(/\/img\/([\w.-]+\.(?:jpg|png|webp))/g)) fotos.add(m[1]);
    }
    expect(fotos.size).toBeGreaterThanOrEqual(2);
    const creditos = readFileSync(join(publico, "img", "CREDITOS.md"), "utf8");
    for (const foto of fotos) {
      const r = await request(app).get(`/img/${foto}`);
      expect({ foto, estado: r.status, tipo: String(r.headers["content-type"]).startsWith("image/") }).toEqual({ foto, estado: 200, tipo: true });
      expect({ foto, acreditada: creditos.includes(foto) }).toEqual({ foto, acreditada: true });
    }
  });

  test("todo lo que la página referencia existe: estilos, scripts y la fuente de los iconos", async () => {
    const rutas = new Set<string>(["/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2"]);
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) rutas.add(m[1]);
    expect(rutas.size).toBeGreaterThanOrEqual(5);
    for (const ruta of rutas) {
      const r = await request(app).get(ruta);
      expect({ ruta, estado: r.status }).toEqual({ ruta, estado: 200 });
    }
  });

  test("cada módulo importa archivos que existen (una importación rota deja la aplicación en blanco)", () => {
    expect(modulos.length).toBeGreaterThanOrEqual(15);
    for (const modulo of modulos) {
      for (const m of codigoDe(modulo).matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
        const destino = resolve(dirname(modulo), m[1]);
        expect({ modulo: nombreDe(modulo), importa: m[1], existe: existsSync(destino) }).toEqual({ modulo: nombreDe(modulo), importa: m[1], existe: true });
      }
    }
  });

  test("los archivos se sirven con su tipo correcto (un módulo con tipo equivocado no se ejecuta)", async () => {
    expect((await request(app).get("/js/app.js")).headers["content-type"]).toMatch(/javascript/);
    expect((await request(app).get("/js/vistas/inicio.js")).headers["content-type"]).toMatch(/javascript/);
    expect((await request(app).get("/css/estilos.css")).headers["content-type"]).toMatch(/text\/css/);
    expect((await request(app).get("/vendor/bootstrap/bootstrap.min.css")).headers["content-type"]).toMatch(/text\/css/);
    expect((await request(app).get("/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2")).headers["content-type"]).toMatch(/woff2/);
  });

  test("la página no tiene scripts en línea ni manejadores on…= (la CSP los bloquearía)", () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  test("ningún módulo arma HTML con texto ajeno ni usa eval: lo del servidor entra siempre como texto", () => {
    for (const modulo of modulos) {
      const prohibido = sinComentarios(codigoDe(modulo)).match(/\.(?:inner|outer)HTML|insertAdjacentHTML|document\.write|\beval\(|new Function/g);
      expect({ modulo: nombreDe(modulo), prohibido }).toEqual({ modulo: nombreDe(modulo), prohibido: null });
    }
  });

  test("el token vive en sessionStorage: solo tema.js usa localStorage, y solo para el tema", () => {
    for (const modulo of modulos) {
      const usa = /localStorage/.test(sinComentarios(codigoDe(modulo)));
      expect({ modulo: nombreDe(modulo), usaLocalStorage: usa }).toEqual({ modulo: nombreDe(modulo), usaLocalStorage: nombreDe(modulo) === "js/tema.js" });
    }
    expect(codigoDe(join(publico, "js", "api.js"))).toContain("sessionStorage");
  });

  test("cada sección del menú tiene su ruta y cada ruta usa una vista importada", () => {
    const app = codigoDe(join(publico, "js", "app.js"));
    for (const m of app.matchAll(/\{ ruta: "(\w+)"/g)) expect({ ruta: m[1], tiene: app.includes(`patron: /^${m[1]}$/`) }).toEqual({ ruta: m[1], tiene: true });
    for (const m of app.matchAll(/vista: (\w+)/g)) expect({ vista: m[1], importada: new RegExp(`import \\{[^}]*\\b${m[1]}\\b[^}]*\\} from`).test(app) }).toEqual({ vista: m[1], importada: true });
  });

  test("el CSV de la auditoría neutraliza las fórmulas (=, +, -, @) y escapa comas y comillas", () => {
    const celdaCsv = extraerFuncion<(valor: unknown) => string>(join(publico, "js", "vistas", "auditoria.js"), "celdaCsv");
    expect(celdaCsv("=CMD|calc")).toBe("'=CMD|calc");
    expect(celdaCsv("+1")).toBe("'+1");
    expect(celdaCsv("-2")).toBe("'-2");
    expect(celdaCsv("@x")).toBe("'@x");
    expect(celdaCsv("a,b")).toBe('"a,b"');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCsv("DOC_READ")).toBe("DOC_READ");
    expect(celdaCsv(null)).toBe("");
    expect(celdaCsv(42)).toBe("42");
  });

  test("la lectura de condiciones encuentra los atributos que comparan las políticas sembradas", () => {
    const ruta = join(publico, "js", "condicion.js");
    const atributosDe = extraerFuncion<(c: unknown) => Set<string>>(ruta, "atributosDe");
    const politica = (codigo: string) => POLITICAS.find((p) => p.codigo === codigo)!;

    expect([...atributosDe(politica("P1").condicion)].sort()).toEqual(["recurso.departamento", "usuario.departamento"]); // eqAttr: también el lado derecho
    expect([...atributosDe(politica("P4").condicion)].sort()).toEqual(["entorno.hora", "recurso.nivel_confidencialidad"]); // bloque si / entonces / all
    expect(atributosDe(politica("P8").condicion).has("usuario.rol")).toBe(true);
    expect(atributosDe(politica("P9").condicion).has("entorno.fecha")).toBe(true);
    expect(atributosDe(politica("P11").condicion).has("recurso.id")).toBe(true);
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
