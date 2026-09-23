/** Reloj (zona horaria de la empresa) y middleware que arma `req.entorno` desde los headers. */
import type { Request } from "express";
import { clock, fijarReloj } from "../../src/context/clock";
import { contextoEntorno } from "../../src/context/entorno";
import { AppError } from "../../src/errors";

afterEach(() => fijarReloj()); // siempre se restaura el reloj real

describe("clock · hora y fecha en la zona horaria de la empresa (America/Lima, UTC-5)", () => {
  test("la hora de Lima, no la del servidor (UTC)", () => {
    fijarReloj({ ahora: () => new Date("2026-09-24T01:30:00Z") });
    expect(clock.hora()).toBe("20:30");
  });

  test("la fecha también es la de Lima: a las 01:30 UTC del 24 todavía es 23 en Lima", () => {
    fijarReloj({ ahora: () => new Date("2026-09-24T01:30:00Z") });
    expect(clock.fecha()).toBe("2026-09-23");
  });

  test("medianoche es 00:05 (no 24:05)", () => {
    expect(clock.hora(new Date("2026-09-23T05:05:00Z"))).toBe("00:05");
  });

  test("las horas con un solo dígito llevan cero a la izquierda (se comparan como texto)", () => {
    expect(clock.hora(new Date("2026-09-23T13:07:00Z"))).toBe("08:07");
  });
});

describe("contextoEntorno", () => {
  // ip = null simula una conexión sin IP conocida (con `undefined` JS aplicaría el valor por defecto)
  function correr(headers: Record<string, string> = {}, ip: string | null = "::1") {
    const req = { header: (nombre: string) => headers[nombre.toLowerCase()], ip: ip ?? undefined } as unknown as Request;
    const next = jest.fn();
    contextoEntorno(req, {} as never, next);
    return { entorno: req.entorno, next };
  }

  beforeEach(() => fijarReloj({ ahora: () => new Date("2026-09-23T15:00:00Z") })); // 10:00 en Lima

  test("sin headers NO se asume nada: ubicación null y dispositivo DESCONOCIDO (P5 y P6 denegarán)", () => {
    const { entorno, next } = correr();
    expect(entorno).toEqual({ hora: "10:00", fecha: "2026-09-23", ubicacion: null, dispositivo: "DESCONOCIDO", direccion_ip: "::1" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("la ubicación se normaliza: sin tildes, mayúsculas, recortada", () => {
    expect(correr({ "x-ubicacion": " Perú " }).entorno.ubicacion).toBe("PERU");
    expect(correr({ "x-ubicacion": "chile" }).entorno.ubicacion).toBe("CHILE");
  });

  test("una ubicación vacía o absurdamente larga se descarta", () => {
    expect(correr({ "x-ubicacion": "   " }).entorno.ubicacion).toBeNull();
    expect(correr({ "x-ubicacion": "A".repeat(41) }).entorno.ubicacion).toBeNull();
  });

  test.each([
    ["corporativo", "CORPORATIVO"],
    ["PERSONAL", "PERSONAL"],
    ["laptop-del-primo", "DESCONOCIDO"],
    ["", "DESCONOCIDO"],
  ])("dispositivo '%s' → %s", (valor, esperado) => {
    expect(correr({ "x-dispositivo": valor }).entorno.dispositivo).toBe(esperado);
  });

  test("X-Hora simula la hora (fuera de producción)", () => {
    expect(correr({ "x-hora": "20:00" }).entorno.hora).toBe("20:00");
    expect(correr({ "x-hora": "00:00" }).entorno.hora).toBe("00:00");
  });

  test("un X-Hora vacío se ignora (Postman deja el header activo con la variable vacía)", () => {
    expect(correr({ "x-hora": "" }).entorno.hora).toBe("10:00");
  });

  test.each(["25:00", "24:00", "9:00", "10:60", "abc", "10:00:00"])("X-Hora inválida '%s' → 400", (valor) => {
    expect(() => correr({ "x-hora": valor })).toThrow(AppError);
    try {
      correr({ "x-hora": valor });
    } catch (e) {
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).codigo).toBe("VALIDACION");
    }
  });

  test("la IP viene de la conexión, nunca de un header que el cliente pueda inventar", () => {
    expect(correr({ "x-forwarded-for": "6.6.6.6" }, "10.0.0.7").entorno.direccion_ip).toBe("10.0.0.7");
    expect(correr({}, null).entorno.direccion_ip).toBeNull();
  });
});
