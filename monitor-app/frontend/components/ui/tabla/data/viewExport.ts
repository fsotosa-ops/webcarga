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

const escapar = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Lo que se ve de una tabla del kit, para pegar en un correo o un chat (como copia
 *  Google Sheets: dos formatos a la vez). El encabezado dice qué es y con qué recorte;
 *  el html es una tabla para el correo y el texto, una línea por fila para WhatsApp,
 *  que no muestra tablas. Sale de los datos de la vista, no de lo dibujado. */
export function viewForPasting<T>(model: DataTableModel<T>, title: string): {
  heading: string; text: string; html: string
} {
  const { columns, rows } = visibleTable(model)
  const heading = [title, ...activeFilterTexts(model), `${rows.length} ${rows.length === 1 ? 'fila' : 'filas'}`].join(' · ')
  const lineas = rows.map(r => r.filter(v => v !== null && v !== '').join(' · '))
  const html = `<p><b>${escapar(heading)}</b></p><table><thead><tr>${columns.map(c => `<th>${escapar(c.header)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map(r => `<tr>${r.map(v => `<td>${escapar(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  return { heading, text: [heading, '', ...lineas].join('\n'), html }
}
