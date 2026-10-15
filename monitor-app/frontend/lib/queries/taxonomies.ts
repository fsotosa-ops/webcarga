/** La única clave de caché de un dominio de taxonomía. Había dos prefijos
 *  (`taxonomias` y `taxonomies`), y Configuración invalidaba solo uno: editar un
 *  subtipo no refrescaba el alta de flota ni el panel del equipo (D5, 14/10). */
export const taxonomyKey = (domain: string) => ['taxonomies', domain] as const
