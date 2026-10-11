import type { StatusReport, ZoneCrossTab } from '@/lib/types'

/** Las columnas de zona del reporte, en el orden en que se muestran. */
export const ZONE_COLS = ['RM', 'Z0', 'Región', 'Sin clasificar', 'total'] as const satisfies readonly (keyof ZoneCrossTab)[]

/** Suma de una columna numérica de un cross-tab: el pie de cada tabla (minuta 09/10,
 *  ítem 9), para que el número del reporte se compare de frente con el Excel de
 *  operaciones. Una sola definición para la pantalla y el Excel. */
export function sumar<T>(filas: T[], valor: (fila: T) => number | undefined): number {
  return filas.reduce((acc, f) => acc + (valor(f) ?? 0), 0)
}

type Fila = (string | number | null)[]

/** Una hoja del .xlsx: nombre y filas de valores simples. */
export type HojaDeExcel = { sheet: string; data: Fila[] }

const titulo = (texto: string): Fila => [texto]

/** Un cross-tab de zona con su fila de totales al pie. */
function tablaDeZonas(rows: ZoneCrossTab[], motivos: string[], conEmpresa: boolean): Fila[] {
  const cabecera = ['Origen', ...(conEmpresa ? ['Empresa'] : []), 'RM', 'Z0', 'Región', 'Sin clasificar', 'Total', ...motivos]
  const cuerpo = rows.map(r => [
    r.cd, ...(conEmpresa ? [r.carrier_name ?? ''] : []),
    ...ZONE_COLS.map(c => r[c] as number), ...motivos.map(m => r.sin_carga?.[m] ?? 0),
  ])
  const pie = [
    'Total', ...(conEmpresa ? [''] : []),
    ...ZONE_COLS.map(c => sumar(rows, r => r[c] as number)), ...motivos.map(m => sumar(rows, r => r.sin_carga?.[m])),
  ]
  return [cabecera, ...cuerpo, pie]
}

/** El reporte del día como hojas de Excel: una por sección, con los mismos nombres
 *  que las pestañas, para que lo que se ve y lo que se baja digan lo mismo. */
export function hojasDelReporte(report: StatusReport, fecha: string): HojaDeExcel[] {
  const s1 = report.section1_resumen
  const s2 = report.section2_tractoreo_asignado
  const motivos = s2.motivos_sin_carga ?? []
  const s4 = report.section4_tractoreo_no_trabajando
  const s6 = report.section6_resumen_general
  const utilizacion = (rows: StatusReport['section5_equipos_completos']): Fila[] => [
    ['Empresa', 'Enrolados', 'Asignados', 'No asignados', '% utilización'],
    ...rows.map(r => [r.carrier_name, r.enrolled, r.assigned, r.unassigned, r.utilization_pct]),
  ]
  const hojas: { sheet: string; filas: Fila[] }[] = [
    { sheet: '1. Resumen', filas: [
      titulo(`Reporte de estatus del día ${fecha}`), [],
      ['', 'Total', 'Asignados', 'No asignados', '% utilización'],
      ['Tractoreo', s1.tractoreo.total, s1.tractoreo.assigned, s1.tractoreo.unassigned, s1.tractoreo.utilization_pct],
      ['Equipo Completo', s1.equipos_completos.total, s1.equipos_completos.assigned, s1.equipos_completos.unassigned, s1.equipos_completos.utilization_pct],
      [], ['Total equipos activos', s1.total_equipos_activos],
    ] },
    { sheet: '2. Asignado', filas: [
      titulo('Tractoreo asignado por origen del viaje (sin carga: origen habitual)'),
      ...tablaDeZonas(s2.por_cd, motivos, false), [],
      titulo('Por empresa dentro de cada origen'),
      ...tablaDeZonas(s2.por_empresa_y_cd, motivos, true),
    ] },
    { sheet: '3. Vueltas', filas: [
      ['Patente', 'Empresa', 'Origen del viaje', 'Tipo de destino', 'Vueltas'],
      ...report.section3_vueltas.map(v => [v.tractor_plate, v.carrier_name, v.cd_origen, v.tipo_destino, v.vueltas]),
    ] },
    { sheet: '4. Sin trabajar', filas: [
      ['Conductor', 'Empresa', 'Origen habitual', 'Motivo', 'Tracto habitual', 'Tipo de operación'],
      ...s4.driver_detail.map(d => [d.full_name, d.carrier_name, d.cd_origen, d.unassigned_reason_label, d.tractor_plate, d.operation_type]),
    ] },
    { sheet: '5. Tractoreo — Empresas', filas: utilizacion(report.section_tractoreo_por_empresa) },
    { sheet: '6. Eq. Completos', filas: utilizacion(report.section5_equipos_completos) },
    { sheet: '7. General', filas: [
      titulo('Por origen habitual'), ['Origen habitual', 'Enrolados', 'Asignados'],
      ...s6.por_cd.map(c => [c.cd, c.enrolled, c.assigned]),
      ['Total', sumar(s6.por_cd, c => c.enrolled), sumar(s6.por_cd, c => c.assigned)], [],
      titulo('Cargaron en otro origen'), ['Patente', 'Empresa', 'Origen habitual', 'Cargó en', 'Generador de carga'],
      ...report.section7_desvios_de_cd.map(d => [d.tractor_plate ?? '', d.carrier_name ?? '', d.home_cd, d.origin_cd, d.client_name ?? '']), [],
      titulo('Por cliente'), ['Cliente', 'Asignados'],
      ...s6.por_cliente.map(c => [c.client_name, c.assigned]),
      ['Total', sumar(s6.por_cliente, c => c.assigned)],
    ] },
  ]
  return hojas.map(h => ({ sheet: h.sheet, data: h.filas.map(f => f.map(v => (v === '' ? null : v))) }))
}

/** Baja el reporte como .xlsx (minuta 09/10, ítem 15). La librería se carga recién
 *  al hacer clic: no pesa en la pantalla para quien no exporta. */
export async function descargarReporteExcel(report: StatusReport, fecha: string): Promise<void> {
  const { default: escribirExcel } = await import('write-excel-file/browser')
  await escribirExcel(hojasDelReporte(report, fecha)).toFile(`reporte_estatus_${fecha}.xlsx`)
}
