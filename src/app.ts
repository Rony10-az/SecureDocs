import express from "express";
import helmet from "helmet";
import path from "node:path";
import { authRouter } from "./auth/auth.routes";
import { config } from "./config";
import { contextoEntorno } from "./context/entorno";
import { prisma } from "./db";
import { manejadorErrores, rutaNoEncontrada } from "./errors";
import { auditoriaRouter } from "./modules/auditoria/auditoria.routes";
import { documentosRouter } from "./modules/documentos/documentos.routes";
import { usuariosRouter } from "./modules/usuarios/usuarios.routes";

export const app = express();

const raiz = path.join(__dirname, "..");

app.use(helmet());
app.use(express.json());

// Frontend (Bloque 7): archivos estáticos, sin sesión y fuera de la auditoría (no son acciones sobre recursos).
// Todo sale del mismo origen porque la CSP de helmet no admite scripts ni estilos de otros sitios: por eso
// Bootstrap (solo su CSS) se sirve desde node_modules y no desde un CDN.
app.use(express.static(path.join(raiz, "public")));
app.use("/vendor/bootstrap", express.static(path.join(raiz, "node_modules", "bootstrap", "dist", "css")));
// Solo laboratorio: usuarios de demostración para el formulario de login. En producción esta carpeta NO se sirve.
if (config.NODE_ENV !== "production") app.use("/demo", express.static(path.join(raiz, "demo")));

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ estado: "ok", bd: "ok" });
});

// Desde aquí toda petición lleva el contexto de entorno (hora, ubicación, dispositivo, IP)
app.use(contextoEntorno);
app.use("/auth", authRouter);
app.use("/auditoria", auditoriaRouter);
app.use("/documentos", documentosRouter);
app.use("/usuarios", usuariosRouter);

// Siempre al final: ruta inexistente -> 404 JSON; cualquier error -> respuesta uniforme
app.use(rutaNoEncontrada);
app.use(manejadorErrores);
