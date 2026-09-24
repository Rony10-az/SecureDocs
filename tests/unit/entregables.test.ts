/**
 * Los entregables (docs/entregables.md) copian la matriz RBAC y las políticas que se siembran (prisma/datos.ts). Esta
 * prueba no necesita Docker: falla si alguien cambia los roles, permisos o políticas y olvida actualizar el documento, o
 * si falta algo que el documento promete (los diagramas, los nueve entregables, README con instalación y supuestos).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATRIZ_RBAC, PERMISOS, POLITICAS } from "../../prisma/datos";

const leer = (...ruta: string[]) => readFileSync(join(process.cwd(), ...ruta), "utf8").replace(/\r\n/g, "\n");
const entregables = leer("docs", "entregables.md");
const roles = Object.keys(MATRIZ_RBAC);

describe("entregables (docs/entregables.md)", () => {
  test("la matriz RBAC del documento es exactamente la que se siembra (si falla, actualiza docs/entregables.md)", () => {
    for (const permiso of PERMISOS) {
      const marcas = roles.map((rol) => (MATRIZ_RBAC[rol].includes(permiso) ? "✔" : "—"));
      expect(entregables).toContain(`| \`${permiso}\` | ${marcas.join(" | ")} |`);
    }
    expect(entregables).toContain(`| **Total** | ${roles.map((rol) => `**${MATRIZ_RBAC[rol].length}**`).join(" | ")} |`);
  });

  test("la matriz ABAC trae las 11 políticas, con su etapa, su orden y su motivo de denegación", () => {
    expect(POLITICAS).toHaveLength(11);
    for (const p of POLITICAS) {
      expect(entregables).toContain(`| **${p.codigo}** | ${p.nombre} | ${p.etapa} | ${p.orden} |`);
      expect(entregables).toContain(`| ${p.motivo_denegacion} |`);
    }
  });

  test("el documento trae sus cuatro diagramas Mermaid, en el orden de la guía", () => {
    const nombres = [...entregables.matchAll(/```mermaid\n%% ([\w-]+)\n/g)].map((m) => m[1]);
    expect(nombres).toEqual(["arquitectura", "flujo-autorizacion", "modelo-seguridad", "modelo-documentos"]);
  });

  test("el documento cubre los nueve entregables de la guía y no deja marcadores sin resolver", () => {
    for (let n = 1; n <= 9; n++) expect(entregables).toMatch(new RegExp(`^# ${n}\\. `, "m"));
    expect(entregables).not.toMatch(/\{\{\w+\}\}/);
  });

  test("el README explica la instalación y los supuestos de interpretación", () => {
    const readme = leer("README.md");
    expect(readme).toMatch(/^## Instalación$/m);
    expect(readme).toMatch(/^## Supuestos de interpretación y decisiones$/m);
    expect(readme).toContain("npx prisma migrate deploy");
    expect(readme).toContain("npm run db:seed");
    for (const p of POLITICAS) expect(entregables).toContain(p.codigo);
  });
});
