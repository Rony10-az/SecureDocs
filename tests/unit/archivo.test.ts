/** Validación de archivos subidos: tipo por firma, tamaño, coherencia con la extensión y nombre seguro. */
import { createHash } from "node:crypto";
import { AppError } from "../../src/errors";
import { MIME, contentDispositionAttachment, detectarTipo, nombreSeguro, validarArchivo } from "../../src/storage/archivo";
import { TAMANO_MAXIMO } from "../../src/storage/limites";
import { nombreDeArchivo } from "../../src/modules/documentos/subida";
import { docxMuestra, ejecutableDisfrazado, jpgMuestra, pdfMuestra, pngMuestra, xlsxMuestra } from "../soporte/muestras";
import { crearZip } from "../soporte/zip";

/** Ejecuta `fn` y devuelve el AppError que lanza (falla la prueba si no lanza o lanza otra cosa). */
function error(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("Se esperaba un AppError y no se lanzó nada");
}

describe("detectarTipo · por el contenido (firma)", () => {
  test.each([
    ["PDF", pdfMuestra(), "pdf"],
    ["PNG", pngMuestra(), "png"],
    ["JPG", jpgMuestra(), "jpg"],
    ["DOCX", docxMuestra(), "docx"],
    ["XLSX", xlsxMuestra(), "xlsx"],
  ])("%s", (_nombre, contenido, esperado) => {
    expect(detectarTipo(contenido)).toBe(esperado);
  });

  test.each([
    ["texto plano", Buffer.from("hola mundo")],
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["SVG (puede llevar scripts)", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["GIF", Buffer.from("GIF89a\x01\x00\x01\x00")],
    ["ejecutable de Windows (MZ)", ejecutableDisfrazado()],
    ["ejecutable de Linux (ELF)", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])],
    ["script de shell", Buffer.from("#!/bin/sh\nrm -rf /\n")],
    ["vacío", Buffer.alloc(0)],
    ["un solo byte", Buffer.from([0x25])],
    ["PDF con basura delante (la firma debe estar al inicio)", Buffer.concat([Buffer.from(" "), pdfMuestra()])],
    ["ZIP vacío", Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])],
  ])("rechaza: %s", (_nombre, contenido) => {
    expect(detectarTipo(contenido)).toBeNull();
  });
});

describe("detectarTipo · DOCX y XLSX (ZIP con partes conocidas)", () => {
  const tipos = "[Content_Types].xml";

  test("un ZIP cualquiera NO es un documento de Office", () => {
    expect(detectarTipo(crearZip(["a.txt", "b.txt"]))).toBeNull();
  });
  test("sin [Content_Types].xml no es Office", () => {
    expect(detectarTipo(crearZip(["word/document.xml"]))).toBeNull();
  });
  test("con partes de Word Y de Excel es ambiguo: se rechaza", () => {
    expect(detectarTipo(crearZip([tipos, "word/document.xml", "xl/workbook.xml"]))).toBeNull();
  });
  test("Office con muchas entradas y un comentario largo en el ZIP sigue siendo válido", () => {
    const zip = crearZip([tipos, ...Array.from({ length: 300 }, (_, i) => `word/media/img${i}.png`), "word/document.xml"], {
      comentario: "x".repeat(2000),
    });
    expect(detectarTipo(zip)).toBe("docx");
  });
  test("ZIP64 no se soporta (un Office normal de <=10 MB no lo necesita)", () => {
    expect(detectarTipo(crearZip([tipos, "word/document.xml"], { zip64: true }))).toBeNull();
  });
  test("directorio central que apunta fuera del archivo", () => {
    expect(detectarTipo(crearZip([tipos, "word/document.xml"], { desplazamientoDirectorio: 999_999 }))).toBeNull();
  });
  test("el EOCD declara más entradas de las que hay", () => {
    expect(detectarTipo(crearZip([tipos, "word/document.xml"], { entradasDeclaradas: 50 }))).toBeNull();
  });
  test("el EOCD declara una cantidad absurda de entradas", () => {
    expect(detectarTipo(crearZip([tipos, "word/document.xml"], { entradasDeclaradas: 60_000 }))).toBeNull();
  });
  test("archivo truncado", () => {
    const zip = docxMuestra();
    expect(detectarTipo(zip.subarray(0, zip.length - 10))).toBeNull();
    expect(detectarTipo(zip.subarray(0, 30))).toBeNull();
  });

  test("FUZZ: ningún archivo que empiece por PK\\x03\\x04 provoca una excepción ni cuelga el proceso", () => {
    // Generador pseudoaleatorio con semilla fija: la prueba es reproducible
    let semilla = 123456789;
    const azar = () => (semilla = (semilla * 1664525 + 1013904223) >>> 0) / 0x100000000;
    const inicio = Date.now();

    for (let i = 0; i < 3000; i++) {
      const largo = Math.floor(azar() * 400);
      const aleatorio = Buffer.from(Array.from({ length: largo }, () => Math.floor(azar() * 256)));
      expect(() => detectarTipo(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), aleatorio]))).not.toThrow();

      // Un DOCX válido con bytes cambiados al azar (incluidos los del directorio central y el EOCD)
      const roto = Buffer.from(docxMuestra());
      for (let k = 0; k < 1 + Math.floor(azar() * 6); k++) roto[Math.floor(azar() * roto.length)] = Math.floor(azar() * 256);
      expect(() => detectarTipo(roto)).not.toThrow();
    }
    expect(Date.now() - inicio).toBeLessThan(5000);
  });
});

describe("validarArchivo", () => {
  test("PDF válido: tipo, MIME detectado, nombre, tamaño y SHA-256", () => {
    const contenido = pdfMuestra();
    const r = validarArchivo("informe.pdf", contenido);
    expect(r).toEqual({
      extension: "pdf",
      mime: "application/pdf",
      nombre: "informe.pdf",
      tamano: contenido.length,
      sha256: createHash("sha256").update(contenido).digest("hex"),
    });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("el SHA-256 cambia si cambia un solo byte", () => {
    const a = pdfMuestra("uno");
    const b = pdfMuestra("dos");
    expect(validarArchivo("a.pdf", a).sha256).not.toBe(validarArchivo("a.pdf", b).sha256);
  });

  test.each([
    ["foto.png", pngMuestra(), "image/png"],
    ["foto.jpg", jpgMuestra(), "image/jpeg"],
    ["foto.jpeg", jpgMuestra(), "image/jpeg"],
    ["FOTO.JPG", jpgMuestra(), "image/jpeg"],
    ["hoja.xlsx", xlsxMuestra(), MIME.xlsx],
    ["carta.docx", docxMuestra(), MIME.docx],
  ])("acepta %s", (nombre, contenido, mime) => {
    expect(validarArchivo(nombre, contenido).mime).toBe(mime);
  });

  test("guarda con la extensión REAL: .jpeg pasa a .jpg", () => {
    expect(validarArchivo("vacaciones.jpeg", jpgMuestra()).nombre).toBe("vacaciones.jpg");
  });

  test("un ejecutable renombrado a .pdf se rechaza (415)", () => {
    const e = error(() => validarArchivo("factura.pdf", ejecutableDisfrazado()));
    expect(e.status).toBe(415);
    expect(e.codigo).toBe("TIPO_NO_PERMITIDO");
  });

  test.each([
    ["contenido PNG con nombre .pdf", "imagen.pdf", pngMuestra(), /PNG/],
    ["contenido PDF con nombre .png", "doc.png", pdfMuestra(), /PDF/],
    ["contenido DOCX con nombre .xlsx", "hoja.xlsx", docxMuestra(), /DOCX/],
    ["sin extensión", "archivo", pdfMuestra(), /ninguna/],
    ["extensión doble engañosa", "informe.pdf.exe", pdfMuestra(), /\.exe/],
  ])("extensión que no coincide con el contenido (415): %s", (_caso, nombre, contenido, mensaje) => {
    const e = error(() => validarArchivo(nombre, contenido));
    expect(e.status).toBe(415);
    expect(e.message).toMatch(mensaje);
  });

  test.each([
    ["texto", "nota.txt", Buffer.from("hola")],
    ["HTML", "pagina.html", Buffer.from("<html></html>")],
    ["SVG", "logo.svg", Buffer.from("<svg></svg>")],
  ])("tipo no permitido (415): %s", (_caso, nombre, contenido) => {
    expect(error(() => validarArchivo(nombre, contenido)).status).toBe(415);
  });

  test("archivo vacío (400)", () => {
    expect(error(() => validarArchivo("vacio.pdf", Buffer.alloc(0))).status).toBe(400);
  });

  test("más de 10 MB (413) y justo 10 MB sí pasa", () => {
    const relleno = (tamano: number) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(tamano - 9)]);
    expect(error(() => validarArchivo("grande.pdf", relleno(TAMANO_MAXIMO + 1))).status).toBe(413);
    expect(validarArchivo("justo.pdf", relleno(TAMANO_MAXIMO)).tamano).toBe(TAMANO_MAXIMO);
  });
});

describe("nombreSeguro", () => {
  test.each([
    ["../../etc/passwd.pdf", "passwd.pdf"],
    ["..\\..\\Windows\\System32\\x.pdf", "x.pdf"],
    ["C:\\Users\\ronny\\informe.pdf", "informe.pdf"],
    ["/var/www/informe.pdf", "informe.pdf"],
  ])("sin carpetas: %s", (entrada, esperado) => {
    expect(nombreSeguro(entrada, "pdf")).toBe(esperado);
  });

  test("los saltos de línea y caracteres de control no llegan a los headers (inyección de headers)", () => {
    const n = nombreSeguro("a\r\nSet-Cookie: robada=1\r\n.pdf", "pdf");
    expect(n).not.toMatch(/[\r\n\u0000-\u001f]/);
  });

  test("comillas y caracteres reservados se reemplazan", () => {
    expect(nombreSeguro('inf"orme*<>|?.pdf', "pdf")).toBe("inf_orme_____.pdf");
  });

  test("conserva tildes y eñes", () => {
    expect(nombreSeguro("Informe ñandú año 2026.pdf", "pdf")).toBe("Informe ñandú año 2026.pdf");
  });

  test("nombres larguísimos se recortan (120 caracteres + extensión)", () => {
    const n = nombreSeguro(`${"a".repeat(500)}.pdf`, "pdf");
    expect(n).toHaveLength(120 + ".pdf".length);
  });

  test.each([".pdf", "...pdf", "   .pdf", "..", ""])("sin nombre útil (%j) -> documento", (entrada) => {
    expect(nombreSeguro(entrada, "pdf")).toBe("documento.pdf");
  });
});

describe("contentDispositionAttachment", () => {
  test("nombre ASCII: las dos formas coinciden", () => {
    expect(contentDispositionAttachment("informe.pdf")).toBe(`attachment; filename="informe.pdf"; filename*=UTF-8''informe.pdf`);
  });

  test("con tildes: respaldo ASCII + UTF-8 con porcentajes (RFC 6266)", () => {
    expect(contentDispositionAttachment("Informe ñandú.pdf")).toBe(
      `attachment; filename="Informe _and_.pdf"; filename*=UTF-8''Informe%20%C3%B1and%C3%BA.pdf`,
    );
  });

  test("los caracteres que la RFC 5987 no admite sin escapar se codifican (' ( ) *)", () => {
    expect(contentDispositionAttachment("a(1)'*.pdf")).toContain(`filename*=UTF-8''a%281%29%27%2A.pdf`);
  });

  test("aunque le llegue un nombre hostil, nunca emite saltos de línea ni comillas sueltas", () => {
    const h = contentDispositionAttachment('a"\r\nSet-Cookie: x=1\r\n.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.match(/"/g)).toHaveLength(2); // solo las comillas que envuelven filename
  });

  test("siempre es un adjunto (nunca 'inline')", () => {
    expect(contentDispositionAttachment("x.png")).toMatch(/^attachment;/);
  });
});

describe("nombreDeArchivo (multer lee UTF-8 como latin1)", () => {
  test("recompone las tildes", () => {
    expect(nombreDeArchivo("Informe Ã±andÃº.pdf")).toBe("Informe ñandú.pdf");
  });
  test("un nombre ASCII no cambia", () => {
    expect(nombreDeArchivo("informe.pdf")).toBe("informe.pdf");
  });
  test("si no es UTF-8 válido se deja tal cual", () => {
    expect(nombreDeArchivo("caf\u00e9.pdf")).toBe("caf\u00e9.pdf");
  });
});
