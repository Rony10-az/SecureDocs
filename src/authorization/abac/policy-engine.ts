import type { ContextoAutorizacion, ContextoBase, Decision, RecursoCtx } from "../tipos";
import { CondicionInvalida, evaluarCondicion, validarCondicion } from "./condicion";
import type { EtapaPolitica, PoliticaDef, PoliticasPort } from "./tipos";

const porOrden = (a: PoliticaDef, b: PoliticaDef) =>
  a.orden - b.orden || a.codigo.localeCompare(b.codigo, "en", { numeric: true }); // P2 antes que P10

/** ¿Esta política le toca a esta petición? (activa, de la etapa, para esta acción y rol no exceptuado) */
function aplica(p: PoliticaDef, etapa: EtapaPolitica, rol: string, accion: string): boolean {
  return (
    p.activa &&
    p.etapa === etapa &&
    (p.acciones.includes("*") || p.acciones.includes(accion)) &&
    !p.roles_exceptuados.includes(rol)
  );
}

function denegar(etapa: EtapaPolitica, politica: string, motivo: string): Decision {
  return { permitido: false, etapa, politica, motivo };
}

/**
 * Núcleo del motor (función pura, sin BD): evalúa en orden todas las políticas aplicables.
 * Todas deben cumplirse (AND); la primera que falla decide y su motivo es el de la respuesta.
 *
 * Fail-closed: una política mal escrita NO se ignora ni se da por cumplida: se deniega.
 */
export function evaluarPoliticas(
  politicas: PoliticaDef[],
  ctx: ContextoAutorizacion,
  accion: string,
  etapa: EtapaPolitica,
): Decision {
  const atributos = { usuario: ctx.usuario, recurso: ctx.recurso, entorno: ctx.entorno };
  const aplicables = politicas.filter((p) => aplica(p, etapa, ctx.usuario.rol, accion)).sort(porOrden);

  for (const p of aplicables) {
    const problemas = validarCondicion(p.condicion);
    if (problemas.length > 0) {
      console.error(`[ABAC] Política ${p.codigo} mal configurada:`, problemas);
      return denegar(etapa, p.codigo, `Política ${p.codigo} mal configurada`);
    }

    let cumple: boolean;
    try {
      cumple = evaluarCondicion(p.condicion, atributos);
    } catch (e) {
      if (!(e instanceof CondicionInvalida)) throw e;
      console.error(`[ABAC] Política ${p.codigo} no se pudo evaluar:`, e.message);
      return denegar(etapa, p.codigo, `Política ${p.codigo} mal configurada`);
    }

    if (!cumple) return denegar(etapa, p.codigo, p.motivo_denegacion);
  }
  return { permitido: true };
}

/** El motor: carga las políticas activas desde su origen (BD) y las evalúa. */
export class PolicyEngine {
  constructor(private readonly repo: PoliticasPort) {}

  async evaluar(ctx: ContextoAutorizacion, accion: string, etapa: EtapaPolitica): Promise<Decision> {
    return evaluarPoliticas(await this.repo.activas(etapa), ctx, accion, etapa);
  }

  /** Varios recursos con UNA sola lectura de políticas (p. ej. filtrar una lista de documentos). */
  async evaluarLote(base: ContextoBase, accion: string, recursos: RecursoCtx[], etapa: EtapaPolitica = "ABAC") {
    const politicas = await this.repo.activas(etapa);
    return recursos.map((recurso) => evaluarPoliticas(politicas, { ...base, recurso }, accion, etapa));
  }
}
