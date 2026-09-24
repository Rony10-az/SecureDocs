/** Lectura de las condiciones JSONB de las políticas: qué atributos comparan y sobre qué acciones actúan. */

/** Recorre una condición y junta los atributos (usuario.*, recurso.*, entorno.*) que compara, también los del lado derecho de `*Attr`. */
export function atributosDe(condicion, acumulado = new Set()) {
  if (Array.isArray(condicion)) condicion.forEach((c) => atributosDe(c, acumulado));
  else if (condicion && typeof condicion === "object") {
    for (const [clave, valor] of Object.entries(condicion)) {
      if (["all", "any", "si", "entonces"].includes(clave)) atributosDe(valor, acumulado);
      else {
        acumulado.add(clave);
        if (valor && typeof valor === "object") for (const [operador, comparado] of Object.entries(valor)) if (operador.endsWith("Attr") && typeof comparado === "string") acumulado.add(comparado);
      }
    }
  }
  return acumulado;
}

/** ¿La política actúa sobre acciones de documentos (o sobre todas)? */
export const actuaSobreDocumentos = (politica) => politica.acciones.includes("*") || politica.acciones.some((a) => a.startsWith("DOC_"));
