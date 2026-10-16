/** Cómo se dicen las cifras de un cliente (Directorio › Clientes y su ficha). */

export const formatCount = (n: number) => n.toLocaleString('es-CL')

/** "1 empresa", "4 empresas". */
export const countOf = (n: number, singular: string, plural: string) => `${formatCount(n)} ${n === 1 ? singular : plural}`

/** "12 · 3 orígenes", o solo "12" si ninguno es de origen. Con `noun` (fuera
 *  de una columna "Lugares"): "12 lugares · 3 orígenes". */
export function placesLabel(c: { locations: number; origins: number }, { noun = false } = {}): string {
  const lugares = noun ? countOf(c.locations, 'lugar', 'lugares') : formatCount(c.locations)
  if (c.origins === 0) return lugares
  return `${lugares} · ${c.origins === 1 ? '1 origen' : `${formatCount(c.origins)} orígenes`}`
}
