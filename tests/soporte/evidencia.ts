/**
 * Evidencia de pruebas: mientras corren los 17 casos se van anotando la petición, lo esperado, lo
 * obtenido y el registro de auditoría que dejó cada uno; al final se escribe `evidencias/casos-guia.md`
 * (entregable "Evidencias de pruebas" + "Registro de auditoría" de la guía).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FilaAuditoria {
  id: number;
  fecha: string;
  usuario_correo: string | null;
  accion: string;
  recurso: string;
  resultado: string;
  etapa: string;
  politica_codigo: string | null;
  motivo: string;
  ip: string | null;
  ubicacion: string | null;
  dispositivo: string | null;
}

export interface EvidenciaCaso {
  numero: number;
  escenario: string;
  actor: string;
  peticion: string;
  esperado: string;
  obtenido: string;
  auditoria: FilaAuditoria | null;
  correcto: boolean;
}

export interface MetaEvidencia {
  ejecutadoEn: string;
  node: string;
  baseDeDatos: string;
  almacenamiento: string;
  relojFijado: string;
}

const celda = (valor: string | number | null | undefined) => String(valor ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function renderizarEvidencia(casos: EvidenciaCaso[], meta: MetaEvidencia): string {
  const ordenados = [...casos].sort((a, b) => a.numero - b.numero);
  const correctos = ordenados.filter((c) => c.correcto).length;

  const lineas: string[] = [
    "# Evidencia de pruebas — los 17 casos de la guía (sección 11)",
    "",
    `**Resultado: ${correctos}/${ordenados.length} casos correctos.**`,
    "",
    "Generado automáticamente por `tests/integracion/casos-guia.test.ts` (Jest + Supertest) contra la API, PostgreSQL y MinIO reales.",
    "",
    "| | |",
    "|---|---|",
    `| Ejecutado | ${celda(meta.ejecutadoEn)} |`,
    `| Node | ${celda(meta.node)} |`,
    `| Base de datos | ${celda(meta.baseDeDatos)} |`,
    `| Almacenamiento | ${celda(meta.almacenamiento)} |`,
    `| Reloj de la aplicación | ${celda(meta.relojFijado)} |`,
    "",
    "Cada caso comprueba tres cosas: **(1)** la respuesta HTTP, **(2)** el detalle de la denegación (`etapa`, `politica`, `motivo`) y **(3)** que se creó exactamente un registro de auditoría con el motivo correcto.",
    "",
    "## Resumen",
    "",
    "| # | Escenario | Usuario | Petición | Esperado | Obtenido | OK |",
    "|---|---|---|---|---|---|---|",
    ...ordenados.map((c) => `| ${c.numero} | ${celda(c.escenario)} | ${celda(c.actor)} | \`${celda(c.peticion)}\` | ${celda(c.esperado)} | ${celda(c.obtenido)} | ${c.correcto ? "✅" : "❌"} |`),
    "",
    "## Registro de auditoría que dejó cada caso",
    "",
    "| # | id | Resultado | Etapa | Política | Acción | Recurso | Motivo | IP | Ubicación | Dispositivo |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...ordenados.map((c) => {
      const a = c.auditoria;
      return a
        ? `| ${c.numero} | ${a.id} | ${a.resultado} | ${a.etapa} | ${celda(a.politica_codigo)} | ${a.accion} | ${celda(a.recurso)} | ${celda(a.motivo)} | ${celda(a.ip)} | ${celda(a.ubicacion)} | ${celda(a.dispositivo)} |`
        : `| ${c.numero} | — | — | — | — | — | — | (no se llegó a registrar) | — | — | — |`;
    }),
    "",
    "La tabla `auditoria` es inmutable: un trigger de PostgreSQL rechaza `UPDATE`, `DELETE` y `TRUNCATE` (probado en `tests/integracion/auditoria.test.ts`).",
    "",
  ];
  return lineas.join("\n");
}

/** Escribe el archivo en `evidencias/` (carpeta en la raíz del proyecto). */
export function escribirEvidencia(nombre: string, contenido: string): string {
  const carpeta = join(process.cwd(), "evidencias");
  mkdirSync(carpeta, { recursive: true });
  const ruta = join(carpeta, nombre);
  writeFileSync(ruta, contenido, "utf8");
  return ruta;
}
