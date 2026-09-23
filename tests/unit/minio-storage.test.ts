/** MinioStorage con un cliente falso: qué pasa cuando MinIO se cae o el objeto no existe (sin necesitar Docker). */
import type { Client } from "minio";
import { AppError } from "../../src/errors";
import { MinioStorage } from "../../src/storage/minio.storage";
import { ArchivoNoEncontrado } from "../../src/storage/storage.service";

type Metodo = "putObject" | "getObject" | "removeObject" | "bucketExists" | "makeBucket";
const clienteFalso = (impl: Partial<Record<Metodo, jest.Mock>>) => impl as unknown as Client;
const errorDeRed = (codigo: string) => Object.assign(new Error("fallo de red"), { code: codigo });

let consola: jest.SpyInstance;
beforeEach(() => {
  consola = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => consola.mockRestore());

/** Ejecuta `fn` y devuelve el AppError que lanza. */
async function apperror(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("Se esperaba un AppError y no se lanzó nada");
}

describe("cuando MinIO no responde", () => {
  test.each(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"])(
    "%s -> 503 ALMACENAMIENTO_NO_DISPONIBLE al guardar, al leer y al eliminar",
    async (codigo) => {
      const falla = jest.fn().mockRejectedValue(errorDeRed(codigo));
      const s = new MinioStorage(clienteFalso({ putObject: falla, getObject: falla, removeObject: falla }), "bucket");

      for (const operacion of [() => s.guardar("k", Buffer.from("x"), "application/pdf"), () => s.leer("k"), () => s.eliminar("k")]) {
        const e = await apperror(operacion);
        expect(e.status).toBe(503);
        expect(e.codigo).toBe("ALMACENAMIENTO_NO_DISPONIBLE");
      }
    },
  );

  test("el código de red también se reconoce cuando viene dentro de `cause`", async () => {
    const falla = jest.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    const e = await apperror(() => new MinioStorage(clienteFalso({ putObject: falla }), "b").guardar("k", Buffer.from("x"), "image/png"));
    expect(e.status).toBe(503);
  });

  test("el mensaje al cliente no revela detalles internos", async () => {
    const falla = jest.fn().mockRejectedValue(errorDeRed("ECONNREFUSED"));
    const e = await apperror(() => new MinioStorage(clienteFalso({ getObject: falla }), "b").leer("k"));
    expect(e.message).not.toMatch(/ECONNREFUSED|localhost|9000/);
  });
});

describe("otros errores", () => {
  test("un objeto que no existe (NoSuchKey) al leer -> ArchivoNoEncontrado", async () => {
    const getObject = jest.fn().mockRejectedValue(Object.assign(new Error("The specified key does not exist."), { code: "NoSuchKey" }));
    await expect(new MinioStorage(clienteFalso({ getObject }), "b").leer("no-existe")).rejects.toBeInstanceOf(ArchivoNoEncontrado);
  });

  test("cualquier otro error se propaga tal cual: no se disfraza de 503", async () => {
    const rareza = new Error("AccessDenied");
    const putObject = jest.fn().mockRejectedValue(rareza);
    await expect(new MinioStorage(clienteFalso({ putObject }), "b").guardar("k", Buffer.from("x"), "application/pdf")).rejects.toBe(rareza);
  });
});

describe("operaciones normales", () => {
  test("guardar sube con el nombre UUID, el tamaño y el tipo MIME", async () => {
    const putObject = jest.fn().mockResolvedValue({});
    const contenido = Buffer.from("contenido");
    await new MinioStorage(clienteFalso({ putObject }), "securedocs").guardar("clave-uuid", contenido, "application/pdf");
    expect(putObject).toHaveBeenCalledWith("securedocs", "clave-uuid", contenido, contenido.length, { "Content-Type": "application/pdf" });
  });

  test("eliminar borra por clave", async () => {
    const removeObject = jest.fn().mockResolvedValue(undefined);
    await new MinioStorage(clienteFalso({ removeObject }), "securedocs").eliminar("clave-uuid");
    expect(removeObject).toHaveBeenCalledWith("securedocs", "clave-uuid");
  });

  test("asegurarContenedor crea el bucket solo si NO existe (y sin abrirlo al público)", async () => {
    const makeBucket = jest.fn().mockResolvedValue(undefined);
    await new MinioStorage(clienteFalso({ bucketExists: jest.fn().mockResolvedValue(false), makeBucket }), "nuevo").asegurarContenedor();
    expect(makeBucket).toHaveBeenCalledTimes(1);
    expect(makeBucket).toHaveBeenCalledWith("nuevo"); // sin región ni políticas: MinIO lo crea privado

    const otroMake = jest.fn();
    await new MinioStorage(clienteFalso({ bucketExists: jest.fn().mockResolvedValue(true), makeBucket: otroMake }), "existente").asegurarContenedor();
    expect(otroMake).not.toHaveBeenCalled();
  });
});
