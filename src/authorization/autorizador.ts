import { PolicyEngine } from "./abac/policy-engine";
import type { Accion, ContextoAutorizacion, ContextoBase, Decision, RecursoCtx } from "./tipos";

/** De dónde sale la matriz RBAC (la tabla `rol_permiso` en producción). */
export interface PermisosPort {
  tienePermiso(rol: string, permiso: string): Promise<boolean>;
}

const DENEGADO_POR_RBAC: Decision = { permitido: false, etapa: "RBAC", politica: null, motivo: "Denegado por RBAC" };

/**
 * Flujo de autorización de la guía (sección 4), por etapas:
 *   1. ESTADO  P7 (usuario activo) y P9 (acceso no vencido)  -> antes que nada
 *   2. RBAC    ¿el rol tiene el permiso de la acción?
 *   3. ABAC    todas las políticas aplicables (AND), ya con el recurso cargado
 * Deniega por defecto y nunca consulta el rol con `if`: todo sale de la BD.
 *
 * Está partido en `decidirPrevia` (1+2, no necesita el recurso) y `decidirAbac` (3) para que
 * el middleware NO cargue el recurso de quien ya fue rechazado: así un inactivo o un rol sin permiso
 * no puede averiguar si un documento existe.
 */
export class Autorizador {
  constructor(
    private readonly rbac: PermisosPort,
    private readonly motor: PolicyEngine,
  ) {}

  /** Etapas 1 y 2. */
  async decidirPrevia(base: ContextoBase, accion: Accion): Promise<Decision> {
    const estado = await this.motor.evaluar(base, accion, "ESTADO");
    if (!estado.permitido) return estado;
    if (!(await this.rbac.tienePermiso(base.usuario.rol, accion))) return DENEGADO_POR_RBAC;
    return { permitido: true };
  }

  /** Etapa 3 para un recurso. */
  decidirAbac(ctx: ContextoAutorizacion, accion: Accion): Promise<Decision> {
    return this.motor.evaluar(ctx, accion, "ABAC");
  }

  /** Etapa 3 para muchos recursos con una sola lectura de políticas (listas filtradas). */
  decidirAbacLote(base: ContextoBase, accion: Accion, recursos: RecursoCtx[]): Promise<Decision[]> {
    return this.motor.evaluarLote(base, accion, recursos);
  }

  /** Las tres etapas juntas. */
  async decidir(ctx: ContextoAutorizacion, accion: Accion): Promise<Decision> {
    const previa = await this.decidirPrevia(ctx, accion);
    return previa.permitido ? this.decidirAbac(ctx, accion) : previa;
  }
}
