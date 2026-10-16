/** La vista de una tabla de datos del kit (filtros, búsqueda, orden) en la URL:
 *  se comparte, recarga igual y "Volver" la restituye (Cierre con un solo patrón,
 *  spec §4.2). Un solo formato para todas las tablas: `f.<columna>=v1,v2` (cada
 *  valor codificado, así una coma dentro de un valor no lo parte), `q` y
 *  `sort=<columna>:<asc|desc>`. Los parámetros ajenos se conservan. */

export type SortDir = 'asc' | 'desc'
export type TableView = {
  filters: Record<string, string[]>
  q: string
  sort: { column: string; dir: SortDir } | null
}

export const EMPTY_VIEW: TableView = { filters: {}, q: '', sort: null }

const PREFIJO = 'f.'
type Leible = Pick<URLSearchParams, 'get' | 'forEach'>

export function readView(params: Leible): TableView {
  const filters: Record<string, string[]> = {}
  params.forEach((valor, clave) => {
    if (!clave.startsWith(PREFIJO) || !valor) return
    filters[clave.slice(PREFIJO.length)] = valor.split(',').map(decodeURIComponent)
  })
  const [column, dir] = (params.get('sort') ?? '').split(':')
  return {
    filters,
    q: params.get('q') ?? '',
    sort: column && (dir === 'asc' || dir === 'desc') ? { column, dir } : null,
  }
}

export function writeView(params: Pick<URLSearchParams, 'toString'>, view: TableView): URLSearchParams {
  const salida = new URLSearchParams(params.toString())
  for (const clave of [...salida.keys()]) if (clave.startsWith(PREFIJO)) salida.delete(clave)
  for (const [columna, valores] of Object.entries(view.filters)) {
    if (valores.length) salida.set(`${PREFIJO}${columna}`, valores.map(encodeURIComponent).join(','))
  }
  if (view.q) salida.set('q', view.q); else salida.delete('q')
  if (view.sort) salida.set('sort', `${view.sort.column}:${view.sort.dir}`); else salida.delete('sort')
  return salida
}
