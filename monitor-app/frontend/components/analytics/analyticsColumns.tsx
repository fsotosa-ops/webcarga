import type { DataColumn } from '@/components/ui/tabla/data/columns'
import type { AnalyticsColumnMeta, AnalyticsRow } from '@/lib/api/analytics'

/** El catálogo de la API (`GET /analytics/columns`) en columnas del kit de tabla. La lista de columnas vive una
 *  sola vez, en el backend (services/analytics_columns.py); aquí solo se dice cómo se ve cada tipo. */

const CHILE = 'America/Santiago'
const fechaHora = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: CHILE,
})
/** dd/mm/aaaa, como el resto de la app (Intl de es-CL escribe 22-10-2026). */
const ddmmaaaa = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

export function formatCell(valor: unknown, tipo: AnalyticsColumnMeta['type']): string | null {
  if (valor === null || valor === undefined || valor === '') return null
  switch (tipo) {
    // Una fecha llega como AAAA-MM-DD: se lee en UTC para no correrla un día.
    case 'date': return ddmmaaaa(String(valor))
    case 'datetime': return fechaHora.format(new Date(String(valor)))
    case 'bool': return valor ? 'Sí' : 'No'
    case 'list': return (valor as string[]).length ? (valor as string[]).join(', ') : null
    case 'number': return Number(valor).toLocaleString('es-CL')
    default: return String(valor)
  }
}

/** Un filtro de sí o no llega del servidor como 'true'/'false'. */
const etiquetaDeValor = (tipo: AnalyticsColumnMeta['type']) =>
  tipo === 'bool' ? (v: string) => (v === 'true' ? 'Sí' : v === 'false' ? 'No' : v) : undefined

export function toDataColumns(meta: AnalyticsColumnMeta[]): DataColumn<AnalyticsRow>[] {
  return meta.map((m, i) => ({
    id: m.id,
    header: m.label,
    value: (r: AnalyticsRow) => formatCell(r[m.id], m.type),
    filter: m.filter === 'values' ? 'values' : false,
    label: etiquetaDeValor(m.type),
    defaultHidden: !m.default_visible,
    // La primera (Nº de viaje, Día) identifica la fila: no se oculta.
    hideable: i !== 0,
    align: m.type === 'number' ? 'right' : undefined,
    // Una fila, una línea (como una sábana): el texto largo se corta y se lee completo al pasar el cursor.
    render: (r: AnalyticsRow) => {
      const texto = formatCell(r[m.id], m.type)
      if (texto === null) return <span className="text-informativo">—</span>
      return <span className="block max-w-[16rem] truncate whitespace-nowrap" title={texto}>{texto}</span>
    },
  }))
}
