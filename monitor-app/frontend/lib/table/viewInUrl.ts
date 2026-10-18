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

/** "Sin filtros, a propósito": en una tabla que abre con una vista inicial (Seguros ›
 *  Empresas abre en "No al día"), una URL sin vista vuelve a la inicial. Quien la vació
 *  deja esta marca, así Atrás o un marcador la encuentran vacía. */
const ALL_VIEW = { key: 'view', value: 'all' } as const
export const isAllView = (params: Pick<URLSearchParams, 'get'>) => params.get(ALL_VIEW.key) === ALL_VIEW.value
export function markAllView(params: URLSearchParams, on: boolean): URLSearchParams {
  if (on) params.set(ALL_VIEW.key, ALL_VIEW.value); else params.delete(ALL_VIEW.key)
  return params
}
type Leible = Pick<URLSearchParams, 'get' | 'forEach'>

/** Un valor escrito a mano en la URL ("50%") no viene codificado: se lee tal cual en
 *  vez de tumbar la pantalla con un URIError. */
function decodificar(v: string): string {
  try { return decodeURIComponent(v) } catch { return v }
}

export function readView(params: Leible): TableView {
  const filters: Record<string, string[]> = {}
  params.forEach((valor, clave) => {
    if (!clave.startsWith(PREFIJO) || !valor) return
    filters[clave.slice(PREFIJO.length)] = valor.split(',').map(decodificar)
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
