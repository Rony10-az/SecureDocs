import express from "express";
import helmet from "helmet";
import path from "node:path";
import { authRouter } from "./auth/auth.routes";
import { contextoEntorno } from "./context/entorno";
import { prisma } from "./db";
import { manejadorErrores, rutaNoEncontrada } from "./errors";
import { auditoriaRouter } from "./modules/auditoria/auditoria.routes";
import { documentosRouter } from "./modules/documentos/documentos.routes";

export const app = express();

app.use(helmet());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ estado: "ok", bd: "ok" });
});

// Desde aquí toda petición lleva el contexto de entorno (hora, ubicación, dispositivo, IP)
app.use(contextoEntorno);
app.use("/auth", authRouter);
app.use("/auditoria", auditoriaRouter);
app.use("/documentos", documentosRouter);

// Siempre al final: ruta inexistente -> 404 JSON; cualquier error -> respuesta uniforme
app.use(rutaNoEncontrada);
app.use(manejadorErrores);
