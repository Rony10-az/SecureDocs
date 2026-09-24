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
import { catalogosRouter, reglasRouter } from "./modules/reglas/reglas.routes";
import { usuariosRouter } from "./modules/usuarios/usuarios.routes";

export const app = express();

const raiz = path.join(__dirname, "..");

// helmet con su CSP por defecto y una sola ampliación: la vista previa de un documento pone en la página la imagen o el
// PDF que el propio navegador arma (blob:) con lo que acaba de descargar, así que img-src y frame-src admiten blob:.
// Los scripts siguen siendo solo 'self': ni en línea, ni de otros sitios, ni eval.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:"],
        "frame-src": ["'self'", "blob:"],
      },
    },
  }),
);
app.use(express.json());

// Frontend (Bloque 7): archivos estáticos, sin sesión y fuera de la auditoría (no son acciones sobre recursos).
// Todo sale del mismo origen porque la CSP de helmet no admite scripts ni estilos de otros sitios: por eso
// Bootstrap (solo su CSS) se sirve desde node_modules y no desde un CDN.
app.use(express.static(path.join(raiz, "public")));
app.use("/vendor/bootstrap", express.static(path.join(raiz, "node_modules", "bootstrap", "dist", "css")));
app.use("/vendor/bootstrap-icons", express.static(path.join(raiz, "node_modules", "bootstrap-icons", "font"))); // iconos: CSS y fuente
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
app.use("/catalogos", catalogosRouter);
app.use("/reglas", reglasRouter);
app.use("/documentos", documentosRouter);
app.use("/usuarios", usuariosRouter);

// Siempre al final: ruta inexistente -> 404 JSON; cualquier error -> respuesta uniforme
app.use(rutaNoEncontrada);
app.use(manejadorErrores);
