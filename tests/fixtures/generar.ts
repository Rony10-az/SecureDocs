/**
 * Genera los archivos de muestra que usa la colección de Postman (http/) para subir documentos.
 * Se pueden regenerar cuando se quiera:  npx tsx tests/fixtures/generar.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { docxMuestra, ejecutableDisfrazado, jpgMuestra, pdfMuestra, pngMuestra, xlsxMuestra } from "../soporte/muestras";

const archivos: Record<string, Buffer> = {
  // --- válidos ---
  "muestra.pdf": pdfMuestra("SecureDocs muestra"),
  "muestra.png": pngMuestra(),
  "muestra.jpg": jpgMuestra(),
  "muestra.docx": docxMuestra(),
  "muestra.xlsx": xlsxMuestra(),
  // --- deben ser RECHAZADOS (415) ---
  "falso.pdf": ejecutableDisfrazado(), // un ejecutable de Windows renombrado a .pdf
  "imagen-disfrazada.pdf": pngMuestra(), // una imagen PNG con extensión .pdf
  "nota.txt": Buffer.from("Un archivo de texto no es un tipo permitido.\n"),
};

for (const [nombre, contenido] of Object.entries(archivos)) {
  writeFileSync(join(__dirname, nombre), contenido);
  console.log(`${nombre.padEnd(24)} ${String(contenido.length).padStart(6)} bytes`);
}
