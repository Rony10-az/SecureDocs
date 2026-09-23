import { app } from "./app";
import { config } from "./config";
import { storage } from "./storage";

async function main() {
  // Comprueba (y si falta, crea PRIVADO) el bucket. Si MinIO no responde el servidor arranca igual:
  // el login y la auditoría funcionan y las operaciones con archivos responden 503.
  try {
    await storage.asegurarContenedor();
    console.log(`Almacenamiento listo (bucket "${config.MINIO_BUCKET}")`);
  } catch (e) {
    console.error("⚠ No se pudo verificar el bucket de MinIO; las operaciones con archivos fallarán:", (e as Error).message);
  }

  app.listen(config.PORT, () => {
    console.log(`SecureDocs API en http://localhost:${config.PORT}`);
  });
}

void main();
