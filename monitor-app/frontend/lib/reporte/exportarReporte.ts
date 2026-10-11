import type { FleetDriverGapRow, OperationTypeKey, OperationTypeReport, ReasonRow } from '@/lib/types'
import { COLUMNAS_DE_ZONA, arbolDeAsignados, filasDelArbol, type Cifras } from './arbolDeAsignados'
import { sumar } from './sumar'
import { TIPOS_DE_OPERACION } from './tiposDeOperacion'

type Valor = string | number | null
type Celda = Valor | { value: string | number; fontWeight: 'bold' }
type Fila = Celda[]

/** Una hoja del .xlsx: nombre y filas. */
export type HojaDeExcel = { sheet: string; data: Fila[] }

/** Una fila de encabezado o de subtotal. */
const negrita = (fila: Valor[]): Fila =>
  fila.map(v => (v === null || v === '' ? null : { value: v, fontWeight: 'bold' as const }))

const zonas = (c: Cifras): number[] => COLUMNAS_DE_ZONA.map(z => c[z.clave])

function tablaDeMotivos(reasons: string[], rows: ReasonRow[]): Fila[] {
  return [
    negrita(['Origen', 'Empresa', ...reasons, 'Total']),
    ...rows.map(r => [r.origin, r.carrier_name, ...reasons.map(m => r.counts[m] ?? 0), r.total]),
    negrita(['Total', null, ...reasons.map(m => sumar(rows, r => r.counts[m])), sumar(rows, r => r.total)]),
  ]
}

function resumen(r: OperationTypeReport): Fila[] {
  const s = r.summary
  return [
    ['Equipos activos', s.total], ['Asignados', s.assigned], ['No trabajaron', s.not_working],
    ['% utilización', s.utilization_pct], [],
    ['Viajes de varios días', s.multi_day.total],
    ...Object.entries(s.multi_day.by_days_back).map(([dias, n]) => [`Hace ${dias} ${dias === '1' ? 'día' : 'días'}`, n]),
    [],
    negrita(['Cliente', 'Asignados']),
    ...s.by_client.map(c => [c.client_name, c.assigned]),
    negrita(['Total', sumar(s.by_client, c => c.assigned)]), [],
    negrita(['Origen habitual', 'Enrolados', 'Asignados']),
    ...s.by_home_origin.map(o => [o.origin, o.enrolled, o.assigned]),
    negrita(['Total', sumar(s.by_home_origin, o => o.enrolled), sumar(s.by_home_origin, o => o.assigned)]),
  ]
}

/** El CSV de Pablo: Cliente, Origen, Empresa y las zonas; los subtotales de
 *  cliente y origen en negrita, el total general al pie. */
function asignados(r: OperationTypeReport): Fila[] {
  const arbol = arbolDeAsignados(r.assigned.rows)
  // Hasta la empresa, como el CSV de Pablo: los conductores son para la pantalla.
  const cuerpo = filasDelArbol(arbol, (_clave, nivel) => nivel < 2).map(f => {
    const fila: Valor[] = [f.nivel === 0 ? f.etiqueta : null, f.nivel === 1 ? f.etiqueta : null,
                           f.nivel === 2 ? f.etiqueta : null, ...zonas(f.cifras)]
    return f.nivel < 2 ? negrita(fila) : fila
  })
  const sinAsignacion = r.worked_without_assignment
  const otroOrigen = r.assigned.other_origin
  return [
    negrita(['Cliente', 'Origen', 'Empresa', ...COLUMNAS_DE_ZONA.map(z => z.etiqueta)]),
    ...cuerpo,
    negrita(['Total', null, null, ...zonas(arbol.total)]),
    ...(sinAsignacion.rows.length > 0
      ? [[], negrita(['Trabajaron sin asignación']), ...tablaDeMotivos(sinAsignacion.reasons, sinAsignacion.rows)]
      : []),
    ...(otroOrigen.length > 0
      ? [[], negrita(['Cargaron en otro origen']),
         negrita(['Patente', 'Empresa', 'Origen habitual', 'Cargó en', 'Cliente']),
         ...otroOrigen.map(d => [d.tractor_plate, d.carrier_name, d.home_origin, d.origin, d.client_name])]
      : []),
  ]
}

function segundasVueltas(r: OperationTypeReport): Fila[] {
  return [
    negrita(['Patente', 'Empresa', 'Conductor', 'Origen del viaje', 'Tipo de destino', 'Vueltas']),
    ...r.second_legs.map(v => [v.tractor_plate, v.carrier_name, v.driver_name, v.origin, v.destination_zone, v.legs]),
  ]
}

function noTrabajaron(r: OperationTypeReport, clave: OperationTypeKey): Fila[] {
  const nw = r.not_working
  const detalle = clave === 'tractoreo'
    ? [negrita(['Conductor', 'Empresa', 'Origen habitual', 'Motivo', 'Tracto habitual']),
       ...nw.detail.map(d => [d.name, d.carrier_name, d.home_origin, d.reason, d.tractor_plate])]
    : [negrita(['Equipo', 'Empresa', 'Origen habitual', 'Motivo']),
       ...nw.detail.map(d => [d.name, d.carrier_name, d.home_origin, d.reason])]
  return [...tablaDeMotivos(nw.reasons, nw.by_reason), [], ...detalle]
}

function empresas(r: OperationTypeReport): Fila[] {
  return [
    negrita(['Empresa', 'Enrolados', 'Asignados', 'No asignados', '% utilización']),
    ...r.carriers.map(c => [c.carrier_name, c.enrolled, c.assigned, c.unassigned, c.utilization_pct]),
  ]
}

const SECCIONES: { nombre: string; filas: (r: OperationTypeReport, clave: OperationTypeKey) => Fila[] }[] = [
  { nombre: 'Resumen', filas: resumen },
  { nombre: 'Asignados', filas: asignados },
  { nombre: 'Segundas vueltas', filas: segundasVueltas },
  { nombre: 'No trabajaron', filas: noTrabajaron },
  { nombre: 'Empresas', filas: empresas },
]

/** El reporte del día como hojas de Excel. Trae los dos tipos aunque se esté
 *  viendo uno, porque Operaciones lo cruza con su planilla (spec 2026-10-11, §4). */
export function hojasDelReporte(
  porTipo: Record<OperationTypeKey, OperationTypeReport>, dotacion: FleetDriverGapRow[] | undefined,
): HojaDeExcel[] {
  const hojas: HojaDeExcel[] = SECCIONES.flatMap(s => TIPOS_DE_OPERACION.map(t => ({
    sheet: `${s.nombre} · ${t.corta}`, data: s.filas(porTipo[t.clave], t.clave),
  })))
  hojas.push({
    sheet: 'Dotación',
    data: dotacion === undefined
      ? [['La dotación no estaba cargada al descargar']]
      : [negrita(['Empresa', 'Tractos', 'Conductores', 'Diferencia']),
         ...dotacion.map(d => [d.business_name, d.n_tractos, d.n_conductores, d.gap])],
  })
  return hojas
}

/** Baja el reporte como .xlsx (minuta 09/10, ítem 15). La librería se carga recién
 *  al hacer clic: no pesa en la pantalla para quien no exporta. */
export async function descargarReporteExcel(
  porTipo: Record<OperationTypeKey, OperationTypeReport>, fecha: string, dotacion: FleetDriverGapRow[] | undefined,
): Promise<void> {
  const { default: escribirExcel } = await import('write-excel-file/browser')
  await escribirExcel(hojasDelReporte(porTipo, dotacion)).toFile(`reporte_estatus_${fecha}.xlsx`)
}
