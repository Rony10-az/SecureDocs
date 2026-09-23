// Las pruebas de integración usan bcrypt, PostgreSQL y MinIO de verdad: el tiempo por defecto (5 s) se queda corto.
jest.setTimeout(30_000);
