/**
 * Documentos y archivos (sección 9 de la guía): MinIO privado, nombre UUID, solo PDF/DOCX/XLSX/PNG/JPG, máx. 10 MB,
 * tipo por contenido, SHA-256, descarga solo por la API (autorizada y auditada), y el ciclo de vida del documento.
 */
import { prisma } from "../../src/db";
import { config } from "../../src/config";
import { AppError } from "../../src/errors";
import { MIME } from "../../src/storage/archivo";
import { ArchivoNoEncontrado, storage } from "../../src/storage";
import { docxMuestra, ejecutableDisfrazado, jpgMuestra, pdfMuestra, pngMuestra, xlsxMuestra } from "../soporte/muestras";
import {
  CORREOS,
  api,
  auditoriaDesde,
  cerrar,
  crearDocumento,
  descargar,
  fijarRelojDePruebas,
  leerTodo,
  limpiarDocumentos,
  marcaAuditoria,
  registrarDocumento,
  restaurarReloj,
  sesiones,
  sha256,
  titulosVisibles,
  verificarEntorno,
} from "./soporte";

const SEMBRADOS = [
  "Presupuesto 2026",
  "Informe trimestral Q3",
  "Plan de inversiones",
  "Estados financieros auditados",
  "Propuesta de la supervisora",
  "Documento para eliminar",
  "Planilla de sueldos",
  "Manual de bienvenida",
  "Contrato confidencial",
];

describe("Documentos y archivos (MinIO)", () => {
  let T: Awaited<ReturnType<typeof sesiones>>;
  const pdf = pdfMuestra("integración");
  const conArchivo: number[] = []; // para la comprobación de integridad del final

  const nuevo = async (token: string, o: Parameters<typeof crearDocumento>[1]) => {
    const d = await crearDocumento(token, o);
    if (d.archivo) conArchivo.push(d.id);
    return d;
  };
  const claveDe = async (id: number) => (await prisma.documento.findUniqueOrThrow({ where: { id } })).archivo_clave!;

  beforeAll(async () => {
    await verificarEntorno();
    fijarRelojDePruebas();
    T = await sesiones();
  });

  afterAll(async () => {
    restaurarReloj();
    await limpiarDocumentos();
    await cerrar();
  });

  // -------------------------------------------------------------------------------------------------
  describe("subida y almacenamiento", () => {
    let doc: Awaited<ReturnType<typeof nuevo>>;
    let clave: string;

    beforeAll(async () => {
      doc = await nuevo(T.eduardo, { titulo: "Informe de integración", nivel: 2, archivo: { nombre: "informe.pdf", contenido: pdf } });
      clave = await claveDe(doc.id);
    });

    test("201: queda en BORRADOR, de FINANZAS, país PERU, con Eduardo como propietario", () => {
      expect(doc).toMatchObject({ estado: "BORRADOR", departamento: "FINANZAS", pais: "PERU", propietario: { nombre: "Eduardo Empleado" } });
    });

    test("la respuesta trae nombre, MIME detectado, tamaño y SHA-256, y NO la clave interna del archivo", () => {
      expect(doc.archivo).toEqual({ nombre: "informe.pdf", mime: "application/pdf", tamano: pdf.length, sha256: sha256(pdf) });
      expect(JSON.stringify(doc)).not.toContain(clave);
      expect(JSON.stringify(doc)).not.toContain("archivo_clave");
    });

    test("en la BD la clave es un UUID (nunca el nombre que puso el usuario) y se guardan hash, MIME y tamaño", async () => {
      expect(clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const fila = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } });
      expect(fila).toMatchObject({ archivo_nombre_original: "informe.pdf", archivo_mime: "application/pdf", archivo_tamano: pdf.length, archivo_sha256: sha256(pdf) });
    });

    test("el objeto está en MinIO con EXACTAMENTE el mismo contenido", async () => {
      const bytes = await leerTodo(await storage.leer(clave));
      expect(bytes.equals(pdf)).toBe(true);
    });

    test("el bucket es PRIVADO: pedir el objeto sin credenciales da 403", async () => {
      const r = await fetch(`http://${config.MINIO_ENDPOINT}:${config.MINIO_PORT}/${config.MINIO_BUCKET}/${clave}`);
      expect(r.status).toBe(403);
    });

    test.each([
      ["foto.png", pngMuestra(), MIME.png],
      ["foto.jpg", jpgMuestra(), MIME.jpg],
      ["hoja.xlsx", xlsxMuestra(), MIME.xlsx],
      ["carta.docx", docxMuestra(), MIME.docx],
    ])("acepta %s y guarda el MIME detectado por el contenido", async (nombre, contenido, mime) => {
      const d = await nuevo(T.eduardo, { titulo: `Archivo ${nombre}`, nivel: 1, archivo: { nombre, contenido } });
      expect(d.archivo).toMatchObject({ mime, tamano: contenido.length, sha256: sha256(contenido) });
    });

    test("un nombre con tildes y eñes se conserva", async () => {
      const d = await nuevo(T.eduardo, { titulo: "Nombre con tildes", nivel: 1, archivo: { nombre: "Informe ñandú.pdf", contenido: pdf } });
      expect(d.archivo?.nombre).toBe("Informe ñandú.pdf");
    });

    test("un nombre con ruta ('../../etc/passwd.pdf') se guarda sin carpetas: 'passwd.pdf'", async () => {
      const d = await nuevo(T.eduardo, { titulo: "Path traversal", nivel: 1, archivo: { nombre: "../../etc/passwd.pdf", contenido: pdf } });
      expect(d.archivo?.nombre).toBe("passwd.pdf");
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("archivos rechazados (y no queda ningún documento a medias)", () => {
    const grande = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(11 * 1024 * 1024)]);

    test.each([
      ["un ejecutable (MZ) renombrado a .pdf", "factura.pdf", ejecutableDisfrazado(), 415, "TIPO_NO_PERMITIDO"],
      ["un PNG con extensión .pdf (no coincide con su contenido)", "imagen.pdf", pngMuestra(), 415, "TIPO_NO_PERMITIDO"],
      ["un archivo de texto", "nota.txt", Buffer.from("hola"), 415, "TIPO_NO_PERMITIDO"],
      ["HTML con un script disfrazado de .png", "x.png", Buffer.from("<script>alert(1)</script>"), 415, "TIPO_NO_PERMITIDO"],
      ["un archivo vacío", "vacio.pdf", Buffer.alloc(0), 400, "VALIDACION"],
      ["un archivo de más de 10 MB", "grande.pdf", grande, 413, "ARCHIVO_MUY_GRANDE"],
    ])("rechaza %s (%i)", async (_caso, nombre, contenido, status, codigo) => {
      const antes = await prisma.documento.count();
      const r = await api(T.eduardo).post("/documentos").field("titulo", "Archivo rechazado").field("nivel_confidencialidad", "1").attach("archivo", contenido, nombre);
      expect(r.status).toBe(status);
      expect(r.body.error).toBe(codigo);
      expect(await prisma.documento.count()).toBe(antes);
    });

    test("dos archivos a la vez (400)", async () => {
      const r = await api(T.eduardo).post("/documentos").field("titulo", "Dos archivos").field("nivel_confidencialidad", "1").attach("archivo", pdf, "a.pdf").attach("archivo", pdf, "b.pdf");
      expect(r.status).toBe(400);
    });

    test("un archivo en un campo que no se llama 'archivo' (400)", async () => {
      const r = await api(T.eduardo).post("/documentos").field("titulo", "Campo equivocado").field("nivel_confidencialidad", "1").attach("documento", pdf, "a.pdf");
      expect(r.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("crear con JSON (sin archivo) y validaciones", () => {
    test("JSON sin archivo -> 201, BORRADOR y archivo null", async () => {
      const r = await api(T.eduardo).post("/documentos").send({ titulo: "Borrador sin archivo", nivel_confidencialidad: 2 });
      expect(r.status).toBe(201);
      registrarDocumento(r.body.id);
      expect(r.body).toMatchObject({ estado: "BORRADOR", archivo: null });
    });

    test("enviar a aprobación sin archivo -> 400", async () => {
      const r = await api(T.eduardo).post("/documentos").send({ titulo: "Enviar sin archivo", nivel_confidencialidad: 2, enviar: true });
      expect(r.status).toBe(400);
    });

    test.each(["estado", "propietario_id", "aprobado_por", "id"])("mass assignment: el campo '%s' se rechaza (400), no se ignora", async (campo) => {
      const r = await api(T.eduardo).post("/documentos").send({ titulo: "Intruso", nivel_confidencialidad: 1, [campo]: 1 });
      expect(r.status).toBe(400);
    });

    test("nivel de confidencialidad 9 -> 400 (la validación va antes que las políticas)", async () => {
      const r = await api(T.eduardo).post("/documentos").send({ titulo: "Nivel imposible", nivel_confidencialidad: 9 });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("VALIDACION");
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("las políticas también gobiernan la CREACIÓN (se evalúa el documento que se quiere crear)", () => {
    const crea = (token: string, body: object, entorno?: Record<string, string>) => api(token, entorno).post("/documentos").send(body);
    const denegado = (r: { status: number; body: Record<string, unknown> }, etapa: string, politica: string | null) => {
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: "ACCESO_DENEGADO", etapa, politica });
    };

    test("otro departamento -> P1", async () => denegado(await crea(T.eduardo, { titulo: "En RRHH", nivel_confidencialidad: 1, departamento: "RRHH" }), "ABAC", "P1"));
    test("un nivel por encima del propio (nivel 3 crea nivel 4) -> P2", async () => denegado(await crea(T.eduardo, { titulo: "Muy alto", nivel_confidencialidad: 4 }), "ABAC", "P2"));
    test("nivel 4 fuera de horario -> P4", async () => denegado(await crea(T.gerente, { titulo: "De noche", nivel_confidencialidad: 4 }, { "X-Hora": "20:00" }), "ABAC", "P4"));
    test("nivel 4 desde un dispositivo PERSONAL -> P6", async () => denegado(await crea(T.gerente, { titulo: "Personal", nivel_confidencialidad: 4 }, { "X-Dispositivo": "PERSONAL" }), "ABAC", "P6"));
    test("desde otro país (el documento sería de PERU) -> P5", async () => denegado(await crea(T.gerente, { titulo: "Desde Chile", nivel_confidencialidad: 2 }, { "X-Ubicacion": "CHILE" }), "ABAC", "P5"));
    test("el Auditor no puede crear -> RBAC", async () => denegado(await crea(T.auditor, { titulo: "Auditor", nivel_confidencialidad: 1 }), "RBAC", null));
    test("el Invitado no puede crear -> RBAC", async () => denegado(await crea(T.invitado, { titulo: "Invitado", nivel_confidencialidad: 1 }), "RBAC", null));
    test("un usuario inactivo -> ESTADO P7", async () => denegado(await crea(T.inactivo, { titulo: "Inactivo", nivel_confidencialidad: 1 }), "ESTADO", "P7"));
    test("un invitado vencido -> ESTADO P9", async () => denegado(await crea(T.vencido, { titulo: "Vencido", nivel_confidencialidad: 1 }), "ESTADO", "P9"));

    test("quien no tiene permiso recibe 403 aunque suba un archivo: el formulario ni se procesa", async () => {
      const r = await api(T.auditor).post("/documentos").field("titulo", "X").field("nivel_confidencialidad", "1").attach("archivo", pdf, "a.pdf");
      denegado(r, "RBAC", null);
    });

    test("el ADMIN (departamento GLOBAL) debe indicar el departamento (400) y sí puede crear en RRHH (exceptuado de P1)", async () => {
      expect((await crea(T.admin, { titulo: "Sin departamento", nivel_confidencialidad: 1 })).status).toBe(400);
      const ok = await crea(T.admin, { titulo: "Documento de RRHH creado por el admin", nivel_confidencialidad: 3, departamento: "RRHH" });
      expect(ok.status).toBe(201);
      registrarDocumento(ok.body.id);
      expect(ok.body.departamento).toBe("RRHH");
    });

    test("un departamento inexistente -> 400", async () => {
      expect((await crea(T.admin, { titulo: "Depto raro", nivel_confidencialidad: 1, departamento: "MARTE" })).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("descarga: el ÚNICO camino por el que sale un archivo (autorizado, auditado, transmitido desde MinIO)", () => {
    let doc: Awaited<ReturnType<typeof nuevo>>;
    beforeAll(async () => {
      doc = await nuevo(T.eduardo, { titulo: "Documento para descargar", nivel: 2, archivo: { nombre: "Informe ñandú.pdf", contenido: pdf } });
    });

    test("el propietario descarga los mismos bytes que subió", async () => {
      const r = await descargar(T.eduardo, `/documentos/${doc.id}/archivo`);
      expect(r.status).toBe(200);
      expect(r.contenido.equals(pdf)).toBe(true);
    });

    test("cabeceras: MIME detectado, adjunto (nunca 'inline'), SHA-256, tamaño, sin caché y nosniff", async () => {
      const r = await descargar(T.eduardo, `/documentos/${doc.id}/archivo`);
      expect(r.headers["content-type"]).toBe("application/pdf");
      expect(r.headers["content-disposition"]).toMatch(/^attachment;/);
      expect(r.headers["x-content-sha256"]).toBe(sha256(pdf));
      expect(sha256(r.contenido)).toBe(r.headers["x-content-sha256"]); // el cliente puede verificar la integridad
      expect(r.headers["content-length"]).toBe(String(pdf.length));
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
    });

    test("el nombre con tildes viaja en dos formas (RFC 6266): respaldo ASCII y UTF-8 con porcentajes; sin saltos de línea", async () => {
      const cabecera = (await descargar(T.eduardo, `/documentos/${doc.id}/archivo`)).headers["content-disposition"] as string;
      expect(cabecera).toContain(`filename="Informe _and_.pdf"`);
      expect(cabecera).toContain(`filename*=UTF-8''Informe%20%C3%B1and%C3%BA.pdf`);
      expect(cabecera).not.toMatch(/[\r\n]/);
    });

    test("cada descarga queda auditada como DOC_DOWNLOAD con el id del documento", async () => {
      const marca = await marcaAuditoria();
      await descargar(T.eduardo, `/documentos/${doc.id}/archivo`);
      const filas = await auditoriaDesde(marca, { accion: "DOC_DOWNLOAD" });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ usuario_correo: CORREOS.eduardo, recurso: `documento:${doc.id}`, resultado: "PERMITIDO", etapa: "COMPLETA" });
    });

    test("el Invitado no tiene DOC_DOWNLOAD -> RBAC", async () => {
      const r = await api(T.invitado).get(`/documentos/${doc.id}/archivo`);
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ etapa: "RBAC", politica: null });
    });

    test("una empleada de RRHH (otro departamento) -> P1", async () => {
      const r = await api(T.rrhh).get(`/documentos/${doc.id}/archivo`);
      expect(r.body).toMatchObject({ etapa: "ABAC", politica: "P1" });
    });

    test("el Auditor (GLOBAL) sí puede", async () => {
      expect((await descargar(T.auditor, `/documentos/${doc.id}/archivo`)).status).toBe(200);
    });

    test("un documento sin archivo adjunto -> 404", async () => {
      const sin = await nuevo(T.eduardo, { titulo: "Sin archivo para descargar", nivel: 1, archivo: false });
      expect((await api(T.eduardo).get(`/documentos/${sin.id}/archivo`)).status).toBe(404);
    });

    test("fuera de horario, un documento de nivel 4 no se descarga (P4)", async () => {
      const plan = await prisma.documento.findFirstOrThrow({ where: { titulo: "Plan de inversiones", eliminado_en: null } });
      const r = await api(T.gerente, { "X-Hora": "20:00" }).get(`/documentos/${plan.id}/archivo`);
      expect(r.body).toMatchObject({ etapa: "ABAC", politica: "P4" });
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("modificar (PUT)", () => {
    let doc: Awaited<ReturnType<typeof nuevo>>;
    beforeAll(async () => {
      doc = await nuevo(T.eduardo, { titulo: "Documento para modificar", nivel: 2 });
    });

    test("el propietario cambia el título: 200 y sigue en BORRADOR", async () => {
      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).send({ titulo: "Documento modificado" });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ titulo: "Documento modificado", estado: "BORRADOR" });
    });

    test.each(["nivel_confidencialidad", "departamento", "pais", "estado", "propietario_id"])("'%s' no se puede cambiar después de crear el documento (400)", async (campo) => {
      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).send({ [campo]: campo === "nivel_confidencialidad" ? 1 : "X" });
      expect(r.status).toBe(400);
    });

    test("PUT vacío, o con lo mismo que ya tenía -> 400 'no hay nada que actualizar'", async () => {
      expect((await api(T.eduardo).put(`/documentos/${doc.id}`).send({})).status).toBe(400);
      expect((await api(T.eduardo).put(`/documentos/${doc.id}`).send({ titulo: "Documento modificado" })).status).toBe(400);
    });

    test("reemplazar el archivo: clave nueva, contenido nuevo y el anterior se borra de MinIO (no quedan huérfanos)", async () => {
      const primero = await api(T.eduardo).put(`/documentos/${doc.id}`).attach("archivo", pdf, "v1.pdf");
      expect(primero.status).toBe(200);
      conArchivo.push(doc.id);
      const claveVieja = await claveDe(doc.id);

      const png = pngMuestra([10, 200, 10]);
      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).attach("archivo", png, "logo.png");
      expect(r.status).toBe(200);
      expect(r.body.archivo).toMatchObject({ mime: "image/png", sha256: sha256(png) });

      const claveNueva = await claveDe(doc.id);
      expect(claveNueva).not.toBe(claveVieja);
      expect((await leerTodo(await storage.leer(claveNueva))).equals(png)).toBe(true);
      await expect(storage.leer(claveVieja)).rejects.toBeInstanceOf(ArchivoNoEncontrado);
    });

    test("reemplazar por un ejecutable disfrazado -> 415 y el archivo actual NO se toca", async () => {
      const antes = await claveDe(doc.id);
      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).attach("archivo", ejecutableDisfrazado(), "x.pdf");
      expect(r.status).toBe(415);
      expect(await claveDe(doc.id)).toBe(antes);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("ciclo de vida: BORRADOR → PENDIENTE → PUBLICADO | RECHAZADO", () => {
    let doc: Awaited<ReturnType<typeof nuevo>>;
    beforeAll(async () => {
      doc = await nuevo(T.eduardo, { titulo: "Documento del ciclo de vida", nivel: 2 });
    });
    const estado = async () => (await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } })).estado;

    test("enviar a aprobación: PENDIENTE", async () => {
      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).send({ enviar: true });
      expect(r.status).toBe(200);
      expect(await estado()).toBe("PENDIENTE");
    });

    test("enviar lo que ya está pendiente -> 409", async () => {
      expect((await api(T.eduardo).put(`/documentos/${doc.id}`).send({ enviar: true })).status).toBe(409);
    });

    test("la Supervisora lo aprueba: PUBLICADO, con aprobador y fecha", async () => {
      const r = await api(T.sara).post(`/documentos/${doc.id}/aprobar`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ estado: "PUBLICADO", aprobado_por: { nombre: "Sara Supervisora" } });
      expect(r.body.fecha_aprobacion).toEqual(expect.any(String));
    });

    test("aprobar lo que ya está publicado -> 409", async () => {
      expect((await api(T.sara).post(`/documentos/${doc.id}/aprobar`)).status).toBe(409);
    });

    test("modificar lo PUBLICADO lo devuelve a PENDIENTE y borra la aprobación (era del contenido anterior)", async () => {
      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).send({ titulo: "Documento del ciclo de vida (v2)" });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ estado: "PENDIENTE", aprobado_por: null, fecha_aprobacion: null });
    });

    test("el Gerente lo RECHAZA: RECHAZADO", async () => {
      const r = await api(T.gerente).post(`/documentos/${doc.id}/aprobar`).send({ decision: "RECHAZAR" });
      expect(r.status).toBe(200);
      expect(r.body.estado).toBe("RECHAZADO");
    });

    test("un RECHAZADO no se puede aprobar (409) y una decisión inválida es un 400", async () => {
      expect((await api(T.gerente).post(`/documentos/${doc.id}/aprobar`)).status).toBe(409);
      expect((await api(T.gerente).post(`/documentos/${doc.id}/aprobar`).send({ decision: "TAL_VEZ" })).status).toBe(400);
    });

    test("el autor lo reenvía: RECHAZADO → PENDIENTE", async () => {
      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).send({ enviar: true });
      expect(r.status).toBe(200);
      expect(await estado()).toBe("PENDIENTE");
    });

    test("aprobar un BORRADOR -> 409", async () => {
      const borrador = await nuevo(T.eduardo, { titulo: "Borrador que nadie envió", nivel: 1 });
      expect((await api(T.sara).post(`/documentos/${borrador.id}/aprobar`)).status).toBe(409);
    });

    test("dos aprobadores a la vez sobre el mismo documento: uno gana (200) y el otro recibe 409", async () => {
      const d = await nuevo(T.eduardo, { titulo: "Carrera de aprobadores", nivel: 1, enviar: true });
      const [a, b] = await Promise.all([api(T.sara).post(`/documentos/${d.id}/aprobar`), api(T.gerente).post(`/documentos/${d.id}/aprobar`)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("listas: cada usuario ve SOLO lo que las políticas le permiten leer (documentos sembrados)", () => {
    let vivos: string[];
    beforeAll(async () => {
      vivos = (await prisma.documento.findMany({ where: { titulo: { in: SEMBRADOS }, eliminado_en: null }, select: { titulo: true } })).map((d) => d.titulo);
    });
    const esperado = (...titulos: string[]) => titulos.filter((t) => vivos.includes(t)).sort();
    const vistos = async (token: string, filtros = "", entorno: Record<string, string> = {}) =>
      (await titulosVisibles(token, filtros, entorno)).filter((t) => SEMBRADOS.includes(t)).sort();

    const FIN = ["Presupuesto 2026", "Informe trimestral Q3", "Plan de inversiones", "Estados financieros auditados", "Propuesta de la supervisora", "Documento para eliminar"];

    test("Eduardo (FINANZAS, nivel 3)", async () =>
      expect(await vistos(T.eduardo)).toEqual(esperado("Presupuesto 2026", "Informe trimestral Q3", "Propuesta de la supervisora", "Documento para eliminar")));
    test("el Practicante (FINANZAS, nivel 2)", async () => expect(await vistos(T.practicante)).toEqual(esperado("Presupuesto 2026", "Documento para eliminar")));
    test("la Supervisora (FINANZAS, nivel 4)", async () =>
      expect(await vistos(T.sara)).toEqual(esperado("Presupuesto 2026", "Informe trimestral Q3", "Plan de inversiones", "Propuesta de la supervisora", "Documento para eliminar")));
    test("el Gerente (FINANZAS, nivel 5)", async () => expect(await vistos(T.gerente)).toEqual(esperado(...FIN)));
    test("la empleada de RRHH solo ve su Planilla", async () => expect(await vistos(T.rrhh)).toEqual(esperado("Planilla de sueldos")));
    test("el Admin y el Auditor (GLOBAL) ven todo", async () => {
      expect(await vistos(T.admin)).toEqual(esperado(...SEMBRADOS));
      expect(await vistos(T.auditor)).toEqual(esperado(...SEMBRADOS));
    });
    test("el Invitado solo ve lo de nivel 1 y publicado (P8)", async () => expect(await vistos(T.invitado)).toEqual(esperado("Manual de bienvenida")));

    test("el Gerente desde un dispositivo PERSONAL deja de ver los de nivel 4 y 5 (P6)", async () =>
      expect(await vistos(T.gerente, "", { "X-Dispositivo": "PERSONAL" })).toEqual(esperado("Presupuesto 2026", "Informe trimestral Q3", "Propuesta de la supervisora", "Documento para eliminar")));
    test("el Gerente a las 20:00 tampoco (P4)", async () =>
      expect(await vistos(T.gerente, "", { "X-Hora": "20:00" })).toEqual(esperado("Presupuesto 2026", "Informe trimestral Q3", "Propuesta de la supervisora", "Documento para eliminar")));
    test("desde CHILE nadie ve nada (todos los documentos son de PERU: P5)", async () => expect(await vistos(T.admin, "", { "X-Ubicacion": "CHILE" })).toEqual([]));
    test("sin ubicación informada tampoco (denegar por defecto)", async () => expect(await vistos(T.admin, "", { "X-Ubicacion": "" })).toEqual([]));

    test("un usuario inactivo (P7) y un invitado vencido (P9) reciben 403 en la lista", async () => {
      expect((await api(T.inactivo).get("/documentos")).body).toMatchObject({ etapa: "ESTADO", politica: "P7" });
      expect((await api(T.vencido).get("/documentos")).body).toMatchObject({ etapa: "ESTADO", politica: "P9" });
    });

    test("filtros: estado, texto y departamento", async () => {
      const pendientes = (await api(T.gerente).get("/documentos?estado=PENDIENTE&limite=100")).body.documentos;
      expect(pendientes.length).toBeGreaterThan(0);
      expect(pendientes.every((d: { estado: string }) => d.estado === "PENDIENTE")).toBe(true);
      expect(await vistos(T.gerente, "q=PLAN")).toEqual(esperado("Plan de inversiones")); // sin distinguir mayúsculas
      expect(await vistos(T.eduardo, "q=plan")).toEqual([]); // Eduardo no lo ve: P2 se lo oculta
      expect(await vistos(T.admin, "departamento=rrhh")).toEqual(esperado("Planilla de sueldos"));
    });

    test("paginación: limite=2 devuelve como mucho 2 y conserva el total; limite=1000 -> 400", async () => {
      const r = await api(T.gerente).get("/documentos?limite=2&pagina=1");
      expect(r.body.documentos.length).toBeLessThanOrEqual(2);
      expect(r.body).toMatchObject({ limite: 2, pagina: 1 });
      expect(r.body.total).toBeGreaterThan(2);
      expect((await api(T.gerente).get("/documentos?limite=1000")).status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("borrado lógico (papelera)", () => {
    let doc: Awaited<ReturnType<typeof nuevo>>;
    let clave: string;
    beforeAll(async () => {
      doc = await nuevo(T.eduardo, { titulo: "Documento para la papelera", nivel: 1 });
      clave = await claveDe(doc.id);
    });

    test("Eduardo y la Supervisora no pueden borrar (RBAC)", async () => {
      expect((await api(T.eduardo).delete(`/documentos/${doc.id}`)).body).toMatchObject({ etapa: "RBAC" });
      expect((await api(T.sara).delete(`/documentos/${doc.id}`)).body).toMatchObject({ etapa: "RBAC" });
    });

    test("el Gerente de FINANZAS lo borra: 204", async () => {
      expect((await api(T.gerente).delete(`/documentos/${doc.id}`)).status).toBe(204);
    });

    test("después: GET 404, descargar 404 y ya no sale en la lista", async () => {
      expect((await api(T.eduardo).get(`/documentos/${doc.id}`)).status).toBe(404);
      expect((await api(T.eduardo).get(`/documentos/${doc.id}/archivo`)).status).toBe(404);
      expect(await titulosVisibles(T.eduardo)).not.toContain("Documento para la papelera");
    });

    test("es lógico: la fila sigue en la BD con eliminado_en y el archivo sigue en MinIO", async () => {
      const fila = await prisma.documento.findUniqueOrThrow({ where: { id: doc.id } });
      expect(fila.eliminado_en).not.toBeNull();
      expect((await leerTodo(await storage.leer(clave))).length).toBeGreaterThan(0);
    });

    test("borrar dos veces -> 404", async () => {
      expect((await api(T.gerente).delete(`/documentos/${doc.id}`)).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("cuando algo falla a medias: sin huérfanos ni datos inconsistentes (fallos inyectados)", () => {
    beforeEach(() => {
      jest.spyOn(console, "error").mockImplementation(() => undefined); // el manejador de errores registra los 500
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("si la BD falla DESPUÉS de subir el archivo, el objeto se borra de MinIO: no queda huérfano", async () => {
      const guardar = jest.spyOn(storage, "guardar");
      jest.spyOn(prisma.documento, "create").mockRejectedValueOnce(new Error("la BD se cayó"));
      const antes = await prisma.documento.count();

      const r = await api(T.eduardo).post("/documentos").field("titulo", "Se cae la BD").field("nivel_confidencialidad", "1").attach("archivo", pdf, "a.pdf");

      expect(r.status).toBe(500);
      expect(r.body).toMatchObject({ error: "ERROR_INTERNO", mensaje: "Error interno del servidor" }); // sin detalles internos
      expect(await prisma.documento.count()).toBe(antes);
      expect(guardar).toHaveBeenCalledTimes(1);
      await expect(storage.leer(guardar.mock.calls[0][0])).rejects.toBeInstanceOf(ArchivoNoEncontrado);
    });

    test("si la BD falla al REEMPLAZAR un archivo, se borra el objeto nuevo y el anterior queda intacto", async () => {
      const doc = await crearDocumento(T.eduardo, { titulo: "Reemplazo que falla", nivel: 1 });
      const original = await claveDe(doc.id);
      const guardar = jest.spyOn(storage, "guardar");
      jest.spyOn(prisma.documento, "updateMany").mockRejectedValueOnce(new Error("la BD se cayó"));

      const r = await api(T.eduardo).put(`/documentos/${doc.id}`).attach("archivo", pngMuestra(), "nuevo.png");

      expect(r.status).toBe(500);
      expect(await claveDe(doc.id)).toBe(original); // la BD sigue apuntando al archivo de siempre
      expect((await leerTodo(await storage.leer(original))).length).toBeGreaterThan(0); // y ese archivo sigue ahí
      await expect(storage.leer(guardar.mock.calls[0][0])).rejects.toBeInstanceOf(ArchivoNoEncontrado); // el nuevo se borró
    });

    test("si MinIO no está disponible: 503 ALMACENAMIENTO_NO_DISPONIBLE y no se crea ningún documento", async () => {
      jest.spyOn(storage, "guardar").mockRejectedValueOnce(AppError.almacenamientoNoDisponible());
      const antes = await prisma.documento.count();

      const r = await api(T.eduardo).post("/documentos").field("titulo", "MinIO caído").field("nivel_confidencialidad", "1").attach("archivo", pdf, "a.pdf");

      expect(r.status).toBe(503);
      expect(r.body.error).toBe("ALMACENAMIENTO_NO_DISPONIBLE");
      expect(await prisma.documento.count()).toBe(antes);
    });

    test("si la BD dice que hay archivo pero el bucket no lo tiene: 404 ARCHIVO_NO_DISPONIBLE (integridad, no culpa del usuario)", async () => {
      const doc = await crearDocumento(T.eduardo, { titulo: "Archivo perdido", nivel: 1 });
      await storage.eliminar(await claveDe(doc.id));

      const r = await api(T.eduardo).get(`/documentos/${doc.id}/archivo`);

      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ error: "ARCHIVO_NO_DISPONIBLE", mensaje: "El archivo no está disponible en el almacenamiento" });
    });
  });

  // -------------------------------------------------------------------------------------------------
  describe("ids", () => {
    test.each([
      ["'abc'", "/documentos/abc", 400],
      ["-5", "/documentos/-5", 400],
      ["un id que no existe", "/documentos/99999999", 404],
    ])("GET %s -> %i", async (_c, ruta, status) => {
      expect((await api(T.eduardo).get(ruta)).status).toBe(status);
    });

    test("un inactivo recibe P7 aunque el id no exista: no puede averiguar qué documentos hay", async () => {
      expect((await api(T.inactivo).get("/documentos/99999999")).body).toMatchObject({ etapa: "ESTADO", politica: "P7" });
    });

    test("quien no tiene el permiso recibe RBAC aunque el id no exista (Eduardo intenta DELETE)", async () => {
      expect((await api(T.eduardo).delete("/documentos/99999999")).body).toMatchObject({ etapa: "RBAC" });
    });
  });

  // -------------------------------------------------------------------------------------------------
  test("INTEGRIDAD: todos los archivos subidos en esta suite coinciden en MinIO con el hash y el tamaño guardados", async () => {
    const filas = await prisma.documento.findMany({ where: { id: { in: conArchivo }, archivo_clave: { not: null } } });
    expect(filas.length).toBeGreaterThan(5);
    for (const f of filas) {
      const bytes = await leerTodo(await storage.leer(f.archivo_clave!));
      expect({ id: f.id, sha256: sha256(bytes), tamano: bytes.length }).toEqual({ id: f.id, sha256: f.archivo_sha256, tamano: f.archivo_tamano });
    }
  });
});
