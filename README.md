# SecureDocs — TechCorp S.A.

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
