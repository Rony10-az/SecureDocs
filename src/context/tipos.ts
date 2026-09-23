import type { EstadoUsuario, TipoContrato } from "@prisma/client";

/** Atributos del usuario que ven las políticas ABAC (rutas `usuario.*`). */
export interface UsuarioCtx {
  id: number;
  nombre: string;
  correo: string;
  rol: string;
  departamento: string;
  nivel_seguridad: number;
  pais: string;
  tipo_contrato: TipoContrato;
  estado: EstadoUsuario;
  /** "YYYY-MM-DD" o null. Va como texto para poder compararla con `entorno.fecha`. */
  fecha_expiracion: string | null;
}

export type Dispositivo = "CORPORATIVO" | "PERSONAL" | "DESCONOCIDO";

/** Atributos del entorno de la petición (rutas `entorno.*`). */
export interface EntornoCtx {
  /** "HH:mm" en la zona horaria de la empresa */
  hora: string;
  /** "YYYY-MM-DD" en la zona horaria de la empresa */
  fecha: string;
  /** País desde el que se accede (header X-Ubicacion); null si no se informó */
  ubicacion: string | null;
  dispositivo: Dispositivo;
  direccion_ip: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Lo pone `authenticate`. */
      usuario?: UsuarioCtx;
      /** Lo pone `contextoEntorno` (se monta para todas las rutas de la API). */
      entorno: EntornoCtx;
    }
  }
}
