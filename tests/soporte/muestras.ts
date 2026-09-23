/** Archivos de muestra válidos, fabricados en memoria (los usan las pruebas y `tests/fixtures/generar.ts`). */
import { crc32, deflateSync } from "node:zlib";
import { crearZip } from "./zip";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function pdfMuestra(texto = "SecureDocs"): Buffer {
  const flujo = `BT /F1 18 Tf 20 50 Td (${texto}) Tj ET`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objetos.forEach((cuerpo, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function chunkPng(tipo: string, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(4);
  cabecera.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo) >>> 0);
  return Buffer.concat([cabecera, cuerpo, crc]);
}

/** PNG de 16x16 (un cuadrado del color pedido), válido. */
export function pngMuestra(rgb: [number, number, number] = [200, 30, 30]): Buffer {
  const lado = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, sin interlace
  const fila = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: lado }, () => rgb).flat())]);
  const crudo = Buffer.concat(Array.from({ length: lado }, () => fila));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", deflateSync(crudo)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

/** JPEG de 1x1 píxel (el mínimo conocido). */
export function jpgMuestra(): Buffer {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    "base64",
  );
}

export function docxMuestra(texto = "SecureDocs: documento de muestra"): Buffer {
  return crearZip([
    {
      nombre: "[Content_Types].xml",
      contenido: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      nombre: "_rels/.rels",
      contenido: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      nombre: "word/document.xml",
      contenido: `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p></w:body></w:document>`,
    },
  ]);
}

export function xlsxMuestra(texto = "SecureDocs"): Buffer {
  return crearZip([
    {
      nombre: "[Content_Types].xml",
      contenido: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      nombre: "_rels/.rels",
      contenido: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: "xl/workbook.xml",
      contenido: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      contenido: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      nombre: "xl/worksheets/sheet1.xml",
      contenido: `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${texto}</t></is></c></row></sheetData></worksheet>`,
    },
  ]);
}

/** Un "ejecutable" (cabecera MZ de Windows): lo que un atacante renombraría a .pdf. */
export function ejecutableDisfrazado(): Buffer {
  return Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62), Buffer.from("This program cannot be run in DOS mode.")]);
}
