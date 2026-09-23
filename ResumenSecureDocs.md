# SecureDocs — TechCorp S.A.

Laboratorio 06 · Cloud Security (TECSUP) · Autor: Rony Quintana (trabajo individual)
Entrega: **hoy mismo**. Guía original: `GLAB-S06-JFARFAN-2026-02.docx`.

## Modo de trabajo (IMPORTANTE)

- Responde **en español**, claro y conciso, con tablas cuando ayuden.
- Rony usa este proyecto también para **aprender**: antes de cada archivo explica en 2-3 líneas **qué hace y por qué**; después de cada bloque, resume lo aprendido y cómo probarlo.
- Avanza **bloque por bloque** (ver Plan). No saltes al siguiente sin que Rony confirme que el anterior funciona.
- Commits pequeños por bloque con mensajes en español.

## 1. Contexto y problemas

TechCorp comparte documentos por carpetas y enlaces. Problemas:

1. Acceso a documentos de otras áreas → **P1 (departamento)**
2. Empleados modifican lo que solo deberían consultar → **RBAC + P3 (propiedad)**
3. Confidenciales accesibles desde ubicaciones no autorizadas → **P4, P5, P6 (entorno)**
4. Personal externo sin control → **P8, P9 (invitado / expiración)**
5. Sin trazabilidad → **Auditoría** (no la resuelve RBAC ni ABAC)

Objetivo: RBAC responde *¿qué puede hacer por su rol?*; ABAC responde *¿puede hacerlo en estas condiciones?*

## 2. Stack (decidido)

| Capa | Herramienta |
|---|---|
| Backend | Node.js + TypeScript + Express |
| Validación | zod |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` |
| BD | PostgreSQL 16 + Prisma ORM |
| Archivos | MinIO (S3 compatible), bucket **privado** |
| Frontend | HTML + Bootstrap servido por la misma API (sin React) |
| Pruebas | Jest + Supertest |
| Despliegue | Docker Compose: `api`, `postgres`, `minio` (+ init del bucket) |

Postgres y MinIO **no se exponen** fuera de la red de Docker (solo la API los alcanza; en desarrollo se puede exponer el puerto localmente).

## 3. Regla de oro — Sección 16 de la guía

**Prohibido** resolver la autorización con `if (user.rol === "ADMIN")` repartidos por el código.
- RBAC: permisos leídos desde la BD (`rol_permiso`).
- ABAC: políticas guardadas en la tabla `politica` con condición en **JSONB**; un **motor** genérico las evalúa.
- Componentes independientes: `auth/`, `authorization/rbac/`, `authorization/abac/`, `audit/`.
- Los controladores solo llaman a un middleware `authorize(accion, cargarRecurso?)`.

## 4. Flujo de autorización

```
1. P7: usuario.estado == ACTIVO (y no expirado, P9)  → si no, DENEGAR
2. RBAC: rol tiene permiso para la acción            → si no, DENEGAR ("Denegado por RBAC")
3. ABAC: todas las políticas activas aplicables (AND) → si una falla, DENEGAR con su motivo
4. PERMITIR
5. SIEMPRE registrar en auditoría (permitido o denegado) con motivo
```
Denegar por defecto. La respuesta de denegación indica `etapa` (ESTADO / RBAC / ABAC), `politica` y `motivo`.

## 5. Roles y matriz RBAC

Acciones: `DOC_CREATE, DOC_READ, DOC_UPDATE, DOC_DELETE, DOC_APPROVE, DOC_DOWNLOAD, AUDIT_READ, USER_MANAGE, ROLE_ASSIGN`

| Acción | ADMIN | GERENTE | SUPERVISOR | EMPLEADO | AUDITOR | INVITADO |
|---|---|---|---|---|---|---|
| DOC_CREATE | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| DOC_READ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DOC_UPDATE | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| DOC_DELETE | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| DOC_APPROVE | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| DOC_DOWNLOAD ⭐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| AUDIT_READ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| USER_MANAGE | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| ROLE_ASSIGN | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

⭐ = agregado por el grupo (la guía no la incluye). Un usuario tiene **un solo rol**.

## 6. Matriz de políticas ABAC

Escala de confidencialidad y nivel de seguridad: **1 a 5**.
Estados del documento: `BORRADOR → PENDIENTE → PUBLICADO | RECHAZADO` (+ `eliminado_en` = papelera, borrado lógico).

| # | Política | Condición | Acciones | Exceptuados | Motivo |
|---|---|---|---|---|---|
| P7 | Estado usuario | `usuario.estado == ACTIVO` | todas (antes de RBAC) | — | Usuario inactivo o suspendido |
| P1 | Departamento | `usuario.departamento == doc.departamento` | todas sobre documentos | ADMIN, AUDITOR (depto GLOBAL), INVITADO (lo rige P8) | Documento de otro departamento |
| P2 | Nivel | `usuario.nivel_seguridad >= doc.nivel_confidencialidad` | todas sobre documentos | — | Nivel de seguridad insuficiente |
| P3 | Propiedad | `usuario.id == doc.propietario` | DOC_UPDATE | GERENTE, ADMIN | Solo puede modificar sus propios documentos |
| P4 | Horario | si `doc.nivel >= 4` → `08:00 <= hora < 18:00` | todas sobre documentos | — | Fuera del horario autorizado |
| P5 | País | `entorno.ubicacion == doc.pais` | todas sobre documentos | — | Acceso desde país no autorizado |
| P6 | Dispositivo | si `doc.nivel >= 4` → `entorno.dispositivo == CORPORATIVO` | todas sobre documentos | — | Requiere dispositivo corporativo |
| P8 | Invitado | si rol INVITADO → `tipo_contrato == EXTERNO AND doc.nivel <= 1 AND doc.estado == PUBLICADO` | DOC_READ | — | Invitado solo accede a documentos públicos publicados |
| P9 ⭐ | Expiración | si `tipo_contrato == EXTERNO` → `hoy <= usuario.fecha_expiracion` | todas | — | Acceso temporal vencido |
| P10 ⭐ | Autoaprobación | `usuario.id != doc.propietario` | DOC_APPROVE | — | No puede aprobar su propio documento |

### Supuestos de interpretación (van al README)

- **P6**: la fórmula de la guía (`nivel>=4 AND dispositivo==CORPORATIVO`) se interpreta como implicación (si nivel ≥ 4 ⇒ corporativo); leída literal negaría todo documento < 4.
- **P5**: la guía dice "consultar desde Perú" pero compara `usuario.pais`; se usa `entorno.ubicacion == documento.pais`.
- **P1**: se aplica a todas las operaciones y roles (el caso 9 la usa para modificar), salvo ADMIN/AUDITOR (GLOBAL) e INVITADO.
- **Caso 9**: "confidencial" se prueba con documento nivel ≥ 4 (P4 aplica desde 4).
- **Supervisor**: no está exceptuado de P3 → solo modifica lo suyo, pero aprueba documentos ajenos.

### Formato sugerido de política en BD (JSONB)

```json
{
  "codigo": "P4",
  "acciones": ["DOC_READ","DOC_UPDATE","DOC_DELETE","DOC_APPROVE","DOC_DOWNLOAD"],
  "condicion": {
    "si": { "recurso.nivel_confidencialidad": { "gte": 4 } },
    "entonces": { "entorno.hora": { "between": ["08:00", "18:00"] } }
  },
  "roles_exceptuados": [],
  "motivo_denegacion": "Fuera del horario autorizado",
  "activa": true
}
```
Operadores mínimos del motor: `eq, neq, gte, lte, between, in`, comparación contra otro atributo (`{ "eqAttr": "recurso.departamento" }`), y bloques `si/entonces`, `all`, `any`.

## 7. Atributos de entorno (simulados para pruebas)

- `hora` / `fecha`: reloj inyectable (servicio `clock`) + header `X-Hora` **solo si `NODE_ENV != production`**.
- `ubicacion`: header `X-Ubicacion` (ej. `PERU`, `CHILE`).
- `dispositivo`: header `X-Dispositivo` (`CORPORATIVO` / `PERSONAL`).
- `direccion_ip`: `req.ip` (se guarda en auditoría).

## 8. Modelo de datos (Prisma)

- **departamento**: id, codigo (FINANZAS, RRHH, LEGAL, TI, OPERACIONES, GLOBAL), nombre
- **rol**: id, nombre
- **permiso**: id, codigo
- **rol_permiso**: rol_id, permiso_id (PK compuesta) ← matriz RBAC
- **usuario**: id, nombre, correo (único), password_hash, rol_id, departamento_id, nivel_seguridad (1-5), pais, tipo_contrato (INTERNO/EXTERNO), estado (ACTIVO/INACTIVO/SUSPENDIDO), fecha_expiracion?, creado_en
- **documento**: id, titulo, descripcion, propietario_id, departamento_id, nivel_confidencialidad (1-5), estado, pais, fecha_creacion, aprobado_por?, fecha_aprobacion?, eliminado_en?, archivo_clave (UUID), archivo_nombre_original, archivo_mime, archivo_tamano, archivo_sha256
- **politica**: id, codigo, nombre, descripcion, acciones (text[]), condicion (Json), roles_exceptuados (text[]), motivo_denegacion, activa
- **auditoria**: id (bigint), usuario_id?, usuario_correo, recurso, accion, resultado (PERMITIDO/DENEGADO), etapa, politica_codigo?, motivo, ip, ubicacion, dispositivo, fecha

**Auditoría inmutable**: migración SQL con trigger que lanza error en `UPDATE`/`DELETE` sobre `auditoria` (+ el usuario de la app sin esos privilegios si da el tiempo).

**Seed**: 6 roles, 9 permisos, matriz RBAC, 6 departamentos, políticas P1–P10, y usuarios de prueba (uno por rol, uno INACTIVO, un invitado vencido, empleados de FINANZAS y RRHH, niveles variados) + documentos de niveles 1–5 en distintos departamentos y estados. Contraseña común de prueba: `Secure123!`.

## 9. Archivos (MinIO)

1. **Sin enlaces públicos ni URLs firmadas**: el archivo solo sale por `GET /documentos/:id/archivo`, que pasa por RBAC + ABAC y lo transmite (stream) desde MinIO.
2. Se guarda con nombre **UUID** (evita colisiones y path traversal).
3. Solo PDF, DOCX, XLSX, PNG, JPG; máx **10 MB**; validar tipo real por *magic bytes* (`file-type`), no solo extensión.
4. Hash **SHA-256** al subir (integridad).
5. Cada descarga se audita (acción `DOC_DOWNLOAD`).

Plan B: si MinIO se complica > 45 min, volumen local con la misma interfaz (`StorageService`).

## 10. API

```
POST   /auth/login
GET    /auth/me
GET    /usuarios              (USER_MANAGE)
POST   /usuarios              (USER_MANAGE)
PUT    /usuarios/:id          (USER_MANAGE; ROLE_ASSIGN si cambia rol; nadie cambia su propio rol)
GET    /documentos            (lista filtrada: solo los que ABAC permite leer)
GET    /documentos/:id
POST   /documentos            (multipart: metadatos + archivo)
PUT    /documentos/:id        (puede reemplazar archivo)
DELETE /documentos/:id        (borrado lógico)
POST   /documentos/:id/aprobar
GET    /documentos/:id/archivo
GET    /auditoria             (AUDIT_READ; GERENTE solo ve su departamento)
```

## 11. Casos de prueba (Jest + Supertest)

| # | Escenario | Esperado |
|---|---|---|
| 1 | Empleado consulta documento de su área | Permitido |
| 2 | Empleado consulta documento de otra área | Denegado (P1) |
| 3 | Supervisor aprueba documento de su área (ajeno) | Permitido |
| 4 | Empleado intenta aprobar | Denegado por RBAC |
| 5 | Usuario nivel 2 consulta documento nivel 4 | Denegado (P2) |
| 6 | Gerente elimina documento de su área | Permitido |
| 7 | Auditor intenta modificar | Denegado por RBAC |
| 8 | Usuario inactivo intenta acceder | Denegado (P7) |
| 9 | Documento nivel ≥4 accedido fuera de horario (X-Hora 20:00) | Denegado (P4) |
| 10 | Documento nivel 5 desde dispositivo PERSONAL | Denegado (P6) |
| 11 | Invitado accede a documento nivel 1 PUBLICADO | Permitido |
| 12 | Invitado accede a documento confidencial | Denegado (P8) |
| 13 ⭐ | Supervisor aprueba su propio documento | Denegado (P10) |
| 14 ⭐ | Invitado con fecha_expiracion vencida | Denegado (P9) |
| 15 ⭐ | Empleado consulta desde CHILE documento de PERU | Denegado (P5) |
| 16 ⭐ | Empleado modifica documento de un compañero de su área | Denegado (P3) |
| 17 ⭐ | Gerente modifica documento de un empleado de su área | Permitido (excepción P3) |

Cada prueba verifica además que se creó el registro de auditoría con el motivo correcto.

## 12. Estructura sugerida

```
securedocs/
├─ docker-compose.yml   .env.example   README.md   CLAUDE.md
├─ prisma/  schema.prisma  seed.ts  migrations/
├─ public/  (frontend HTML + Bootstrap)
├─ src/
│  ├─ app.ts  server.ts  config.ts
│  ├─ auth/            (login, JWT, middleware authenticate)
│  ├─ context/         (construye usuario + entorno; clock)
│  ├─ authorization/
│  │  ├─ rbac/         (RbacService: permisos desde BD)
│  │  ├─ abac/         (PolicyEngine + evaluador de condiciones JSON)
│  │  └─ authorize.ts  (middleware: P7 → RBAC → ABAC → audit)
│  ├─ audit/           (AuditService)
│  ├─ storage/         (StorageService: MinIO / local)
│  ├─ modules/documentos/  modules/usuarios/  modules/auditoria/
│  └─ errors.ts
└─ tests/  (17 casos)
```

## 13. Plan por bloques

| # | Bloque | Listo cuando… |
|---|---|---|
| 1 | Estructura, Docker Compose, Prisma, trigger de auditoría, seed | `docker compose up` + `prisma migrate` + seed sin errores |
| 2 | Login JWT + middleware de contexto | `POST /auth/login` devuelve token; `/auth/me` responde |
| 3 | **RBAC + motor ABAC + auditoría** | Pruebas unitarias del motor con P1–P10 pasan |
| 4 | Documentos (CRUD, aprobar) + MinIO | Subir / descargar funciona con autorización |
| 5 | Usuarios | CRUD con USER_MANAGE / ROLE_ASSIGN |
| 6 | 17 casos Jest | Todos en verde; captura como evidencia |
| 7 | Frontend mínimo | Login, lista, subir, aprobar, ver auditoría |
| 8 | Entregables | README, diagrama arquitectura, modelo BD, matrices, evidencias, video |

## 14. Entregables (sección 17 de la guía)

Código · Repo Git · README (instalación + supuestos de interpretación) · Diagrama de arquitectura · Modelo de BD · Matriz RBAC · Matriz ABAC · Evidencias de pruebas · Registro de auditoría · Video demo.

## 15. Fuera de alcance (README → "Trabajo futuro")

MFA para Administrador · Edición de documentos ajenos con aprobación · Frontend en React · Migración a AWS S3 (solo cambiar configuración del StorageService).
