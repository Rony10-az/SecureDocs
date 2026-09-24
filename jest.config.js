/**
 * Dos proyectos:
 *  - unit:        pruebas sin infraestructura (motor, esquemas, validación de archivos...). No necesitan Docker.
 *  - integracion: la API real (Supertest) con PostgreSQL y MinIO reales, incluidos los 17 casos de la guía.
 *                 Necesitan `docker compose up -d` y la base de datos sembrada (`npm run db:seed`).
 *
 * @type {import('jest').Config}
 */
const base = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: {
    "^.+[.]ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
};

module.exports = {
  // Con `projects`, Jest solo imprime una línea por prueba si el reporter se pide de forma explícita. Va aquí y no como
  // opción de la línea de comandos porque `--reporters` es una lista y se tragaría el filtro: npm run test:unit -- archivo
  reporters: ["default"],
  // Cobertura (npm run test:cobertura): todo `src/` salvo el arranque del servidor, que solo abre el puerto
  collectCoverageFrom: ["src/**/*.ts", "!src/server.ts"],
  coverageDirectory: "coverage",
  projects: [
    {
      ...base,
      displayName: "unit",
      roots: ["<rootDir>/tests/unit"],
      testMatch: ["**/*.test.ts"],
    },
    {
      ...base,
      displayName: "integracion",
      roots: ["<rootDir>/tests/integracion"],
      testMatch: ["**/*.test.ts"],
      setupFilesAfterEnv: ["<rootDir>/tests/integracion/setup.ts"],
    },
  ],
};
