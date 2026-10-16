/** Las secciones del Reporte del día, nombradas por la pregunta que responden (spec
 *  2026-10-11). Una lista para las pestañas, la URL (`?section=`) y el Excel. */
export type ReportSection = 'summary' | 'assigned' | 'second_legs' | 'not_working' | 'carriers' | 'staffing'

export const REPORT_SECTIONS: { id: ReportSection; label: string }[] = [
  { id: 'summary', label: 'Resumen' },
  { id: 'assigned', label: 'Asignados' },
  { id: 'second_legs', label: 'Segundas vueltas' },
  { id: 'not_working', label: 'No trabajaron' },
  { id: 'carriers', label: 'Empresas' },
  { id: 'staffing', label: 'Dotación' },
]

/** El filtro de Cliente del Reporte en la URL (`f.client`): vale para todas sus
 *  secciones, así que sobrevive al cambiar de sección. */
export const REPORT_CLIENT_FILTER = 'client'

export function reportSectionOf(v: string | null): ReportSection {
  return REPORT_SECTIONS.find(s => s.id === v)?.id ?? 'summary'
}
