import type { ReactNode } from 'react'
import type { SortDir } from '@/lib/table/viewInUrl'

/** Una columna de una tabla de datos del kit, declarada UNA vez por tabla: de
 *  aquí salen su filtro, su chip, su orden y su casilla en "Columnas" (Cierre con
 *  un solo patrón, spec §4.1). No hay una segunda lista de columnas en ningún lado.
 *
 *  - `value`: el texto con que la fila se filtra, se ordena y se cuenta.
 *  - `filter`: `values` (lista de valores, por defecto), `presence` (tiene / no
 *    tiene: Acción, Comentario) o `false`.
 *  - `options`: valores que el filtro ofrece aunque ninguna fila los tenga hoy (el
 *    glosario de un estado, el catálogo de CD).
 *  - `hideable: false`: la columna que identifica la fila; no se oculta. */
export type DataColumn<T> = {
  id: string
  header: string
  value: (row: T) => string | null
  render?: (row: T) => ReactNode
  filter?: 'values' | 'presence' | false
  options?: string[]
  sortable?: boolean
  hideable?: boolean
  defaultHidden?: boolean
  align?: 'left' | 'right'
}

/** Los dos valores de un filtro `presence` y cómo se dicen (filtro y chip). */
export const PRESENT = 'present'
export const ABSENT = 'absent'
export const PRESENCE_LABEL: Record<string, string> = { [PRESENT]: 'Tiene', [ABSENT]: 'No tiene' }

/** Cómo se dice un valor de una columna en el filtro y en su chip. */
export function valueLabel<T>(column: DataColumn<T> | undefined, value: string): string {
  return column?.filter === 'presence' ? PRESENCE_LABEL[value] ?? value : value
}

export function cellMatches<T>(column: DataColumn<T>, row: T, selected: readonly string[]): boolean {
  if (!selected.length) return true
  const v = column.value(row)
  if (column.filter === 'presence') {
    const tiene = v !== null && v.trim() !== ''
    return selected.includes(tiene ? PRESENT : ABSENT)
  }
  return v !== null && selected.includes(v)
}

/** Compara como lo haría una planilla: los números como números —"30179083"
 *  antes que "9"— y el resto alfabéticamente, sin distinguir tildes ni
 *  mayúsculas. Los vacíos van siempre al final, en las dos direcciones: un hueco
 *  no es "lo primero" ni "lo último", es la ausencia de dato. */
export function compareCells(a: string | null, b: string | null, dir: SortDir): number {
  const vacioA = !a, vacioB = !b
  if (vacioA && vacioB) return 0
  if (vacioA) return 1
  if (vacioB) return -1
  const signo = dir === 'asc' ? 1 : -1
  const na = Number(a), nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a!.trim() !== '' && b!.trim() !== '') {
    return (na - nb) * signo
  }
  return a!.localeCompare(b!, 'es', { sensitivity: 'base', numeric: true }) * signo
}
