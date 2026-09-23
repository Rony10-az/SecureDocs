/** Reglas de negocio de los documentos que no dependen de la BD: ciclo de vida y esquemas de entrada. */
import type { EstadoDocumento } from "@prisma/client";
import { AppError } from "../../src/errors";
import { estadoTrasDecision, estadoTrasEditar } from "../../src/modules/documentos/documentos.estado";
import {
  actualizarDocumentoSchema,
  crearDocumentoSchema,
  decisionSchema,
  listaDocumentosSchema,
} from "../../src/modules/documentos/documentos.schemas";

const ESTADOS: EstadoDocumento[] = ["BORRADOR", "PENDIENTE", "PUBLICADO", "RECHAZADO"];

function status(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.status : -1;
  }
}

describe("estadoTrasEditar (editar un documento)", () => {
  const con = (hayCambios: boolean, enviar: boolean, tieneArchivo = true) => ({ hayCambios, enviar, tieneArchivo });

  test.each<[EstadoDocumento, EstadoDocumento]>([
    ["BORRADOR", "BORRADOR"],
    ["PENDIENTE", "PENDIENTE"],
    ["RECHAZADO", "RECHAZADO"],
    ["PUBLICADO", "PENDIENTE"], // modificar lo publicado exige nueva aprobación
  ])("editar sin enviar: %s -> %s", (actual, esperado) => {
    expect(estadoTrasEditar(actual, con(true, false))).toBe(esperado);
  });

  test.each<[EstadoDocumento, EstadoDocumento]>([
    ["BORRADOR", "PENDIENTE"],
    ["RECHAZADO", "PENDIENTE"],
    ["PUBLICADO", "PENDIENTE"], // con cambios
  ])("editar y enviar: %s -> %s", (actual, esperado) => {
    expect(estadoTrasEditar(actual, con(true, true))).toBe(esperado);
  });

  test("enviar un BORRADOR sin tocar nada más también vale", () => {
    expect(estadoTrasEditar("BORRADOR", con(false, true))).toBe("PENDIENTE");
  });

  test("enviar lo que ya está PENDIENTE es un 409", () => {
    expect(status(() => estadoTrasEditar("PENDIENTE", con(true, true)))).toBe(409);
  });

  test("enviar lo PUBLICADO sin cambios es un 409", () => {
    expect(status(() => estadoTrasEditar("PUBLICADO", con(false, true)))).toBe(409);
  });

  test("no se envía a aprobación un documento sin archivo (400)", () => {
    for (const estado of ESTADOS) expect(status(() => estadoTrasEditar(estado, con(true, true, false)))).toBe(400);
  });

  test("sin enviar, tener o no archivo no importa", () => {
    expect(estadoTrasEditar("BORRADOR", con(true, false, false))).toBe("BORRADOR");
  });
});

describe("estadoTrasDecision (aprobar / rechazar)", () => {
  test("PENDIENTE + APROBAR = PUBLICADO; + RECHAZAR = RECHAZADO", () => {
    expect(estadoTrasDecision("PENDIENTE", "APROBAR")).toBe("PUBLICADO");
    expect(estadoTrasDecision("PENDIENTE", "RECHAZAR")).toBe("RECHAZADO");
  });

  test.each(["BORRADOR", "PUBLICADO", "RECHAZADO"] as const)("un documento %s no se puede resolver (409)", (estado) => {
    expect(status(() => estadoTrasDecision(estado, "APROBAR"))).toBe(409);
    expect(status(() => estadoTrasDecision(estado, "RECHAZAR"))).toBe(409);
  });
});

describe("crearDocumentoSchema (POST /documentos)", () => {
  const valido = { titulo: "Informe de ventas", nivel_confidencialidad: 3 };
  const ok = (datos: unknown) => crearDocumentoSchema.safeParse(datos);
  const campos = (datos: unknown) => {
    const r = ok(datos);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  test("lo mínimo: título y nivel (enviar=false por defecto)", () => {
    const r = ok(valido);
    expect(r.success && r.data).toMatchObject({ titulo: "Informe de ventas", nivel_confidencialidad: 3, enviar: false });
  });

  test("los formularios multipart mandan todo como texto: '3' se convierte en 3 y 'true' en true", () => {
    const r = ok({ titulo: "Informe", nivel_confidencialidad: "4", enviar: "true" });
    expect(r.success && r.data).toMatchObject({ nivel_confidencialidad: 4, enviar: true });
  });

  test.each(["true", "1", "on", "yes"])("enviar acepta el texto %j como verdadero", (texto) => {
    const r = ok({ ...valido, enviar: texto });
    expect(r.success && r.data.enviar).toBe(true);
  });

  test("el departamento se normaliza a mayúsculas y sin espacios", () => {
    const r = ok({ ...valido, departamento: "  finanzas " });
    expect(r.success && r.data.departamento).toBe("FINANZAS");
  });

  test.each([
    ["sin título", { nivel_confidencialidad: 3 }, "titulo"],
    ["título muy corto", { ...valido, titulo: "ab" }, "titulo"],
    ["título solo espacios", { ...valido, titulo: "    " }, "titulo"],
    ["título larguísimo", { ...valido, titulo: "x".repeat(201) }, "titulo"],
    ["sin nivel", { titulo: "Informe" }, "nivel_confidencialidad"],
    ["nivel 0", { ...valido, nivel_confidencialidad: 0 }, "nivel_confidencialidad"],
    ["nivel 6", { ...valido, nivel_confidencialidad: 6 }, "nivel_confidencialidad"],
    ["nivel decimal", { ...valido, nivel_confidencialidad: 2.5 }, "nivel_confidencialidad"],
    ["nivel que no es número", { ...valido, nivel_confidencialidad: "alto" }, "nivel_confidencialidad"],
    ["descripción larguísima", { ...valido, descripcion: "x".repeat(2001) }, "descripcion"],
  ])("rechaza: %s", (_caso, datos, campo) => {
    expect(campos(datos)).toContain(campo);
  });

  test.each(["estado", "propietario_id", "aprobado_por", "fecha_aprobacion", "eliminado_en", "archivo_clave", "id"])(
    "mass assignment: el campo '%s' NO se ignora en silencio, se rechaza",
    (campo) => {
      expect(ok({ ...valido, [campo]: "PUBLICADO" }).success).toBe(false);
    },
  );
});

describe("actualizarDocumentoSchema (PUT /documentos/:id)", () => {
  test("todos los campos son opcionales", () => {
    expect(actualizarDocumentoSchema.safeParse({}).success).toBe(true);
    expect(actualizarDocumentoSchema.safeParse({ titulo: "Nuevo título" }).success).toBe(true);
  });

  test.each(["departamento", "nivel_confidencialidad", "pais", "propietario_id", "estado"])(
    "'%s' NO se puede modificar después de crear el documento",
    (campo) => {
      expect(actualizarDocumentoSchema.safeParse({ [campo]: "X" }).success).toBe(false);
    },
  );

  test("una descripción vacía es válida (sirve para borrarla)", () => {
    expect(actualizarDocumentoSchema.safeParse({ descripcion: "" }).success).toBe(true);
  });
});

describe("decisionSchema (POST /documentos/:id/aprobar)", () => {
  test("sin cuerpo = APROBAR", () => {
    expect(decisionSchema.parse({})).toEqual({ decision: "APROBAR" });
  });
  test("RECHAZAR", () => {
    expect(decisionSchema.parse({ decision: "RECHAZAR" })).toEqual({ decision: "RECHAZAR" });
  });
  test.each(["aprobar", "SI", "", 1])("valor inválido %j", (valor) => {
    expect(decisionSchema.safeParse({ decision: valor }).success).toBe(false);
  });
  test("no admite campos extra", () => {
    expect(decisionSchema.safeParse({ decision: "APROBAR", estado: "PUBLICADO" }).success).toBe(false);
  });
});

describe("listaDocumentosSchema (GET /documentos)", () => {
  test("valores por defecto", () => {
    expect(listaDocumentosSchema.parse({})).toEqual({ pagina: 1, limite: 20 });
  });
  test("filtros: el departamento se normaliza y los números llegan como texto", () => {
    expect(listaDocumentosSchema.parse({ departamento: "rrhh", estado: "PENDIENTE", pagina: "2", limite: "5", q: " plan " })).toEqual({
      departamento: "RRHH",
      estado: "PENDIENTE",
      pagina: 2,
      limite: 5,
      q: "plan",
    });
  });
  test.each([{ limite: "101" }, { limite: "0" }, { pagina: "0" }, { estado: "BORRADORCITO" }])("rechaza %j", (q) => {
    expect(listaDocumentosSchema.safeParse(q).success).toBe(false);
  });
});
