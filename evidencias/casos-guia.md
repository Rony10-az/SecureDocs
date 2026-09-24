# Evidencia de pruebas — los 17 casos de la guía (sección 11)

**Resultado: 17/17 casos correctos.**

Generado automáticamente por `tests/integracion/casos-guia.test.ts` (Jest + Supertest) contra la API, PostgreSQL y MinIO reales.

| | |
|---|---|
| Ejecutado | 2026-09-24T14:54:09.448Z |
| Node | v22.18.0 |
| Base de datos | PostgreSQL localhost:5434/securedocs |
| Almacenamiento | MinIO localhost:9000 (bucket "securedocs", privado) |
| Reloj de la aplicación | 2026-09-23T15:00:00.000Z (10:00 en Lima) |

Cada caso comprueba tres cosas: **(1)** la respuesta HTTP, **(2)** el detalle de la denegación (`etapa`, `politica`, `motivo`) y **(3)** que se creó exactamente un registro de auditoría con el motivo correcto.

## Resumen

| # | Escenario | Usuario | Petición | Esperado | Obtenido | OK |
|---|---|---|---|---|---|---|
| 1 | Empleado consulta documento de su área | empleado.fin@techcorp.pe | `GET /documentos/1` | Permitido (HTTP 200) | HTTP 200 | ✅ |
| 2 | Empleado consulta documento de otra área | empleado.fin@techcorp.pe | `GET /documentos/7` | Denegado · ABAC P1 · Documento de otro departamento | HTTP 403 · ABAC P1 · Documento de otro departamento | ✅ |
| 3 | Supervisor aprueba documento de su área (ajeno) | supervisor.fin@techcorp.pe | `POST /documentos/394/aprobar` | Permitido (HTTP 200) | HTTP 200 | ✅ |
| 4 | Empleado intenta aprobar | empleado.fin@techcorp.pe | `POST /documentos/395/aprobar` | Denegado · RBAC · Denegado por RBAC | HTTP 403 · RBAC · Denegado por RBAC | ✅ |
| 5 | Usuario nivel 2 consulta documento nivel 4 | practicante.fin@techcorp.pe | `GET /documentos/3` | Denegado · ABAC P2 · Nivel de seguridad insuficiente | HTTP 403 · ABAC P2 · Nivel de seguridad insuficiente | ✅ |
| 6 | Gerente elimina documento de su área | gerente.fin@techcorp.pe | `DELETE /documentos/396` | Permitido (HTTP 204) | HTTP 204 | ✅ |
| 7 | Auditor intenta modificar | auditor@techcorp.pe | `PUT /documentos/1` | Denegado · RBAC · Denegado por RBAC | HTTP 403 · RBAC · Denegado por RBAC | ✅ |
| 8 | Usuario inactivo intenta acceder | inactivo@techcorp.pe | `GET /documentos/1` | Denegado · ESTADO P7 · Usuario inactivo o suspendido | HTTP 403 · ESTADO P7 · Usuario inactivo o suspendido | ✅ |
| 9 | Documento nivel ≥ 4 accedido fuera de horario (X-Hora 20:00) | supervisor.fin@techcorp.pe | `GET /documentos/3  [X-Hora: 20:00]` | Denegado · ABAC P4 · Fuera del horario autorizado | HTTP 403 · ABAC P4 · Fuera del horario autorizado | ✅ |
| 10 | Documento nivel 5 desde dispositivo PERSONAL | gerente.fin@techcorp.pe | `GET /documentos/4  [X-Dispositivo: PERSONAL]` | Denegado · ABAC P6 · Requiere dispositivo corporativo | HTTP 403 · ABAC P6 · Requiere dispositivo corporativo | ✅ |
| 11 | Invitado accede a documento nivel 1 PUBLICADO | invitado@externo.com | `GET /documentos/8` | Permitido (HTTP 200) | HTTP 200 | ✅ |
| 12 | Invitado accede a documento confidencial | invitado@externo.com | `GET /documentos/9` | Denegado · ABAC P8 · Invitado solo accede a documentos públicos publicados | HTTP 403 · ABAC P8 · Invitado solo accede a documentos públicos publicados | ✅ |
| 13 | Supervisor aprueba su propio documento | supervisor.fin@techcorp.pe | `POST /documentos/397/aprobar` | Denegado · ABAC P10 · No puede aprobar su propio documento | HTTP 403 · ABAC P10 · No puede aprobar su propio documento | ✅ |
| 14 | Invitado con fecha_expiracion vencida | invitado.vencido@externo.com | `GET /documentos/8` | Denegado · ESTADO P9 · Acceso temporal vencido | HTTP 403 · ESTADO P9 · Acceso temporal vencido | ✅ |
| 15 | Empleado consulta desde CHILE documento de PERU | empleado.fin@techcorp.pe | `GET /documentos/1  [X-Ubicacion: CHILE]` | Denegado · ABAC P5 · Acceso desde país no autorizado | HTTP 403 · ABAC P5 · Acceso desde país no autorizado | ✅ |
| 16 | Empleado modifica documento de un compañero de su área | empleado2.fin@techcorp.pe | `PUT /documentos/398` | Denegado · ABAC P3 · Solo puede modificar sus propios documentos | HTTP 403 · ABAC P3 · Solo puede modificar sus propios documentos | ✅ |
| 17 | Gerente modifica documento de un empleado de su área | gerente.fin@techcorp.pe | `PUT /documentos/398` | Permitido (HTTP 200) | HTTP 200 | ✅ |

## Registro de auditoría que dejó cada caso

| # | id | Resultado | Etapa | Política | Acción | Recurso | Motivo | IP | Ubicación | Dispositivo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 7321 | PERMITIDO | COMPLETA | — | DOC_READ | documento:1 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 2 | 7322 | DENEGADO | ABAC | P1 | DOC_READ | documento:7 | Documento de otro departamento | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 3 | 7323 | PERMITIDO | COMPLETA | — | DOC_APPROVE | documento:394 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 4 | 7324 | DENEGADO | RBAC | — | DOC_APPROVE | documento:395 | Denegado por RBAC | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 5 | 7325 | DENEGADO | ABAC | P2 | DOC_READ | documento:3 | Nivel de seguridad insuficiente | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 6 | 7326 | PERMITIDO | COMPLETA | — | DOC_DELETE | documento:396 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 7 | 7327 | DENEGADO | RBAC | — | DOC_UPDATE | documento:1 | Denegado por RBAC | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 8 | 7328 | DENEGADO | ESTADO | P7 | DOC_READ | documento:1 | Usuario inactivo o suspendido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 9 | 7329 | DENEGADO | ABAC | P4 | DOC_READ | documento:3 | Fuera del horario autorizado | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 10 | 7330 | DENEGADO | ABAC | P6 | DOC_READ | documento:4 | Requiere dispositivo corporativo | ::ffff:127.0.0.1 | PERU | PERSONAL |
| 11 | 7331 | PERMITIDO | COMPLETA | — | DOC_READ | documento:8 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 12 | 7332 | DENEGADO | ABAC | P8 | DOC_READ | documento:9 | Invitado solo accede a documentos públicos publicados | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 13 | 7333 | DENEGADO | ABAC | P10 | DOC_APPROVE | documento:397 | No puede aprobar su propio documento | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 14 | 7334 | DENEGADO | ESTADO | P9 | DOC_READ | documento:8 | Acceso temporal vencido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 15 | 7335 | DENEGADO | ABAC | P5 | DOC_READ | documento:1 | Acceso desde país no autorizado | ::ffff:127.0.0.1 | CHILE | CORPORATIVO |
| 16 | 7336 | DENEGADO | ABAC | P3 | DOC_UPDATE | documento:398 | Solo puede modificar sus propios documentos | ::ffff:127.0.0.1 | PERU | CORPORATIVO |
| 17 | 7337 | PERMITIDO | COMPLETA | — | DOC_UPDATE | documento:398 | Acceso permitido | ::ffff:127.0.0.1 | PERU | CORPORATIVO |

La tabla `auditoria` es inmutable: un trigger de PostgreSQL rechaza `UPDATE`, `DELETE` y `TRUNCATE` (probado en `tests/integracion/auditoria.test.ts`).
