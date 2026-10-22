import type { FleetDriverGapRow, ClosureScope, OperationTypeReport, ReasonRow } from '@/lib/types'
import { COLUMNAS_DE_ZONA, arbolDeAsignados, filasDelArbol, type Cifras } from './arbolDeAsignados'
import { sumar } from './sumar'
import { TIPOS_DE_OPERACION } from './tiposDeOperacion'
import { REPORT_SECTIONS, type ReportSection } from './secciones'
import { tripCodes } from '@/lib/tripRefs'

type Valor = string | number | null
type Celda = Valor | { value: string | number; fontWeight: 'bold' }
type Fila = Celda[]

/** Una hoja del .xlsx: nombre y filas. */
export type HojaDeExcel = { sheet: string; data: Fila[] }

/** El nombre de una hoja como lo acepta Excel: sin []/\\:*? y de 31 caracteres como máximo
 *  (un título con fecha, "21/10", hacía fallar la descarga). */
const nombreDeHoja = (nombre: string) => nombre.replace(/[[\]/\\:*?]/g, '-').slice(0, 31).trim()

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
    ['Equipos activos', s.total], ['Asignados del día', s.assigned_today],
    ['En ruta desde días anteriores', s.multi_day.total], ['No trabajaron', s.not_working],
    ['% utilización', s.utilization_pct], [],
    ...Object.entries(s.multi_day.by_days_back).map(([dias, n]) => [`Hace ${dias} ${dias === '1' ? 'día' : 'días'}`, n]),
    [],
    negrita(['Cliente', 'Del día', 'En ruta']),
    ...s.by_client.map(c => [c.client_name, c.assigned_today, c.in_route]),
    negrita(['Total', sumar(s.by_client, c => c.assigned_today), sumar(s.by_client, c => c.in_route)]), [],
    negrita(['Origen habitual', 'Enrolados', 'Del día', 'En ruta']),
    ...s.by_home_origin.map(o => [o.origin, o.enrolled, o.assigned_today, o.in_route]),
    negrita(['Total', sumar(s.by_home_origin, o => o.enrolled), sumar(s.by_home_origin, o => o.assigned_today),
      sumar(s.by_home_origin, o => o.in_route)]),
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

/** Los conductores de Asignados con sus viajes del día (D8): la hoja de Asignados se
 *  queda como el CSV de Pablo, hasta la empresa, y los Nº de viaje van aquí. */
function conductores(r: OperationTypeReport): Fila[] {
  return [
    negrita(['Cliente', 'Origen', 'Empresa', 'Conductor', 'Patente', 'Nº viaje']),
    ...r.assigned.rows.flatMap(f => f.vehicles.map(v =>
      [f.client_name, f.origin, f.carrier_name, v.driver_name, v.tractor_plate, tripCodes(v.trips).join(', ') || null])),
  ]
}

function segundasVueltas(r: OperationTypeReport): Fila[] {
  return [
    negrita(['Patente', 'Empresa', 'Conductor', 'Nº viaje', 'Origen del viaje', 'Tipo de destino', 'Vueltas']),
    ...r.second_legs.map(v => [v.tractor_plate, v.carrier_name, v.driver_name, tripCodes(v.trips).join(', ') || null,
                               v.origin, v.destination_zone, v.legs]),
  ]
}

function noTrabajaron(r: OperationTypeReport, clave: ClosureScope): Fila[] {
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

type Hoja = { nombre: string; filas: (r: OperationTypeReport, clave: ClosureScope) => Fila[] }
const nombre = (id: ReportSection) => REPORT_SECTIONS.find(s => s.id === id)!.label

/** Las hojas de cada sección del informe, por tipo (Dotación es una sola, aparte). */
const HOJAS: Record<Exclude<ReportSection, 'staffing'>, Hoja[]> = {
  summary: [{ nombre: nombre('summary'), filas: resumen }],
  assigned: [{ nombre: nombre('assigned'), filas: asignados }, { nombre: 'Conductores', filas: conductores }],
  second_legs: [{ nombre: nombre('second_legs'), filas: segundasVueltas }],
  not_working: [{ nombre: nombre('not_working'), filas: noTrabajaron }],
  carriers: [{ nombre: nombre('carriers'), filas: empresas }],
}
const corta = (clave: ClosureScope) => TIPOS_DE_OPERACION.find(t => t.clave === clave)!.corta

/** "Todo el día": el reporte como hojas de Excel, los dos tipos aunque se esté viendo
 *  uno, porque Operaciones lo cruza con su planilla (spec 2026-10-11, §4). */
export function hojasDelReporte(
  porTipo: Record<ClosureScope, OperationTypeReport>, dotacion: FleetDriverGapRow[] | undefined,
): HojaDeExcel[] {
  const hojas: HojaDeExcel[] = Object.values(HOJAS).flat().flatMap(h => TIPOS_DE_OPERACION.map(t => ({
    sheet: `${h.nombre} · ${t.corta}`, data: h.filas(porTipo[t.clave], t.clave),
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

/** "Lo que estás viendo" de una sección del informe (C13): sus hojas del alcance a la
 *  vista, con el recorte escrito arriba. */
export function hojasDeLaSeccion(
  seccion: Exclude<ReportSection, 'staffing'>, reporte: OperationTypeReport, clave: ClosureScope, recorte: string,
): HojaDeExcel[] {
  return HOJAS[seccion].map(h => ({ sheet: nombreDeHoja(`${h.nombre} · ${corta(clave)}`), data: [[recorte], [], ...h.filas(reporte, clave)] }))
}

/** "Lo que estás viendo" de una tabla del kit (C13): sus columnas visibles en su
 *  orden y sus filas tal como pasan la vista, con el recorte escrito arriba. */
export function hojaDeLaTabla(
  sheet: string, recorte: string, columnas: { header: string; numeric?: boolean }[], filas: (string | null)[][],
): HojaDeExcel {
  return {
    sheet: nombreDeHoja(sheet),
    data: [
      [recorte], [],
      negrita(columnas.map(c => c.header)),
      ...filas.map(f => f.map((v, i) => (columnas[i].numeric && v !== null && v !== '' ? Number(v) : v))),
    ],
  }
}

/** Baja hojas como .xlsx (minuta 09/10, ítem 15). La librería se carga recién al hacer
 *  clic: no pesa en la pantalla para quien no exporta. */
export async function descargarExcel(hojas: HojaDeExcel[], archivo: string): Promise<void> {
  const { default: escribirExcel } = await import('write-excel-file/browser')
  await escribirExcel(hojas).toFile(archivo)
}
