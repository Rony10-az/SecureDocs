import { Router } from "express";
import { usuarioActual } from "../../auth/authenticate";
import { authorize, authorizeLista, authorizeSi } from "../../authorization/authorize";
import type { ActualizarUsuarioDto } from "./usuarios.schemas";
import { idDelRecurso } from "../comun";
import {
  cambiaElRol,
  cargarCandidatoUsuario,
  cargarUsuario,
  leerCambios,
  recursoYaCargado,
  type DatosAlta,
} from "./usuarios.recurso";
import { listaUsuariosSchema } from "./usuarios.schemas";
import { actualizarUsuario, crearUsuario, listarUsuarios, obtenerUsuario, serializarUsuario } from "./usuarios.service";

export const usuariosRouter = Router();

// Datos de personas: que ningún navegador ni proxy guarde copias
usuariosRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// GET /usuarios?q=&rol=&departamento=&estado=&tipo_contrato=&pagina=&limite=
usuariosRouter.get("/", ...authorizeLista("USER_MANAGE"), async (req, res) => {
  const filtros = listaUsuariosSchema.parse(req.query);
  res.json(await listarUsuarios({ usuario: usuarioActual(req), entorno: req.entorno }, filtros));
});

// POST /usuarios  ->  exige USER_MANAGE y, como se asigna un rol, también ROLE_ASSIGN (dos decisiones auditadas)
usuariosRouter.post(
  "/",
  ...authorize("USER_MANAGE", cargarCandidatoUsuario),
  ...authorizeSi("ROLE_ASSIGN", () => true, recursoYaCargado),
  async (req, res) => {
    const alta = res.locals.alta as DatosAlta;
    const creado = await crearUsuario({ usuario: usuarioActual(req), entorno: req.entorno }, alta);
    res.status(201).location(`/usuarios/${creado.id}`).json(serializarUsuario(creado));
  },
);

// GET /usuarios/:id
usuariosRouter.get("/:id", ...authorize("USER_MANAGE", cargarUsuario), async (req, res) => {
  res.json(serializarUsuario(await obtenerUsuario(idDelRecurso(req))));
});

// PUT /usuarios/:id  ->  USER_MANAGE; si cambia el rol, además ROLE_ASSIGN (y P11: nadie cambia su propio rol)
usuariosRouter.put(
  "/:id",
  ...authorize("USER_MANAGE", cargarUsuario),
  leerCambios,
  ...authorizeSi("ROLE_ASSIGN", cambiaElRol, recursoYaCargado),
  async (req, res) => {
    const cambios = res.locals.cambios as ActualizarUsuarioDto;
    const actualizado = await actualizarUsuario({ usuario: usuarioActual(req), entorno: req.entorno }, idDelRecurso(req), cambios);
    res.json(serializarUsuario(actualizado));
  },
);
