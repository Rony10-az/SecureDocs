/** El motor y el orquestador en general (con políticas inventadas), no las P1–P10 concretas. */
import { POLITICAS } from "../../prisma/datos";
import { PolicyEngine, evaluarPoliticas } from "../../src/authorization/abac/policy-engine";
import type { PoliticaDef } from "../../src/authorization/abac/tipos";
import { Autorizador } from "../../src/authorization/autorizador";
import type { ContextoAutorizacion, Decision } from "../../src/authorization/tipos";
import { contexto, documento, entorno, repoDe, usuario } from "./helpers";

const SIEMPRE_FALLA = { "usuario.estado": { eq: "NUNCA" } };
const SIEMPRE_CUMPLE = { "usuario.estado": { eq: "ACTIVO" } };

const pol = (p: Partial<PoliticaDef> & Pick<PoliticaDef, "codigo" | "condicion">): PoliticaDef => ({
  nombre: p.codigo,
  etapa: "ABAC",
  orden: 1,
  acciones: ["*"],
  roles_exceptuados: [],
  motivo_denegacion: `Falla ${p.codigo}`,
  activa: true,
  ...p,
});

const ctx: ContextoAutorizacion = contexto("empleado.fin@techcorp.pe", "Presupuesto 2026");
const evaluar = (politicas: PoliticaDef[], accion = "DOC_READ", c = ctx) => evaluarPoliticas(politicas, c, accion, "ABAC");
const deniega = (politica: string, motivo: string): Decision => ({ permitido: false, etapa: "ABAC", politica, motivo });

let errorConsola: jest.SpyInstance;
beforeEach(() => {
  errorConsola = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorConsola.mockRestore());

describe("evaluarPoliticas · qué políticas aplican", () => {
  test("una política inactiva se ignora", () => {
    expect(evaluar([pol({ codigo: "X", condicion: SIEMPRE_FALLA, activa: false })])).toEqual({ permitido: true });
  });

  test("solo se evalúa si la acción está en su lista", () => {
    const p = pol({ codigo: "X", condicion: SIEMPRE_FALLA, acciones: ["DOC_UPDATE"] });
    expect(evaluar([p], "DOC_READ")).toEqual({ permitido: true });
    expect(evaluar([p], "DOC_UPDATE")).toEqual(deniega("X", "Falla X"));
  });

  test("el comodín '*' aplica a cualquier acción", () => {
    const p = pol({ codigo: "X", condicion: SIEMPRE_FALLA, acciones: ["*"] });
    for (const accion of ["DOC_READ", "AUDIT_READ", "USER_MANAGE"]) expect(evaluar([p], accion)).toEqual(deniega("X", "Falla X"));
  });

  test("los roles exceptuados no la sufren; los demás sí", () => {
    const p = pol({ codigo: "X", condicion: SIEMPRE_FALLA, roles_exceptuados: ["EMPLEADO"] });
    expect(evaluar([p])).toEqual({ permitido: true });
    expect(evaluar([p], "DOC_READ", { ...ctx, usuario: usuario("gerente.fin@techcorp.pe") })).toEqual(deniega("X", "Falla X"));
  });

  test("sin políticas aplicables se permite (la denegación por defecto la da RBAC, no el ABAC)", () => {
    expect(evaluar([])).toEqual({ permitido: true });
  });

  test("cada etapa solo ve sus políticas", () => {
    const deEstado = pol({ codigo: "E", condicion: SIEMPRE_FALLA, etapa: "ESTADO" });
    expect(evaluarPoliticas([deEstado], ctx, "DOC_READ", "ABAC")).toEqual({ permitido: true });
    expect(evaluarPoliticas([deEstado], ctx, "DOC_READ", "ESTADO")).toMatchObject({ permitido: false, etapa: "ESTADO", politica: "E" });
  });
});

describe("evaluarPoliticas · orden y desempate", () => {
  test("todas deben cumplirse (AND): con una que falle, se deniega", () => {
    const ps = [pol({ codigo: "A", condicion: SIEMPRE_CUMPLE, orden: 1 }), pol({ codigo: "B", condicion: SIEMPRE_FALLA, orden: 2 })];
    expect(evaluar(ps)).toEqual(deniega("B", "Falla B"));
  });

  test("decide la primera que falla por 'orden', sin importar la posición en la lista", () => {
    const ps = [pol({ codigo: "TARDE", condicion: SIEMPRE_FALLA, orden: 50 }), pol({ codigo: "TEMPRANO", condicion: SIEMPRE_FALLA, orden: 5 })];
    expect(evaluar(ps)).toEqual(deniega("TEMPRANO", "Falla TEMPRANO"));
  });

  test("con el mismo 'orden' desempata por código, en orden numérico (P2 antes que P10)", () => {
    const ps = [pol({ codigo: "P10", condicion: SIEMPRE_FALLA }), pol({ codigo: "P2", condicion: SIEMPRE_FALLA })];
    expect(evaluar(ps)).toEqual(deniega("P2", "Falla P2"));
  });
});

describe("evaluarPoliticas · falla cerrado ante políticas mal escritas", () => {
  const MAL = (codigo: string): Decision => deniega(codigo, `Política ${codigo} mal configurada`);

  test("un operador con typo NO se ignora: se deniega y se deja constancia en el log", () => {
    expect(evaluar([pol({ codigo: "X", condicion: { "usuario.estado": { igual: "ACTIVO" } } })])).toEqual(MAL("X"));
    expect(errorConsola).toHaveBeenCalled();
  });

  test("condicion que no es un objeto (p. ej. null que vino de la BD) → deniega", () => {
    expect(evaluar([pol({ codigo: "X", condicion: null as unknown as PoliticaDef["condicion"] })])).toEqual(MAL("X"));
  });

  test("un error escondido en una rama que no se evaluaría igual se detecta", () => {
    const escondido = { si: SIEMPRE_FALLA, entonces: { "usuario.estado": { igual: "X" } } };
    expect(evaluar([pol({ codigo: "X", condicion: escondido })])).toEqual(MAL("X"));
  });

  test("una política mal escrita que no aplica a esta acción no afecta", () => {
    const p = pol({ codigo: "X", condicion: { basura: 1 }, acciones: ["DOC_DELETE"] });
    expect(evaluar([p], "DOC_READ")).toEqual({ permitido: true });
  });
});

describe("PolicyEngine", () => {
  test("evaluarLote lee las políticas UNA sola vez y da una decisión por recurso", async () => {
    const activas = jest.fn(repoDe(POLITICAS).activas);
    const motor = new PolicyEngine({ activas });
    const base = { usuario: usuario("empleado.fin@techcorp.pe"), entorno: entorno() };

    const decisiones = await motor.evaluarLote(base, "DOC_READ", [
      documento("Presupuesto 2026"),
      documento("Planilla de sueldos"),
      documento("Plan de inversiones"),
    ]);

    expect(activas).toHaveBeenCalledTimes(1);
    expect(activas).toHaveBeenCalledWith("ABAC");
    expect(decisiones.map((d) => d.permitido)).toEqual([true, false, false]);
    expect(decisiones[1]).toMatchObject({ politica: "P1" });
    expect(decisiones[2]).toMatchObject({ politica: "P2" }); // nivel 3 < 4
  });
});

describe("Autorizador · orden de las etapas", () => {
  const eduardo = usuario("empleado.fin@techcorp.pe");

  function armar(tienePermiso = jest.fn(async () => true)) {
    const activas = jest.fn(repoDe(POLITICAS).activas);
    const autorizador = new Autorizador({ tienePermiso }, new PolicyEngine({ activas }));
    return { autorizador, tienePermiso, activas };
  }

  test("P7 se evalúa ANTES que RBAC: a un inactivo ni se le consulta el permiso", async () => {
    const { autorizador, tienePermiso } = armar();
    const base = { usuario: usuario("empleado.fin@techcorp.pe", { estado: "INACTIVO" }), entorno: entorno() };
    expect(await autorizador.decidirPrevia(base, "DOC_READ")).toMatchObject({ permitido: false, etapa: "ESTADO", politica: "P7" });
    expect(tienePermiso).not.toHaveBeenCalled();
  });

  test("RBAC se consulta con el rol y la acción del usuario", async () => {
    const { autorizador, tienePermiso } = armar();
    await autorizador.decidirPrevia({ usuario: eduardo, entorno: entorno() }, "DOC_APPROVE");
    expect(tienePermiso).toHaveBeenCalledTimes(1);
    expect(tienePermiso).toHaveBeenCalledWith("EMPLEADO", "DOC_APPROVE");
  });

  test("sin permiso RBAC: 'Denegado por RBAC', sin política, y no se cargan las políticas ABAC", async () => {
    const { autorizador, activas } = armar(jest.fn(async () => false));
    const ctxDoc = contexto("empleado.fin@techcorp.pe", "Planilla de sueldos"); // ABAC también lo denegaría (P1)
    expect(await autorizador.decidir(ctxDoc, "DOC_APPROVE")).toEqual({
      permitido: false,
      etapa: "RBAC",
      politica: null,
      motivo: "Denegado por RBAC",
    });
    expect(activas).toHaveBeenCalledTimes(1); // solo la etapa ESTADO
    expect(activas).toHaveBeenCalledWith("ESTADO");
  });

  test("decidirPrevia no necesita el recurso (así el middleware no lo carga para quien ya fue rechazado)", async () => {
    const { autorizador } = armar();
    expect(await autorizador.decidirPrevia({ usuario: eduardo, entorno: entorno() }, "DOC_READ")).toEqual({ permitido: true });
  });

  test("con estado y RBAC en regla, la decisión final sale de ABAC", async () => {
    const { autorizador, activas } = armar();
    const ctxDoc = contexto("empleado.fin@techcorp.pe", "Planilla de sueldos");
    expect(await autorizador.decidir(ctxDoc, "DOC_READ")).toMatchObject({ permitido: false, etapa: "ABAC", politica: "P1" });
    expect(activas.mock.calls.map(([etapa]) => etapa)).toEqual(["ESTADO", "ABAC"]);
  });
});
