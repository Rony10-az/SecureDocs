import express from "express";
import helmet from "helmet";
import path from "node:path";
import { prisma } from "./db";

export const app = express();

app.use(helmet());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ estado: "ok", bd: "ok" });
});
