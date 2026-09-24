# SecureDocs — TechCorp S.A.

**Laboratorio 06 · Cloud Security — Entregables (sección 17 de la guía)**

| Dato | Valor |
|---|---|
| Estudiante | Rony Quintana (trabajo individual) |
| Correo | rony.quintana@tecsup.edu.pe |
| Institución | TECSUP |
| Curso | Desarrollo de soluciones en la nube (5.º ciclo) |
| Repositorio | [PEGAR: URL del repositorio Git] |
| Video de demostración | [PEGAR: URL del video] |

**Resumen.** SecureDocs es una API de gestión documental para TechCorp S.A. que combina autenticación con JWT, control de acceso por roles (RBAC), control de acceso por atributos (ABAC) con políticas guardadas como datos en la base de datos, y una auditoría inmutable de cada decisión. Los archivos se guardan en MinIO y hay un frontend completo (HTML, Bootstrap y módulos ES propios) servido por la misma API.

| # | Entregable de la guía | Dónde está |
|---|---|---|
| 1 | Código fuente del proyecto y repositorio Git | Sección 1 |
| 2 | README con instrucciones de instalación (y supuestos de interpretación) | Sección 2 y `README.md` |
| 3 | Diagrama de arquitectura | Sección 3 |
| 4 | Modelo de base de datos | Sección 4 |
| 5 | Matriz de roles y permisos RBAC | Sección 5 |
| 6 | Matriz de políticas ABAC | Sección 6 |
| 7 | Evidencias de los casos de prueba | Sección 7 y `evidencias/casos-guia.md` |
| 8 | Registro de auditoría | Sección 8 |
| 9 | Video o demostración de funcionamiento | Sección 9 |

# 1. Código fuente y repositorio Git

| Dato | Valor |
|---|---|
| Repositorio | [PEGAR: URL del repositorio Git] |
| Lenguaje | TypeScript sobre Node.js 22 |
| Forma de trabajo | Individual, por bloques (infraestructura, login, autorización, documentos, usuarios, pruebas, frontend y entregables), con un commit por bloque |

## Tecnologías

| Componente | Tecnología |
|---|---|
| API | Node.js 22, TypeScript 5.9, Express 5 |
| Base de datos | PostgreSQL 16 con Prisma 6 (migraciones versionadas) |
| Almacenamiento de archivos | MinIO (compatible con S3), bucket privado |
| Autenticación | JWT (HS256, `jsonwebtoken`) y contraseñas con bcrypt (`bcryptjs`, costo 10) |
| Validación | zod 4 (`strictObject`: un campo desconocido se rechaza) |
| Seguridad HTTP | helmet 8 (CSP estricta), multer 2 para subidas |
| Frontend | HTML, Bootstrap 5.3 y Bootstrap Icons, con módulos ES propios y sin librerías de JavaScript de terceros |
| Pruebas | Jest 30, ts-jest y Supertest 7 |
| Infraestructura | Docker Compose |

## Estructura del proyecto

```text
SecureDocs/
├─ docker-compose.yml          PostgreSQL 16 + MinIO (crea el bucket privado)
├─ .env.example                variables de entorno (se copia a .env)
├─ prisma/
│  ├─ schema.prisma            modelo de datos
│  ├─ migrations/              SQL versionado (incluye el trigger de auditoría inmutable)
│  ├─ datos.ts                 roles, permisos, políticas P1–P11 y usuarios de prueba (fuente única)
│  └─ seed.ts                  siembra la base de datos a partir de datos.ts
├─ src/
│  ├─ app.ts · server.ts       Express y arranque
│  ├─ config.ts                variables de entorno validadas (falla rápido)
│  ├─ auth/                    Authentication: login, JWT, bcrypt, middleware authenticate
│  ├─ authorization/           Authorization
│  │  ├─ authorize.ts          middlewares authorize, authorizeLista y authorizeSi
│  │  ├─ autorizador.ts        orquesta ESTADO → RBAC → ABAC
│  │  ├─ rbac/                 permisos por rol (tabla rol_permiso)
│  │  └─ abac/                 motor genérico de políticas (condicion.ts, policy-engine.ts)
│  ├─ audit/                   servicio de auditoría
│  ├─ context/                 contexto de entorno (hora, ubicación, dispositivo, IP) y reloj
│  ├─ storage/                 MinIO y validación de archivos por firma
│  └─ modules/                 documentos · usuarios · auditoria · reglas (catálogos y reglas de acceso)
├─ public/                     frontend: index.html, css/ y js/ (módulos ES y una vista por pantalla)
├─ demo/usuarios.json          usuarios de demostración (solo fuera de producción)
├─ tests/                      unit/ · integracion/ · soporte/ · fixtures/
├─ http/                       colección Postman/Bruno (244 requests) y su entorno
└─ evidencias/casos-guia.md    evidencia de los 17 casos (se regenera al probar)
```

## Historial de commits

Un commit por bloque, con mensaje en español.

[PEGAR: salida del comando git log --oneline]

# 2. README con instrucciones de instalación

Este apartado reproduce el `README.md` del repositorio: instalación, uso, pruebas, supuestos de interpretación y trabajo futuro.

API de gestión documental con control de acceso **RBAC + ABAC** y **auditoría inmutable** (Laboratorio 06 · Cloud Security, TECSUP). Cada petición se autentica con JWT y cada acción la decide un motor de autorización cuyas reglas están guardadas como datos en la base de datos, no como condicionales en el código. Los archivos se guardan en MinIO y cada decisión, permitida o denegada, queda registrada.

| Capa | Qué hace |
|---|---|
| Authentication | Login con bcrypt y JWT (HS256, 1 hora); el token solo lleva el identificador del usuario |
| Authorization · RBAC | Permisos por rol leídos de la tabla `rol_permiso` |
| Authorization · ABAC | Políticas P1 a P11 en la tabla `politica` (condición JSONB) evaluadas por un motor genérico |
| Auditoría | Cada decisión queda en `auditoria`, inmutable por trigger de PostgreSQL |
| Archivos | MinIO (bucket privado), validación por firma real, nombre UUID y SHA-256 |
| Frontend | HTML + Bootstrap servido por la misma API |

## Requisitos

- Node.js 22 o superior y npm.
- Docker Desktop (PostgreSQL 16 y MinIO).
- Para regenerar los diagramas (opcional): Microsoft Edge o Google Chrome y conexión a internet.

## Instalación

```bash
git clone <URL-del-repositorio> SecureDocs
cd SecureDocs
npm install
cp .env.example .env          # en PowerShell: Copy-Item .env.example .env
docker compose up -d          # PostgreSQL (puerto 5434) y MinIO (9000; consola en 9001)
npx prisma migrate deploy     # crea las tablas y el trigger de auditoría inmutable
npm run db:seed               # roles, permisos, políticas, usuarios y documentos de prueba
npm run dev                   # API y frontend en http://localhost:3000
```

Para comprobar que todo responde, abrir `http://localhost:3000/health`: debe devolver `{"estado":"ok","bd":"ok"}`. Después, entrar a `http://localhost:3000` y elegir un usuario de demostración.

Para producción: `npm run build` y `npm start`. Con `NODE_ENV=production` la aplicación no arranca si `JWT_SECRET` conserva el valor de ejemplo, ignora la cabecera `X-Hora` y no sirve la carpeta `/demo`.

## Variables de entorno

Se copian de `.env.example` a `.env` (que Git ignora).

| Variable | Para qué sirve | Valor de ejemplo |
|---|---|---|
| `NODE_ENV` | `development`, `test` o `production` | `development` |
| `PORT` | Puerto de la API | `3000` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credenciales con las que Docker crea la base de datos | `securedocs` |
| `DATABASE_URL` | Conexión de Prisma (puerto del host: 5434) | `postgresql://securedocs:securedocs_dev@localhost:5434/securedocs?schema=public` |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Firma del token (mínimo 16 caracteres) y su duración | `1h` |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Credenciales de MinIO | `minioadmin` |
| `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_BUCKET` | Dónde está MinIO y cómo se llama el bucket privado | `localhost`, `9000`, `false`, `securedocs` |
| `ZONA_HORARIA` | Zona en la que se leen la hora y la fecha para P4 y P9 | `America/Lima` |

## Usuarios de prueba

Los crea `npm run db:seed`. La contraseña de todos es `Secure123!`.

| Correo | Rol | Departamento | Nivel | Para qué sirve |
|---|---|---|---|---|
| `admin@techcorp.pe` | ADMIN | GLOBAL | 5 | Todos los permisos; única con `USER_MANAGE` y `ROLE_ASSIGN` |
| `gerente.fin@techcorp.pe` | GERENTE | FINANZAS | 5 | Aprueba y elimina; modifica documentos ajenos (excepción de P3) |
| `supervisor.fin@techcorp.pe` | SUPERVISOR | FINANZAS | 4 | Aprueba documentos ajenos; no el suyo (P10) |
| `empleado.fin@techcorp.pe` | EMPLEADO | FINANZAS | 3 | Crea, lee, descarga y modifica lo suyo |
| `empleado2.fin@techcorp.pe` | EMPLEADO | FINANZAS | 3 | Compañero: si edita un documento ajeno, P3 lo deniega |
| `practicante.fin@techcorp.pe` | EMPLEADO | FINANZAS | 2 | Nivel bajo: P2 le oculta lo de nivel mayor |
| `empleado.rrhh@techcorp.pe` | EMPLEADO | RRHH | 3 | Otro departamento: P1 le oculta lo de FINANZAS |
| `auditor@techcorp.pe` | AUDITOR | GLOBAL | 5 | Lee y descarga todo y consulta toda la auditoría; no modifica |
| `inactivo@techcorp.pe` | EMPLEADO | FINANZAS | 3 | Cuenta INACTIVA: todo se deniega en la etapa ESTADO (P7) |
| `invitado@externo.com` | INVITADO | GLOBAL | 1 | Externa vigente hasta 2027-12-31: solo documentos públicos publicados (P8) |
| `invitado.vencido@externo.com` | INVITADO | GLOBAL | 1 | Acceso vencido el 2025-01-01: todo se deniega en la etapa ESTADO (P9) |

## Uso

### Frontend

La interfaz cubre todas las acciones de la API. Al iniciar sesión (con las tarjetas de usuarios de demostración, que solo aparecen fuera de producción) se abre un panel con estas pantallas:

| Pantalla | Qué permite | Permiso |
|---|---|---|
| **Inicio** | Totales y gráfico de documentos por estado, pendientes de aprobación con Aprobar y Rechazar, tu acceso (atributos y permisos), actividad y denegaciones por política, entorno y estado del sistema | `DOC_READ`; la actividad exige `AUDIT_READ` |
| **Documentos** | Buscar y filtrar, vista de tabla o de tarjetas, subir con arrastrar y soltar y barra de avance, editar, enviar a aprobación, aprobar o rechazar, descargar (el navegador verifica el SHA-256), eliminar, y acciones en lote con el resultado de cada documento | `DOC_READ`, `DOC_CREATE`, `DOC_UPDATE`, `DOC_APPROVE`, `DOC_DOWNLOAD`, `DOC_DELETE` |
| **Detalle de un documento** | Encabezado con el tipo de archivo, el estado dentro del flujo con sus fechas, vista previa de PDF e imágenes, historial dinámico en vivo (línea de tiempo por día, filtros y eventos desplegables), ficha, archivo con su SHA-256 y los atributos que compara el servidor, con la política que lee cada uno | `DOC_READ`; la vista previa exige `DOC_DOWNLOAD`; el historial completo y las políticas exigen `AUDIT_READ` |
| **Usuarios** | Buscar y filtrar, alta con contraseña generada y reglas en vivo, editar (rol, departamento, nivel, país, contrato y vencimiento), activar, desactivar o suspender y restablecer la contraseña | `USER_MANAGE`; el rol exige `ROLE_ASSIGN` |
| **Auditoría** | Filtros por usuario, acción, resultado, etapa, recurso y fechas con rangos rápidos, filas expandibles, paginación de foto fija y exportación a CSV | `AUDIT_READ` |
| **Reglas de acceso** | El flujo de decisión, la matriz RBAC (con tu rol resaltado) y las políticas ABAC con su condición JSONB; los avisos de denegación enlazan a la política que decidió | `AUDIT_READ` |
| **Mi cuenta** | Tu perfil y atributos, tiempo que le queda a la sesión, permisos de tu rol, el entorno que ve el servidor y preferencias | sesión |

Cómo funciona:

- **El servidor decide.** Los botones dependen del estado del documento; el rol solo es una pista: lo que tu rol no tiene se ve atenuado y con un candado. Con el **modo laboratorio** activo (por defecto) siguen siendo pulsables, para ver cómo las deniega el servidor; en el menú del usuario se puede ocultar.
- **Cada denegación se explica.** El aviso muestra las tres etapas (ESTADO, RBAC y ABAC) con la que falló marcada, la política y el motivo.
- **Entorno simulado.** El botón de la barra superior fija la ubicación, el dispositivo y la hora, que viajan como `X-Ubicacion`, `X-Dispositivo` y `X-Hora`, con escenarios rápidos (fuera de horario, dispositivo personal, otro país). Al cambiarlo se vuelve a consultar.
- **Formularios con cuadros desplegables.** Subir o editar un documento, dar de alta un usuario y elegir el entorno se organizan en cuadros con emoji que se pliegan y muestran un resumen vivo (por ejemplo «Nivel 4 · FINANZAS · PERU»); los campos llevan su emoji y los filtros de cada lista se pliegan en un cuadro «Buscar y filtrar». Cada pantalla abre con un encabezado con emoji y, en el inicio, el login, el entorno y la auditoría, una foto.
- **Vista previa.** En el detalle de un PDF o de una imagen, «Cargar vista previa» descarga el archivo, comprueba su SHA-256 y lo muestra dentro de la página. Equivale a una descarga: exige `DOC_DOWNLOAD` y queda auditada como `DOC_DOWNLOAD`. Word y Excel no se pueden previsualizar.
- **Historial dinámico.** Quien tiene `AUDIT_READ` ve la auditoría del documento en una línea de tiempo que se actualiza sola cada 20 s: indicador «en vivo», aviso de los eventos nuevos, filtros (todo, cambios, consultas, denegados) y detalle de cada registro. Se pausa con la pestaña oculta y a los 10 minutos, y se puede pausar a mano. Sin `AUDIT_READ` solo se ve lo que consta en el propio documento (creación y decisión).
- **Tema claro, oscuro o el del sistema**, diseño adaptable a móviles y atajo `/` para buscar en la lista de documentos.

### API

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `POST /auth/login` | pública | Devuelve el token y los datos del usuario |
| `GET /auth/me` | token | Usuario, permisos de su rol y entorno con el que consulta |
| `GET /documentos` | `DOC_READ` | Solo los documentos que las políticas ABAC permiten leer (`q`, `estado`, `departamento`, `pagina`, `limite`) |
| `POST /documentos` | `DOC_CREATE` | Multipart con archivo opcional, o JSON sin archivo |
| `GET /documentos/:id` | `DOC_READ` | Metadatos del documento |
| `PUT /documentos/:id` | `DOC_UPDATE` | Título, descripción, archivo nuevo y `enviar` |
| `DELETE /documentos/:id` | `DOC_DELETE` | Borrado lógico |
| `POST /documentos/:id/aprobar` | `DOC_APPROVE` | `{"decision": "APROBAR"}` o `{"decision": "RECHAZAR"}`; sin cuerpo aprueba |
| `GET /documentos/:id/archivo` | `DOC_DOWNLOAD` | Único camino de descarga: autorizado, auditado y transmitido desde MinIO |
| `GET /usuarios`, `POST /usuarios` | `USER_MANAGE` (y `ROLE_ASSIGN` al dar de alta) | Consultar y crear usuarios |
| `GET /usuarios/:id`, `PUT /usuarios/:id` | `USER_MANAGE` (y `ROLE_ASSIGN` si cambia el rol) | Consultar y modificar; no hay `DELETE`: los usuarios se desactivan |
| `GET /auditoria` | `AUDIT_READ` | Registros filtrables por `usuario`, `accion`, `resultado`, `etapa`, `recurso` (p. ej. `documento:12`), `desde` y `hasta` |
| `GET /catalogos` | sesión | Roles, departamentos y permisos, para llenar formularios y filtros; no es una decisión de autorización, así que no se audita |
| `GET /reglas` | `AUDIT_READ` | Matriz RBAC y políticas ABAC con su condición JSONB, tal como están en la base de datos; queda auditado como `AUDIT_READ` sobre el recurso `reglas` |
| `GET /health` | pública | Estado de la API y de la base de datos |

Toda petición autenticada admite las cabeceras `X-Ubicacion` (país), `X-Dispositivo` (`CORPORATIVO` o `PERSONAL`) y `X-Hora` (`HH:mm`, solo fuera de producción). Una denegación responde 403 con este cuerpo:

```json
{
  "error": "ACCESO_DENEGADO",
  "mensaje": "Documento de otro departamento",
  "etapa": "ABAC",
  "politica": "P1",
  "motivo": "Documento de otro departamento"
}
```

En `http/` hay una colección de Postman (se importa también en Bruno) con su entorno; `npm run test:http` la ejecuta con Newman contra la API en marcha. Cubre los endpoints de autenticación, documentos, usuarios y auditoría; `/catalogos` y `/reglas` se prueban en Jest.

## Cómo se autoriza

1. **ESTADO** (P7 y P9): el usuario debe estar activo y, si es externo, su acceso no debe haber vencido. Se evalúa antes que RBAC y sin cargar el recurso.
2. **RBAC**: el rol debe tener el permiso de la acción (tabla `rol_permiso`).
3. **ABAC**: se carga el recurso y se evalúan, por orden, las políticas de la acción; deben cumplirse todas y la primera que falla decide.
4. **Auditoría**: la decisión se registra siempre, antes de responder. Si no se puede registrar, la petición falla.

Las políticas son datos: para agregar o cambiar una basta un INSERT o UPDATE en `politica`. Los diagramas, las matrices RBAC y ABAC y el modelo de base de datos están en [docs/entregables.md](docs/entregables.md); la pantalla Reglas de acceso muestra las políticas tal como están hoy en la base de datos.

## Pruebas

| Comando | Qué hace |
|---|---|
| `npm test` | Todo: unitarias e integración (necesita Docker y la base de datos sembrada) |
| `npm run test:unit` | Solo las unitarias; no necesitan Docker |
| `npm run test:integracion` | Supertest contra la API real, PostgreSQL y MinIO |
| `npm run test:casos` | Los 17 casos de la guía; regenera [evidencias/casos-guia.md](evidencias/casos-guia.md) |
| `npm run test:cobertura` | Cobertura con el motor V8; el informe HTML queda en `coverage/` |
| `npm run test:http` | Colección de Postman con Newman |
| `npm run typecheck` y `npm run typecheck:tests` | Comprobación de tipos del código y de las pruebas |

Se puede filtrar por nombre de archivo: `npm run test:unit -- motor` o `npm run test:integracion -- documentos`.

Al cierre había 18 suites y 689 pruebas en verde, con 99,0 % de cobertura de líneas y 94,6 % de ramas.

## Otros comandos

| Comando | Qué hace |
|---|---|
| `npm run db:reset` | Borra la base de datos, la vuelve a crear y la siembra; deja limpias la auditoría y los usuarios de prueba |
| `npm run db:studio` | Abre Prisma Studio |

`db:reset` no borra los archivos de MinIO. Para dejar también el almacenamiento vacío: `docker compose down -v`, luego `docker compose up -d`, `npx prisma migrate deploy` y `npm run db:seed`.

## Supuestos de interpretación y decisiones

Lo que este proyecto hace distinto o adicional a la guía, y por qué:

| Tema | Decisión |
|---|---|
| Política P11 (nueva) | Nadie cambia su propio rol, ni un administrador. Sale de la línea "nadie cambia su propio rol" de la API de usuarios; vive en la tabla `politica`, no en un `if`, y usa `si recurso.id != null` para no bloquear las altas |
| Etapas y orden | `politica` tiene las columnas `etapa` (ESTADO o ABAC) y `orden`. P7 y P9 son etapa ESTADO (antes de RBAC). P8 se evalúa antes que P2 (orden 15 contra 20) para que el caso 12 se deniegue por P8, la regla propia del invitado |
| Horario (P4) | `08:00 ≤ hora < 18:00` en hora de Lima: a las 18:00 ya no se accede. El operador `between` del motor incluye ambos extremos |
| Entorno simulado | Ubicación y dispositivo llegan por cabeceras, como pide la guía. Sin ellas el servidor no asume nada (P5 y P6 deniegan). `X-Hora` solo se acepta fuera de producción. En un despliegue real saldrían de la IP geolocalizada y de un certificado de dispositivo |
| Login y estado | El login no bloquea a usuarios inactivos ni vencidos: se autentican y `authorize` los deniega con P7 o P9, dejando rastro (casos 8 y 14) |
| Token mínimo | Solo lleva `sub`, `iss`, `iat` y `exp`. Rol, estado, nivel y departamento se leen de la base de datos en cada petición, así que los cambios rigen al instante. Restablecer una contraseña no invalida los tokens ya emitidos (trabajo futuro) |
| Documentos | Al crear se evalúa ABAC sobre el "documento candidato". Departamento, nivel, país y propietario no cambian después. Editar un documento PUBLICADO lo devuelve a PENDIENTE. El archivo es opcional al crear y obligatorio para enviar a aprobación |
| Listas | Cada documento pasa por ABAC y el total cuenta solo los visibles. El `GET /documentos/:id` de uno prohibido responde 403, no 404 |
| Borrados | Los documentos se borran de forma lógica (el archivo queda en MinIO). No hay `DELETE /usuarios`: los usuarios se desactivan |
| Usuarios | Siempre debe quedar al menos un usuario activo con `USER_MANAGE` (con bloqueo de filas). El contrato EXTERNO exige fecha de expiración e INTERNO no la lleva. Contraseñas de al menos 10 caracteres, con mayúsculas, minúsculas y números, y hasta 72 bytes. Un solo costo de bcrypt (10) |
| Auditoría | Obligatoria: se escribe antes de responder y, si falla, la petición falla (500). ADMIN y AUDITOR ven todo; los demás, solo su departamento. No se audita el 401 anónimo, el 404 ni los rechazos de validación (400, 413, 415). Las altas y cambios de usuario dejan `USER_CREATE` o `USER_UPDATE` con el detalle, sin contraseñas |
| Paginación de auditoría | Consultar la auditoría también se audita, así que una paginación por desplazamiento se movería. La primera página toma la fecha de su registro más reciente y las siguientes la envían como `hasta` |
| API adicional | `GET /usuarios/:id`, la decisión `RECHAZAR` en `POST /documentos/:id/aprobar` y `enviar: true` al crear o editar un documento |
| Archivos | Validación por firma real (PDF, PNG, JPG, DOCX y XLSX) con código propio en lugar de `file-type`, que tenía una vulnerabilidad; máximo 10 MB; nombre UUID en MinIO; SHA-256; descarga solo por la API, sin URLs firmadas; 503 si MinIO no responde |
| Frontend | HTML, Bootstrap 5.3 y Bootstrap Icons (servidos desde `node_modules`, sin CDN) y módulos ES propios, sin React. La CSP de helmet queda intacta, el texto del servidor se pinta siempre como texto y el token vive en `sessionStorage` (solo el tema, que no es sensible, va a `localStorage`). La carpeta `/demo` con los usuarios de prueba solo se sirve fuera de producción |
| Vista previa y CSP | La vista previa arma un `blob:` con lo que descargó el navegador, así que la CSP de helmet admite `blob:` solo en `img-src` y `frame-src`; `script-src` sigue en `'self'`. Cargarla es una descarga auditada (`DOC_DOWNLOAD`) y se pide a demanda, no al abrir el documento |
| Historial en vivo | Consultar la auditoría también la escribe, así que el sondeo cada 20 s deja un registro `AUDIT_READ` por consulta. Por eso solo corre con la pestaña visible, se detiene a los 10 minutos y se puede pausar |
| Imágenes | Las dos fotos (`login-fondo.jpg` y `servidores.jpg`) son de Unsplash, con licencia de uso libre, y están en `public/img/` con sus créditos en `CREDITOS.md`. Solo son fondo decorativo |
| Botones y permisos | La interfaz nunca decide: sus botones dependen del estado del documento y del rol solo como pista visual (atenuado con candado). El «modo laboratorio» los deja pulsables para mostrar la denegación del servidor |
| Catálogos y reglas | `GET /catalogos` (roles, departamentos y permisos) solo exige sesión porque no es sensible y llena los formularios. `GET /reglas` (matriz RBAC y políticas con su condición) exige `AUDIT_READ`: quien audita puede ver cómo se decide. No hay permiso nuevo ni edición de políticas desde la interfaz |
| Exportación CSV | La auditoría se exporta desde el navegador (hasta 1000 registros). Como el motivo y el correo de un intento de login los escribe quien ataca, toda celda que empiece por `=`, `+`, `-` o `@` lleva un apóstrofo delante para que Excel no la tome por una fórmula |
| Herramientas | TypeScript 5.9 porque `ts-jest` no funciona con TypeScript 7; Prisma 6; PostgreSQL en el puerto 5434 (el 5433 lo reserva Hyper-V en Windows); imágenes de MinIO desde quay.io (Docker Hub las retiró) |
| Pruebas | El reloj de la aplicación se fija en las pruebas de integración (23-sep-2026, 10:00 en Lima). Las pruebas borran los documentos que crean; los usuarios de prueba quedan INACTIVOS porque la auditoría es inmutable y no permite borrarlos |

## Seguridad

- Denegar por defecto: un atributo faltante o una política mal escrita deniegan.
- Contraseñas con bcrypt, JWT firmado con HS256 y emisor fijo; consultas parametrizadas con Prisma.
- Validación con zod `strictObject`: un campo que no está en el esquema (`estado`, `propietario_id`...) se rechaza en lugar de ignorarse.
- Archivos privados: bucket sin acceso anónimo, descarga solo con autorización y auditoría, `Content-Disposition: attachment`, `Cache-Control: no-store` y cabecera `X-Content-SHA256`.
- helmet con política de contenido estricta (`blob:` solo en `img-src` y `frame-src`, para la vista previa); el frontend no usa scripts en línea ni `innerHTML`.
- Errores uniformes: un fallo interno responde 500 sin detalles.
- Dependencias: `npm audit` reporta 7 vulnerabilidades (4 moderadas y 3 altas) en dependencias transitivas de MinIO y de Prisma (`decode-uri-component`, `deepmerge-ts` y `stream-json`). No se ejecutó `npm audit fix --force` porque propone cambios de versión mayor; quedan como riesgo conocido y como trabajo futuro.

## Trabajo futuro

- MFA para ADMIN y límite de intentos en el login (`rate limiting`).
- Credenciales de MinIO de mínimo privilegio para la API (hoy usa las de root).
- Revocar los tokens al restablecer una contraseña.
- Revisar y actualizar las dependencias que reporta `npm audit`.
- Filtrar en SQL las listas (hoy se filtra en memoria con ABAC por elemento).
- Editar las políticas desde la interfaz (exigiría un permiso propio y validar la condición antes de guardarla) y pruebas de extremo a extremo del frontend con un navegador automatizado.
- Ubicación por geolocalización de IP y dispositivo por MDM, en lugar de cabeceras simuladas; HTTPS con un proxy inverso.

# 3. Diagrama de arquitectura

```mermaid
%% arquitectura
flowchart TB
  UI["Navegador · HTML + Bootstrap<br/>(carpeta public)"]
  subgraph API["API · Node.js 22 · Express 5 · TypeScript"]
    direction TB
    subgraph ENTRADA["1 · Entrada"]
      direction LR
      MW["helmet (CSP)<br/>JSON · estáticos"] --> ENT["Contexto de entorno<br/>hora · país<br/>dispositivo · IP"] --> AUTHN["Authentication<br/>JWT HS256"]
    end
    subgraph AUTHZ["2 · Authorization (cada decisión se audita)"]
      direction LR
      E1["ESTADO<br/>P7 · P9"] --> R1["RBAC<br/>rol → permisos"] --> A1["ABAC<br/>motor de políticas<br/>P1–P6 · P8 · P10 · P11"]
    end
    subgraph NEGOCIO["3 · Negocio"]
      direction LR
      MOD["Módulos<br/>auth · documentos<br/>usuarios · auditoría"]
      AUD["Servicio de<br/>auditoría"]
    end
    ENTRADA --> AUTHZ --> NEGOCIO
  end
  subgraph DATOS["Datos"]
    direction LR
    PG[("PostgreSQL 16<br/>usuarios · roles · permisos<br/>políticas · documentos<br/>auditoría inmutable")]
    S3[("MinIO<br/>bucket privado")]
  end
  UI -->|"Bearer JWT · X-Ubicacion<br/>X-Dispositivo · X-Hora"| ENTRADA
  AUTHZ -.->|"lee rol_permiso y politica"| DATOS
  NEGOCIO -->|"Prisma · INSERT de auditoría"| PG
  NEGOCIO -->|"archivos"| S3
```

**Figura 1.** Arquitectura de SecureDocs. La flecha punteada es la lectura de reglas (permisos y políticas); las continuas, los datos de negocio.

## Componentes

| Componente | Responsabilidad | Ubicación |
|---|---|---|
| Frontend | Inicio, documentos (lista y detalle con vista previa e historial dinámico en vivo), usuarios, auditoría, reglas de acceso y cuenta; envía el token y las cabeceras del entorno simulado y explica cada denegación | `public/` |
| Contexto de entorno | Construye `req.entorno`: hora (America/Lima), país, dispositivo e IP | `src/context/entorno.ts` |
| Authentication | Login con bcrypt y JWT HS256; `authenticate` carga al usuario desde la base de datos en cada petición | `src/auth/` |
| Authorization | `authorize` y `Autorizador`: etapas ESTADO → RBAC → ABAC; devuelve etapa, política y motivo | `src/authorization/` |
| RBAC | Permisos por rol leídos de la tabla `rol_permiso` (nada está escrito en el código) | `src/authorization/rbac/` |
| ABAC | Motor genérico que evalúa las condiciones JSONB de la tabla `politica` | `src/authorization/abac/` |
| Auditoría | Registra cada decisión, permitida o denegada, antes de responder | `src/audit/` |
| Módulos de negocio | Documentos, usuarios, auditoría y reglas (catálogos y reglas de acceso, de solo lectura): rutas, validación con zod y servicios | `src/modules/` |
| Almacenamiento | MinIO con bucket privado; archivos con nombre UUID, validados por firma y con SHA-256 | `src/storage/` |
| Base de datos | PostgreSQL 16 con Prisma; un trigger hace inmutable la auditoría | `prisma/` |

## Flujo de autorización

```mermaid
%% flujo-autorizacion
flowchart TD
  P(["Petición HTTP"]) --> J["authenticate<br/>¿JWT válido y usuario existente?"]
  J -- no --> R401["401 Unauthorized<br/>(no se audita)"]
  J -- sí --> S["Etapa ESTADO · P7 y P9<br/>¿usuario activo y acceso vigente?"]
  S -- no --> DEN
  S -- sí --> RB["Etapa RBAC<br/>¿el rol tiene el permiso?"]
  RB -- no --> DEN
  RB -- sí --> C["Cargar el recurso<br/>(404 si no existe)"]
  C --> AB["Etapa ABAC · P1 a P6, P8, P10 y P11<br/>¿se cumplen todas las políticas?"]
  AB -- no --> DEN
  AB -- sí --> OK["PERMITIDO"]
  DEN["DENEGADO<br/>etapa · política · motivo"]
  OK --> AUD["Registrar la decisión<br/>en auditoría"]
  DEN --> AUD
  AUD -- permitido --> H["Ejecutar la acción<br/>y responder 2xx"]
  AUD -- denegado --> R403["403 ACCESO_DENEGADO<br/>{ etapa, politica, motivo }"]
  AUD -- no se pudo registrar --> R500["500: sin rastro<br/>no hay acción"]
```

**Figura 2.** Flujo de autorización de cada petición.

1. `authenticate` valida el JWT y carga al usuario desde la base de datos (rol, estado, nivel, departamento, país, contrato). Sin un token válido la respuesta es 401 y no se audita.
2. Etapa ESTADO (P7 y P9): usuario activo y acceso externo vigente. Se evalúa antes que RBAC y sin cargar el recurso, para no revelar si un documento existe a quien no debería consultarlo.
3. Etapa RBAC: el rol del usuario debe tener el permiso de la acción en la tabla `rol_permiso`.
4. Se carga el recurso (404 si no existe).
5. Etapa ABAC: se leen las políticas de la acción, ordenadas por `orden`; se omiten las que exceptúan el rol del usuario; deben cumplirse todas y la primera que falla decide.
6. La decisión se registra en `auditoria` antes de responder. Si no se puede escribir el registro, la petición falla con 500.
7. Permitido: se ejecuta la acción. Denegado: 403 con `{ error, mensaje, etapa, politica, motivo }`.

Principio: denegar por defecto. Un atributo faltante o una política mal escrita se evalúan como denegación, nunca como permiso.

<!-- horizontal -->

# 4. Modelo de base de datos

```mermaid
%% modelo-seguridad
erDiagram
  DEPARTAMENTO ||--o{ USUARIO : agrupa
  ROL ||--o{ USUARIO : tiene
  ROL ||--o{ ROL_PERMISO : incluye
  PERMISO ||--o{ ROL_PERMISO : se_asigna

  DEPARTAMENTO {
    int id PK
    string codigo UK
    string nombre
  }
  ROL {
    int id PK
    string nombre UK
  }
  PERMISO {
    int id PK
    string codigo UK
  }
  ROL_PERMISO {
    int rol_id PK, FK
    int permiso_id PK, FK
  }
  USUARIO {
    int id PK
    string nombre
    string correo UK
    string password_hash
    int rol_id FK
    int departamento_id FK
    int nivel_seguridad
    string pais
    enum tipo_contrato
    enum estado
    date fecha_expiracion
    timestamp creado_en
  }
  POLITICA {
    int id PK
    string codigo UK
    string nombre
    string descripcion
    enum etapa
    int orden
    text_array acciones
    jsonb condicion
    text_array roles_exceptuados
    string motivo_denegacion
    bool activa
  }
```

**Figura 3.** Modelo de control de acceso: departamentos, usuarios, roles, permisos y políticas. `politica` no tiene claves foráneas: es una tabla de configuración que el motor ABAC lee en cada decisión.

<!-- vertical -->

```mermaid
%% modelo-documentos
erDiagram
  DEPARTAMENTO ||--o{ DOCUMENTO : clasifica
  USUARIO ||--o{ DOCUMENTO : es_propietario
  USUARIO |o--o{ DOCUMENTO : aprueba
  USUARIO |o--o{ AUDITORIA : genera

  DEPARTAMENTO {
    int id PK
    string codigo UK
  }
  USUARIO {
    int id PK
    string nombre
    string correo UK
  }
  DOCUMENTO {
    int id PK
    string titulo
    string descripcion
    int propietario_id FK
    int departamento_id FK
    int nivel_confidencialidad
    enum estado
    string pais
    timestamp fecha_creacion
    int aprobado_por FK
    timestamp fecha_aprobacion
    timestamp eliminado_en
    uuid archivo_clave UK
    string archivo_nombre_original
    string archivo_mime
    int archivo_tamano
    char archivo_sha256
  }
  AUDITORIA {
    bigint id PK
    int usuario_id FK
    string usuario_correo
    string recurso
    string accion
    enum resultado
    enum etapa
    string politica_codigo
    string motivo
    string ip
    string ubicacion
    string dispositivo
    timestamptz fecha
  }
```

**Figura 4.** Modelo documental y de auditoría. `departamento` y `usuario` se repiten solo con sus columnas clave (están completos en la figura 3). `auditoria.usuario_id` puede ser nulo: un login con un correo inexistente también se registra.

| Tabla | Propósito | Notas |
|---|---|---|
| `departamento` | Áreas de la empresa: FINANZAS, RRHH, LEGAL, TI, OPERACIONES y GLOBAL | GLOBAL es el departamento transversal (ADMIN, AUDITOR e INVITADO) |
| `rol`, `permiso`, `rol_permiso` | RBAC: qué permisos tiene cada rol | Clave compuesta en `rol_permiso`; borrado en cascada |
| `usuario` | Cuentas y atributos que usa ABAC: rol, departamento, `nivel_seguridad` (1 a 5), país, `tipo_contrato`, `estado` y `fecha_expiracion` | Correo único; `password_hash` con bcrypt |
| `documento` | Metadatos, atributos ABAC (departamento, `nivel_confidencialidad`, país, propietario, estado) y datos del archivo en MinIO (clave UUID, nombre original, MIME, tamaño y SHA-256) | Borrado lógico con `eliminado_en`; el estado es BORRADOR, PENDIENTE, PUBLICADO o RECHAZADO |
| `politica` | Reglas ABAC como datos: condición JSONB, acciones, roles exceptuados, etapa (ESTADO o ABAC), orden y motivo de denegación | Se modifican con un INSERT o UPDATE, sin cambiar el código |
| `auditoria` | Registro inmutable de cada decisión | Dos triggers rechazan UPDATE, DELETE y TRUNCATE; índices por fecha y por usuario |

Las tablas y las relaciones se crean con migraciones de Prisma (`prisma/migrations/`). La migración `auditoria_inmutable` añade la función `auditoria_inmutable()` y los triggers `trg_auditoria_inmutable` (por fila, ante UPDATE o DELETE) y `trg_auditoria_no_truncate` (ante TRUNCATE); ambos lanzan la excepción "La tabla auditoria es inmutable".

# 5. Matriz de roles y permisos (RBAC)

Los permisos por rol se guardan en la tabla `rol_permiso` y se siembran desde `prisma/datos.ts`; el código nunca compara nombres de rol. La marca ✔ indica que el rol tiene el permiso.

| Permiso | ADMIN | GERENTE | SUPERVISOR | EMPLEADO | AUDITOR | INVITADO |
|---|---|---|---|---|---|---|
| `DOC_CREATE` | ✔ | ✔ | ✔ | ✔ | — | — |
| `DOC_READ` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `DOC_UPDATE` | ✔ | ✔ | ✔ | ✔ | — | — |
| `DOC_DELETE` | ✔ | ✔ | — | — | — | — |
| `DOC_APPROVE` | ✔ | ✔ | ✔ | — | — | — |
| `DOC_DOWNLOAD` | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `AUDIT_READ` | ✔ | ✔ | — | — | ✔ | — |
| `USER_MANAGE` | ✔ | — | — | — | — | — |
| `ROLE_ASSIGN` | ✔ | — | — | — | — | — |
| **Total** | **9** | **7** | **5** | **4** | **3** | **1** |

| Permiso | Qué permite | Endpoints |
|---|---|---|
| `DOC_CREATE` | Crear documentos | `POST /documentos` |
| `DOC_READ` | Listar y consultar documentos | `GET /documentos`, `GET /documentos/:id` |
| `DOC_UPDATE` | Modificar título, descripción o archivo, y enviar a aprobación | `PUT /documentos/:id` |
| `DOC_DELETE` | Eliminar documentos (borrado lógico) | `DELETE /documentos/:id` |
| `DOC_APPROVE` | Aprobar o rechazar documentos pendientes | `POST /documentos/:id/aprobar` |
| `DOC_DOWNLOAD` | Descargar el archivo de un documento | `GET /documentos/:id/archivo` |
| `AUDIT_READ` | Consultar la auditoría y las reglas de acceso | `GET /auditoria`, `GET /reglas` |
| `USER_MANAGE` | Consultar, crear y modificar usuarios | `GET /usuarios`, `POST /usuarios`, `GET /usuarios/:id`, `PUT /usuarios/:id` |
| `ROLE_ASSIGN` | Asignar o cambiar el rol de un usuario | `POST /usuarios (alta)`, `PUT /usuarios/:id (si cambia el rol)` |

Solo ADMIN tiene `USER_MANAGE` y `ROLE_ASSIGN`. Que un rol tenga el permiso no basta: además deben cumplirse las políticas ABAC de la sección siguiente.

# 6. Matriz de políticas (ABAC)

Las políticas están en la tabla `politica` y las evalúa un motor genérico (`src/authorization/abac/`). Se evalúan primero las de etapa ESTADO (antes de RBAC) y luego las ABAC, por `orden` ascendente; deben cumplirse todas (AND) y la primera que falla decide la denegación. Las políticas que exceptúan el rol del usuario se omiten. Los casos que ejercen cada política están en la sección 7.

<!-- horizontal -->

| Código | Política | Etapa | Orden | Acciones | Regla | Exceptúa | Motivo de denegación |
|---|---|---|---|---|---|---|---|
| **P7** | Estado del usuario | ESTADO | 1 | Todas | El usuario debe estar ACTIVO. Se evalúa antes que RBAC. | — | Usuario inactivo o suspendido |
| **P9** | Expiración de acceso externo | ESTADO | 2 | Todas | Un usuario EXTERNO solo accede hasta su fecha de expiración. | — | Acceso temporal vencido |
| **P1** | Departamento | ABAC | 10 | Las 6 de documentos (`DOC_*`) | Solo se accede a documentos del propio departamento (ADMIN y AUDITOR son GLOBAL; INVITADO lo rige P8). | ADMIN, AUDITOR, INVITADO | Documento de otro departamento |
| **P8** | Invitado | ABAC | 15 | `DOC_READ` | El invitado solo lee documentos públicos (nivel 1) y publicados. | — | Invitado solo accede a documentos públicos publicados |
| **P2** | Nivel de seguridad | ABAC | 20 | Las 6 de documentos (`DOC_*`) | El nivel de seguridad del usuario debe ser mayor o igual al nivel de confidencialidad del documento. | — | Nivel de seguridad insuficiente |
| **P3** | Propiedad | ABAC | 30 | `DOC_UPDATE` | Solo el propietario modifica un documento (GERENTE y ADMIN exceptuados). | GERENTE, ADMIN | Solo puede modificar sus propios documentos |
| **P4** | Horario laboral | ABAC | 40 | Las 6 de documentos (`DOC_*`) | Documentos de nivel 4 o 5: solo de 08:00 a 18:00 (hora de la empresa; a las 18:00 ya no). | — | Fuera del horario autorizado |
| **P5** | País | ABAC | 50 | Las 6 de documentos (`DOC_*`) | El acceso debe hacerse desde el país del documento (sin ubicación informada = denegado). | — | Acceso desde país no autorizado |
| **P6** | Dispositivo | ABAC | 60 | Las 6 de documentos (`DOC_*`) | Documentos de nivel 4 o 5: solo desde dispositivo CORPORATIVO. | — | Requiere dispositivo corporativo |
| **P10** | Autoaprobación | ABAC | 80 | `DOC_APPROVE` | Nadie aprueba su propio documento. | — | No puede aprobar su propio documento |
| **P11** | Autogestión de roles | ABAC | 90 | `ROLE_ASSIGN` | Nadie cambia su propio rol (ni siquiera un administrador). | — | No puede cambiar su propio rol |

<!-- vertical -->

## Condición almacenada de cada política

La columna `condicion` (JSONB) usa atributos `usuario.*`, `recurso.*` y `entorno.*`. Operadores: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `nin` y `between`; las variantes `eqAttr`, `neqAttr`, `gteAttr`, etc. comparan contra otro atributo; los bloques `all`, `any` y `si` / `entonces` combinan condiciones.

```text
P7   {"usuario.estado":{"eq":"ACTIVO"}}
P9   {"si":{"usuario.tipo_contrato":{"eq":"EXTERNO"}},"entonces":{"usuario.fecha_expiracion":{"gteAttr":"entorno.fecha"}}}
P1   {"usuario.departamento":{"eqAttr":"recurso.departamento"}}
P8   {"si":{"usuario.rol":{"eq":"INVITADO"}},"entonces":{"all":[{"usuario.tipo_contrato":{"eq":"EXTERNO"}},{"recurso.nivel_confidencialidad":{"lte":1}},{"recurso.estado":{"eq":"PUBLICADO"}}]}}
P2   {"usuario.nivel_seguridad":{"gteAttr":"recurso.nivel_confidencialidad"}}
P3   {"usuario.id":{"eqAttr":"recurso.propietario_id"}}
P4   {"si":{"recurso.nivel_confidencialidad":{"gte":4}},"entonces":{"all":[{"entorno.hora":{"gte":"08:00"}},{"entorno.hora":{"lt":"18:00"}}]}}
P5   {"entorno.ubicacion":{"eqAttr":"recurso.pais"}}
P6   {"si":{"recurso.nivel_confidencialidad":{"gte":4}},"entonces":{"entorno.dispositivo":{"eq":"CORPORATIVO"}}}
P10  {"usuario.id":{"neqAttr":"recurso.propietario_id"}}
P11  {"si":{"recurso.id":{"neq":null}},"entonces":{"usuario.id":{"neqAttr":"recurso.id"}}}
```

La pantalla Reglas de acceso del frontend muestra esta misma información leída de la base de datos, con la matriz RBAC, las políticas en su orden de evaluación y el enlace desde cada aviso de denegación.

[PEGAR: captura de la pantalla Reglas de acceso del frontend]

## Cómo agregar o cambiar una política

Las políticas se leen de la base de datos en cada decisión, sin caché, así que un cambio rige desde la siguiente petición y no hace falta tocar el código. Ejemplo ilustrativo (no forma parte del seed; no ejecutarlo en la base de datos de pruebas, porque cambiaría el resultado de casos existentes):

```sql
INSERT INTO politica (codigo, nombre, descripcion, etapa, orden, acciones, condicion, roles_exceptuados, motivo_denegacion, activa)
VALUES ('P12', 'No eliminar publicados', 'Un documento PUBLICADO no se elimina', 'ABAC', 100,
        ARRAY['DOC_DELETE'], '{"recurso.estado": {"neq": "PUBLICADO"}}', ARRAY['ADMIN'],
        'Un documento publicado no se puede eliminar', true);
```

# 7. Evidencias de los casos de prueba

Los casos 1 a 12 son los de la guía (sección 11); los casos 13 a 17 son los cinco adicionales que exige la guía y se diseñaron para cubrir lo que los doce primeros no ejercen: autoaprobación (P10), acceso externo vencido (P9), país distinto (P5), modificar un documento ajeno (P3) y la excepción del gerente a P3.

Cada caso está automatizado en `tests/integracion/casos-guia.test.ts` (Jest + Supertest contra la API, PostgreSQL y MinIO reales) y comprueba cuatro cosas: la respuesta HTTP, el detalle de la denegación (`etapa`, `politica` y `motivo`), que se creó exactamente un registro de auditoría con el motivo correcto, y que la base de datos quedó como debía (por ejemplo, un caso denegado no modifica nada).

**Resultado: 17/17 casos correctos.**

| Dato | Valor |
|---|---|
| Ejecutado | 2026-09-24T07:02:12.484Z |
| Node | v22.18.0 |
| Base de datos | PostgreSQL localhost:5434/securedocs |
| Almacenamiento | MinIO localhost:9000 (bucket "securedocs", privado) |
| Reloj de la aplicación | 2026-09-23T15:00:00.000Z (10:00 en Lima) |

<!-- horizontal -->

| # | Escenario | Usuario | Petición | Esperado | Obtenido | OK |
|---|---|---|---|---|---|---|
| 1 | Empleado consulta documento de su área | empleado.fin@techcorp.pe | `GET /documentos/1` | Permitido (HTTP 200) | HTTP 200 | ✅ |
| 2 | Empleado consulta documento de otra área | empleado.fin@techcorp.pe | `GET /documentos/7` | Denegado · ABAC P1 · Documento de otro departamento | HTTP 403 · ABAC P1 · Documento de otro departamento | ✅ |
| 3 | Supervisor aprueba documento de su área (ajeno) | supervisor.fin@techcorp.pe | `POST /documentos/369/aprobar` | Permitido (HTTP 200) | HTTP 200 | ✅ |
| 4 | Empleado intenta aprobar | empleado.fin@techcorp.pe | `POST /documentos/370/aprobar` | Denegado · RBAC · Denegado por RBAC | HTTP 403 · RBAC · Denegado por RBAC | ✅ |
| 5 | Usuario nivel 2 consulta documento nivel 4 | practicante.fin@techcorp.pe | `GET /documentos/3` | Denegado · ABAC P2 · Nivel de seguridad insuficiente | HTTP 403 · ABAC P2 · Nivel de seguridad insuficiente | ✅ |
| 6 | Gerente elimina documento de su área | gerente.fin@techcorp.pe | `DELETE /documentos/371` | Permitido (HTTP 204) | HTTP 204 | ✅ |
| 7 | Auditor intenta modificar | auditor@techcorp.pe | `PUT /documentos/1` | Denegado · RBAC · Denegado por RBAC | HTTP 403 · RBAC · Denegado por RBAC | ✅ |
| 8 | Usuario inactivo intenta acceder | inactivo@techcorp.pe | `GET /documentos/1` | Denegado · ESTADO P7 · Usuario inactivo o suspendido | HTTP 403 · ESTADO P7 · Usuario inactivo o suspendido | ✅ |
| 9 | Documento nivel ≥ 4 accedido fuera de horario (X-Hora 20:00) | supervisor.fin@techcorp.pe | `GET /documentos/3  [X-Hora: 20:00]` | Denegado · ABAC P4 · Fuera del horario autorizado | HTTP 403 · ABAC P4 · Fuera del horario autorizado | ✅ |
| 10 | Documento nivel 5 desde dispositivo PERSONAL | gerente.fin@techcorp.pe | `GET /documentos/4  [X-Dispositivo: PERSONAL]` | Denegado · ABAC P6 · Requiere dispositivo corporativo | HTTP 403 · ABAC P6 · Requiere dispositivo corporativo | ✅ |
| 11 | Invitado accede a documento nivel 1 PUBLICADO | invitado@externo.com | `GET /documentos/8` | Permitido (HTTP 200) | HTTP 200 | ✅ |
| 12 | Invitado accede a documento confidencial | invitado@externo.com | `GET /documentos/9` | Denegado · ABAC P8 · Invitado solo accede a documentos públicos publicados | HTTP 403 · ABAC P8 · Invitado solo accede a documentos públicos publicados | ✅ |
| 13 | Supervisor aprueba su propio documento | supervisor.fin@techcorp.pe | `POST /documentos/372/aprobar` | Denegado · ABAC P10 · No puede aprobar su propio documento | HTTP 403 · ABAC P10 · No puede aprobar su propio documento | ✅ |
| 14 | Invitado con fecha_expiracion vencida | invitado.vencido@externo.com | `GET /documentos/8` | Denegado · ESTADO P9 · Acceso temporal vencido | HTTP 403 · ESTADO P9 · Acceso temporal vencido | ✅ |
| 15 | Empleado consulta desde CHILE documento de PERU | empleado.fin@techcorp.pe | `GET /documentos/1  [X-Ubicacion: CHILE]` | Denegado · ABAC P5 · Acceso desde país no autorizado | HTTP 403 · ABAC P5 · Acceso desde país no autorizado | ✅ |
| 16 | Empleado modifica documento de un compañero de su área | empleado2.fin@techcorp.pe | `PUT /documentos/373` | Denegado · ABAC P3 · Solo puede modificar sus propios documentos | HTTP 403 · ABAC P3 · Solo puede modificar sus propios documentos | ✅ |
| 17 | Gerente modifica documento de un empleado de su área | gerente.fin@techcorp.pe | `PUT /documentos/373` | Permitido (HTTP 200) | HTTP 200 | ✅ |

<!-- vertical -->

## Pruebas automatizadas del proyecto

| Comando | Qué ejecuta |
|---|---|
| `npm test` | Todo: 18 suites y 689 pruebas (unitarias e integración) |
| `npm run test:unit` | Solo las unitarias (no necesitan Docker) |
| `npm run test:casos` | Los 17 casos; regenera `evidencias/casos-guia.md` |
| `npm run test:cobertura` | Cobertura: 99,0 % de líneas y 94,6 % de ramas |

Además de los casos de la guía se prueban: la inmutabilidad de la auditoría, la carrera entre dos aprobadores (uno recibe 200 y el otro 409), la caída de MinIO (503), la validación de archivos con archivos disfrazados, los tokens JWT forjados y los cambios de usuario con efecto inmediato.

## Capturas para adjuntar

1. [PEGAR: captura de la salida de npm run test:casos con los 17 casos en verde]
2. [PEGAR: captura del resumen final de npm test (18 suites, 689 pruebas)]
3. [PEGAR: captura de la pantalla de login con el selector de usuarios de demostración]
4. [PEGAR: captura de la lista de documentos con un aviso de acceso denegado (etapa, política y motivo)]

# 8. Registro de auditoría

Cada decisión de autorización (permitida o denegada) y cada intento de login quedan en la tabla `auditoria` antes de que se envíe la respuesta. Las altas y cambios de usuario dejan además un evento `USER_CREATE` o `USER_UPDATE` con el detalle, en la misma transacción, sin contraseñas.

| Campo | Contenido |
|---|---|
| `id`, `fecha` | Identificador y momento exacto (con zona horaria, al milisegundo) |
| `usuario_id`, `usuario_correo` | Quién actuó; el correo se conserva también si el usuario no existe (login fallido) |
| `accion`, `recurso` | Qué se intentó (por ejemplo `DOC_APPROVE` sobre `documento:262`) |
| `resultado` | PERMITIDO o DENEGADO |
| `etapa` | AUTENTICACION, ESTADO, RBAC, ABAC o COMPLETA (pasó todas las etapas) |
| `politica_codigo`, `motivo` | Política que decidió y motivo legible |
| `ip`, `ubicacion`, `dispositivo` | Entorno desde el que se hizo la petición |

No se audita el 401 anónimo (no hay usuario), el 404 ni los rechazos de validación (400, 413 y 415), porque no son decisiones de autorización. La consulta se hace con `GET /auditoria` o en la pestaña Auditoría del frontend: ADMIN y AUDITOR ven todo; los demás, solo la actividad de su departamento.

El registro que dejó cada uno de los 17 casos de la sección 7:

<!-- horizontal -->

| # | id | Resultado | Etapa | Política | Acción | Recurso | Motivo | IP | Ubicación | Dispositivo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 6835 | PERMITIDO | COMPLETA | — | DOC_READ | documento:1 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 2 | 6836 | DENEGADO | ABAC | P1 | DOC_READ | documento:7 | Documento de otro departamento | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 3 | 6837 | PERMITIDO | COMPLETA | — | DOC_APPROVE | documento:369 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 4 | 6838 | DENEGADO | RBAC | — | DOC_APPROVE | documento:370 | Denegado por RBAC | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 5 | 6839 | DENEGADO | ABAC | P2 | DOC_READ | documento:3 | Nivel de seguridad insuficiente | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 6 | 6840 | PERMITIDO | COMPLETA | — | DOC_DELETE | documento:371 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 7 | 6841 | DENEGADO | RBAC | — | DOC_UPDATE | documento:1 | Denegado por RBAC | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 8 | 6842 | DENEGADO | ESTADO | P7 | DOC_READ | documento:1 | Usuario inactivo o suspendido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 9 | 6843 | DENEGADO | ABAC | P4 | DOC_READ | documento:3 | Fuera del horario autorizado | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 10 | 6844 | DENEGADO | ABAC | P6 | DOC_READ | documento:4 | Requiere dispositivo corporativo | ::ffff:127.0.0.1 | PERU | PERSONAL |
| 11 | 6845 | PERMITIDO | COMPLETA | — | DOC_READ | documento:8 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 12 | 6846 | DENEGADO | ABAC | P8 | DOC_READ | documento:9 | Invitado solo accede a documentos públicos publicados | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 13 | 6847 | DENEGADO | ABAC | P10 | DOC_APPROVE | documento:372 | No puede aprobar su propio documento | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 14 | 6848 | DENEGADO | ESTADO | P9 | DOC_READ | documento:8 | Acceso temporal vencido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 15 | 6849 | DENEGADO | ABAC | P5 | DOC_READ | documento:1 | Acceso desde país no autorizado | ::ffff:127.0.0.1 | CHILE | CORPORATIVO |
| 16 | 6850 | DENEGADO | ABAC | P3 | DOC_UPDATE | documento:373 | Solo puede modificar sus propios documentos | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 17 | 6851 | PERMITIDO | COMPLETA | — | DOC_UPDATE | documento:373 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |

<!-- vertical -->

## Inmutabilidad

La tabla `auditoria` no admite modificaciones. El trigger rechaza la operación con una excepción; se puede comprobar así (comando de Docker Compose, con la base de datos en marcha):

```bash
docker compose exec postgres psql -U securedocs -d securedocs -c "UPDATE auditoria SET motivo = 'manipulado' WHERE id = (SELECT min(id) FROM auditoria);"
```

Resultado esperado: `ERROR:  La tabla auditoria es inmutable: UPDATE no permitido`. Lo mismo ocurre con `DELETE` y `TRUNCATE`. Estas tres operaciones se prueban en `tests/integracion/auditoria.test.ts` dentro de una transacción que siempre se revierte.

[PEGAR: captura de la pestaña Auditoría filtrada por resultado DENEGADO]

[PEGAR: captura del error del trigger al intentar el UPDATE]

# 9. Video de demostración

[PEGAR: URL del video]

Duración sugerida: unos 10 minutos.

## Antes de grabar

1. Dejar la base de datos limpia: `npm run db:reset` (borra las tablas, las vuelve a crear y las siembra). Para vaciar también MinIO: `docker compose down -v`, luego `docker compose up -d`, `npx prisma migrate deploy` y `npm run db:seed`.
2. Arrancar con `npm run dev` y comprobar `http://localhost:3000/health`.
3. Abrir en pestañas: el frontend, la terminal con el proyecto, `evidencias/casos-guia.md` y el diagrama de arquitectura.
4. Usar los usuarios de demostración del login (contraseña común `Secure123!`).

## Guion

| Minuto | Qué mostrar | Qué decir o hacer |
|---|---|---|
| 0:00 a 0:40 | Repositorio y diagrama de arquitectura (sección 3) | Presentar SecureDocs: JWT, RBAC, ABAC y auditoría; las reglas están en la base de datos y no en condicionales dispersos |
| 0:40 a 1:20 | Terminal: `docker compose ps`, `npm run dev` y `/health` | PostgreSQL y MinIO corren en Docker; la API responde `{"estado":"ok","bd":"ok"}` |
| 1:20 a 2:10 | Frontend: login como Eduardo Empleado; permisos de su rol y barra de entorno simulado | Un empleado crea, lee, modifica y descarga; no aprueba ni elimina |
| 2:10 a 3:20 | Eduardo sube un PDF y lo envía a aprobación; Sara Supervisora lo aprueba; Eduardo lo descarga | Casos 1 y 3; el archivo va a MinIO con nombre UUID y el navegador verifica el SHA-256 |
| 3:20 a 4:30 | Denegaciones en la interfaz, leyendo etapa, política y motivo del aviso: Eduardo pulsa Aprobar (RBAC, caso 4); Elena edita un documento de Eduardo (P3, caso 16); Sara sube un documento, lo envía y pulsa Aprobar (P10, caso 13); Iván inactivo entra pero todo se deniega (P7, caso 8); Víctor vencido (P9, caso 14) | Cada denegación dice qué etapa y qué política la decidieron |
| 4:30 a 5:20 | ABAC sobre la lista: Rita de RRHH no ve documentos de FINANZAS (P1); Pedro, nivel 2, no ve los de nivel mayor (P2); con Sara o Gabriel, cambiar la hora a 20:00 o el dispositivo a PERSONAL hace desaparecer los de nivel 4 y 5 (P4, P6); la ubicación CHILE los oculta todos (P5) | La lista solo muestra lo que las políticas permiten leer; el 403 explícito de estos casos se ve en Postman o Bruno (`GET /documentos/:id` con la cabecera X-Hora, X-Dispositivo o X-Ubicacion) y en `evidencias/casos-guia.md` |
| 5:20 a 6:20 | Alberto Auditor abre Auditoría y filtra por DENEGADO; expande una fila; abre el historial dinámico de un documento (mientras otro usuario lo consulta aparecen eventos nuevos) | Cada decisión quedó registrada con su IP, ubicación y dispositivo; el alcance depende del departamento |
| 6:20 a 7:10 | Ana Admin abre Usuarios: crea uno con contraseña generada, le cambia el rol y lo desactiva; intenta cambiar su propio rol | Solo ella tiene `USER_MANAGE` y `ROLE_ASSIGN`; nadie cambia su propio rol (P11) y siempre queda un gestor activo |
| 7:10 a 7:50 | Reglas de acceso (Alberto o Ana): la matriz RBAC, las 11 políticas y el enlace desde un aviso de denegación | Las reglas son datos de la base de datos y cualquier cambio rige desde la siguiente petición |
| 7:50 a 8:20 | Terminal: el `UPDATE` sobre `auditoria` de la sección 8 | El trigger impide modificar o borrar la auditoría |
| 8:20 a 9:10 | Terminal: `npm run test:casos` y `npm test`; abrir `evidencias/casos-guia.md` | Los 17 casos automatizados comprueban HTTP, motivo y registro de auditoría |
| 9:10 a 9:40 | Supuestos y trabajo futuro del README | P11 y el orden de P8 son decisiones propias; MFA, límite de intentos de login y editar políticas desde la interfaz quedan como trabajo futuro |
