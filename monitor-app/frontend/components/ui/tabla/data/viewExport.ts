import { valueLabel } from './columns'
import type { DataTableModel } from './useDataTable'

/** Los filtros activos de una tabla del kit con las mismas palabras de sus chips
 *  ("Empresa: Hasa, Huemul"), y la búsqueda. Lo usan la barra y el recorte que se
 *  escribe arriba de una descarga (C13): lo que dice el archivo es lo que se veía. */
export function activeFilterTexts<T>(model: DataTableModel<T>): string[] {
  const textos = Object.entries(model.view.filters).filter(([, v]) => v.length)
    .map(([id, valores]) => filterChipText(model, id, valores))
  return model.view.q ? [...textos, `Búsqueda: "${model.view.q}"`] : textos
}

/** El texto del chip de un filtro: "Empresa: Hasa, Huemul". */
export function filterChipText<T>(model: DataTableModel<T>, columnId: string, values: string[]): string {
  const c = model.columnById(columnId)
  return `${c?.header ?? columnId}: ${values.map(v => valueLabel(c, v)).join(', ')}`
}

/** Lo que se ve de una tabla del kit, para descargarlo (C13): las columnas visibles
 *  en el orden de la persona y todas las filas que pasan la vista (no solo la página). */
export function visibleTable<T>(model: DataTableModel<T>): {
  columns: { header: string; numeric: boolean }[]
  rows: (string | null)[][]
} {
  const columnas = model.visibleColumns
  return {
    columns: columnas.map(c => ({ header: c.header, numeric: c.align === 'right' })),
    rows: model.rows.map(r => columnas.map(c => c.value(r))),
  }
}
