/** Escritor mínimo de ZIP (entradas sin comprimir) para fabricar DOCX/XLSX de prueba, válidos o manipulados. */
import { crc32 } from "node:zlib";

export interface EntradaZip {
  nombre: string;
  contenido?: Buffer | string;
}

export interface OpcionesZip {
  /** Simula ZIP64 (campos del EOCD en 0xFFFF / 0xFFFFFFFF) */
  zip64?: boolean;
  /** Pisa el desplazamiento del directorio central (para fabricar un ZIP manipulado) */
  desplazamientoDirectorio?: number;
  /** Cantidad de entradas que dice tener el EOCD (por defecto, las reales) */
  entradasDeclaradas?: number;
  comentario?: string;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

export function crearZip(entradas: Array<EntradaZip | string>, opciones: OpcionesZip = {}): Buffer {
  const lista = entradas.map((e) => (typeof e === "string" ? { nombre: e } : e));
  const locales: Buffer[] = [];
  const directorio: Buffer[] = [];
  let offset = 0;

  for (const { nombre, contenido = "" } of lista) {
    const nom = Buffer.from(nombre, "utf8");
    const datos = Buffer.from(contenido);
    const crc = crc32(datos);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21),
      u32(crc), u32(datos.length), u32(datos.length), u16(nom.length), u16(0), nom, datos,
    ]);
    directorio.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21),
        u32(crc), u32(datos.length), u32(datos.length), u16(nom.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(offset), nom,
      ]),
    );
    locales.push(local);
    offset += local.length;
  }

  const dir = Buffer.concat(directorio);
  const comentario = Buffer.from(opciones.comentario ?? "");
  const declaradas = opciones.entradasDeclaradas ?? lista.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(opciones.zip64 ? 0xffff : declaradas),
    u16(opciones.zip64 ? 0xffff : declaradas),
    u32(opciones.zip64 ? 0xffffffff : dir.length),
    u32(opciones.zip64 ? 0xffffffff : (opciones.desplazamientoDirectorio ?? offset)),
    u16(comentario.length), comentario,
  ]);
  return Buffer.concat([...locales, dir, eocd]);
}
