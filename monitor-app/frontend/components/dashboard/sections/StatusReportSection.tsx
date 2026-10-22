'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, History, Printer, Copy, Check, RotateCw } from 'lucide-react'
import { statusReportApi } from '@/lib/api/statusReport'
import type { ClosureScope, FleetDriverGapRow, OperationTypeReport } from '@/lib/types'
import { hojaDeLaTabla, hojasDeLaSeccion, hojasDelReporte } from '@/lib/reporte/exportarReporte'
import { TIPOS_DE_OPERACION } from '@/lib/reporte/tiposDeOperacion'
import { REPORT_CLIENT_FILTER, REPORT_SECTIONS, type ReportSection } from '@/lib/reporte/secciones'
import { tripCodes } from '@/lib/tripRefs'
import { fleetGapShortfall } from '@/lib/cierre/closureNotices'
import { Tabs } from '@/components/ui/Tabs'
import { buttonClass } from '@/components/ui/Button'
import { TripCodeLinks } from '@/components/dashboard/TripCodeLinks'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable, type DataTableModel } from '@/components/ui/tabla/data/useDataTable'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { activeFilterTexts, visibleTable } from '@/components/ui/tabla/data/viewExport'
import type { TableView } from '@/lib/table/viewInUrl'
import { ReportDownloads } from './reporte/ReportDownloads'
import { ResumenImprimible } from './reporte/ResumenImprimible'
import { SeccionAsignados, SeccionNoTrabajaron, SeccionResumen, Vacio } from './reporte/SeccionesDelReporte'

/** Las acciones del Reporte: botones chicos del kit (y el enlace al histórico, que se ve igual). */
const ACCION = buttonClass({ size: 'sm' })
/** El Cliente del Reporte: un filtro que aplica el servidor (el informe se agrega allá). */
const CLIENTE = REPORT_CLIENT_FILTER

/** 2026-08-02 → 02/08, como lo escribe Operaciones en el correo del día. */
const diaYMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

/** El HTML a la vista, sin controles: en un correo, los botones del árbol se verían
 *  como botones y el chevron como un ícono suelto. Queda el texto de cada fila; lo
 *  marcado `data-no-copy` (la paginación de una tabla) no va. */
function paraPegar(nodo: HTMLElement): HTMLElement {
  const copia = nodo.cloneNode(true) as HTMLElement
  copia.querySelectorAll('svg, select, [data-no-copy]').forEach(n => n.remove())
  copia.querySelectorAll('button').forEach(boton => boton.replaceWith(boton.textContent ?? ''))
  return copia
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

interface Props {
  fecha:    string
  /** Qué se cierra (D1): el del Cierre; el Reporte ya no tiene selector propio. */
  alcance:  ClosureScope
  /** La sección a la vista; vive en la URL del Cierre (`?section=`). */
  section:  ReportSection
  onSectionChange: (section: ReportSection) => void
  /** El detalle de un viaje, con la vuelta a este Cierre. */
  tripHref: (tripId: string) => string
}

/** Reporte de estatus del día (Cierre › Reporte) con el patrón del Cierre (D3): el
 *  alcance de arriba, sus seis secciones, y la barra del kit donde "Cliente" es un
 *  filtro como los demás. Las secciones que son listas usan la tabla del kit; las que
 *  son tablas dinámicas con subtotales (Resumen, Asignados, No trabajaron) se quedan
 *  como tales. Solo lectura: "Confirmar cierre" vive en la página. */
export function StatusReportSection({ fecha, alcance, section, onSectionChange, tripHref }: Props) {
  const queryClient = useQueryClient()
  const [view, setView] = useUrlView()
  const clientes = view.filters[CLIENTE] ?? []
  // Lo que está a la vista, para "Copiar estatus": se pega tal cual en el correo o el
  // chat del día (minuta 09/10). Lo plegado no está en el DOM: se copia lo que se ve.
  const contenidoRef = useRef<HTMLDivElement>(null)
  const [copiado, setCopiado] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['status-report', fecha, clientes.join(',')],
    queryFn: () => statusReportApi.get(fecha, clientes),
  })
  // Sin datos de reemplazo mientras carga: mostrar el reporte de otro cliente bajo el
  // filtro nuevo (y dejar exportarlo) sería afirmar algo falso. Lo único que se
  // conserva son los clientes conocidos, para que el filtro no se vacíe al elegir.
  const [conocidos, setConocidos] = useState(data?.clients)
  if (data?.clients && data.clients !== conocidos) setConocidos(data.clients)
  const [nombres, setNombres] = useState<Record<string, string>>({})
  if (data?.clients?.some(c => nombres[c.shipper_id] !== c.client_name)) {
    setNombres(n => ({ ...n, ...Object.fromEntries(data.clients!.map(c => [c.shipper_id, c.client_name])) }))
  }

  const porTipo = data?.by_operation_type
  const reporte = porTipo?.[alcance]
  const faltante = data?.fleet_driver_gap
  const tipo = TIPOS_DE_OPERACION.find(t => t.clave === alcance)!
  const nombreDeSeccion = REPORT_SECTIONS.find(s => s.id === section)!.label

  // Cliente, declarado una vez para todas las secciones: sus valores son los del día
  // con la cifra del alcance a la vista (la misma de las tarjetas).
  const columnaCliente = useMemo<DataColumn<never>>(() => ({
    id: CLIENTE, header: 'Cliente', value: () => null, server: true,
    options: (conocidos ?? []).map(c => c.shipper_id),
    count: id => {
      const c = conocidos?.find(x => x.shipper_id === id)
      return c ? c.by_operation_type?.[alcance] ?? c.assigned : 0
    },
    label: id => nombres[id] ?? 'Cliente sin viajes este día',
  }), [conocidos, nombres, alcance])

  async function copiarEstatus() {
    const nodo = contenidoRef.current
    if (!nodo) return
    const encabezado = `Estatus del día ${diaYMes(fecha)} · ${tipo.etiqueta} · ${nombreDeSeccion}`
    const copia = paraPegar(nodo)
    const html = `<p><b>${encabezado}</b></p>${copia.innerHTML}`
    const texto = `${encabezado}\n\n${copia.innerText ?? copia.textContent ?? ''}`
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      })])
    } else {
      await navigator.clipboard.writeText(texto)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  /** "Todo el día": el reporte sin filtros, aunque haya un cliente elegido. */
  async function hojasDelDia() {
    const completo = clientes.length === 0 && data ? data : await queryClient.fetchQuery({
      queryKey: ['status-report', fecha, ''], queryFn: () => statusReportApi.get(fecha, []),
    })
    return hojasDelReporte(completo.by_operation_type!, completo.fleet_driver_gap)
  }

  /** Las acciones de la barra, con "lo que estás viendo" de la sección. */
  const acciones = (model: DataTableModel<unknown>, tabla: boolean) => {
    const filas = tabla ? model.rows.length : null
    const recorte = [tipo.etiqueta, nombreDeSeccion, ...activeFilterTexts(model),
      ...(filas === null ? [] : [plural(filas, 'fila', 'filas')])].join(' · ')
    const hojasVisibles = () => {
      if (tabla) {
        const { columns, rows } = visibleTable(model)
        return [hojaDeLaTabla(`${nombreDeSeccion} · ${tipo.corta}`, `Recorte: ${recorte}`, columns, rows)]
      }
      return section === 'staffing' || !reporte ? [] : hojasDeLaSeccion(section, reporte, alcance, `Recorte: ${recorte}`)
    }
    return (
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => window.print()} disabled={!porTipo} className={ACCION}
          title="Abre el diálogo de impresión — elige 'Guardar como PDF' para descargarlo">
          <Printer size={12} aria-hidden="true" /> Descargar PDF
        </button>
        <ReportDownloads disabled={!porTipo} recorte={recorte} className={ACCION}
          visible={{ hojas: hojasVisibles, archivo: `reporte_estatus_${fecha}_${alcance}_${section}.xlsx` }}
          day={{ hojas: hojasDelDia, archivo: `reporte_estatus_${fecha}.xlsx` }} />
        <button type="button" onClick={() => { void copiarEstatus() }} disabled={!reporte || section === 'staffing'}
          className={ACCION} title="Copia la sección a la vista, lista para pegar en un correo o un chat">
          {copiado ? <><Check size={12} aria-hidden="true" /> Copiado</> : <><Copy size={12} aria-hidden="true" /> Copiar estatus</>}
        </button>
        <Link href="/dashboard/analytics?dataset=fleet&mode=pivot&f.subject_type=DRIVER&period=this_month" target="_blank" className={ACCION}>
          <History size={12} aria-hidden="true" /> Ver histórico
        </Link>
      </span>
    )
  }

  // El cliente es un dato del viaje (decisión del usuario 11/10): lo que no tuvo viaje
  // no es de ningún cliente, y "no hay" sería falso.
  const sinClienteQueVer = clientes.length > 0 && (section === 'not_working' || section === 'staffing')
  const comun = { view, setView, columnaCliente, acciones }

  let cuerpo: ReactNode
  if (sinClienteQueVer) {
    cuerpo = <Barra {...comun}><Vacio>Lo que no tuvo viaje no es de ningún cliente. Quita el filtro de Cliente para verlo.</Vacio></Barra>
  } else if (section === 'staffing') {
    cuerpo = faltante === undefined ? <Barra {...comun}><Cargando /></Barra> : <TablaDeDotacion {...comun} rows={faltante} />
  } else if (isLoading) {
    cuerpo = <Barra {...comun}><Cargando /></Barra>
  } else if (isError) {
    cuerpo = (
      <Barra {...comun}>
        <div role="alert" className="flex items-center justify-center gap-3 py-16 text-dato text-informativo">
          No se pudo cargar el reporte.
          <button type="button" onClick={() => { void refetch() }} className={ACCION}>
            <RotateCw size={12} aria-hidden="true" /> Reintentar
          </button>
        </div>
      </Barra>
    )
  } else if (!reporte) {
    // Un backend anterior al rediseño todavía no manda `by_operation_type`.
    cuerpo = <Barra {...comun}><p role="status" className="py-16 text-center text-dato text-informativo">Actualizando el reporte…</p></Barra>
  } else if (section === 'second_legs') {
    cuerpo = <TablaDeSegundasVueltas {...comun} reporte={reporte} tipo={tipo.etiqueta} tripHref={tripHref} />
  } else if (section === 'carriers') {
    cuerpo = <TablaDeEmpresas {...comun} reporte={reporte} tipo={tipo.etiqueta} />
  } else {
    cuerpo = (
      <Barra {...comun}>
        {section === 'summary' && <SeccionResumen reporte={reporte} tipo={tipo} />}
        {section === 'assigned' && <SeccionAsignados reporte={reporte} tipo={tipo} tripHref={tripHref} />}
        {section === 'not_working' && <SeccionNoTrabajaron reporte={reporte} tipo={tipo} />}
      </Barra>
    )
  }

  return (
    <div className="space-y-4">
      {porTipo && <ResumenImprimible fecha={fecha} porTipo={porTipo} faltante={faltante}
        clientes={clientes.map(id => nombres[id] ?? id)} />}

      <div data-testid="report-body" className="space-y-3">
        <div className="print:hidden">
          <Tabs label="Secciones del reporte" value={section} onChange={onSectionChange}
            tabs={REPORT_SECTIONS.map(s => ({ id: s.id, label: s.label }))} />
        </div>
        <div ref={contenidoRef}>{cuerpo}</div>
      </div>
    </div>
  )
}

type Comun = {
  view: TableView
  setView: (v: TableView) => void
  columnaCliente: DataColumn<never>
  acciones: (model: DataTableModel<unknown>, tabla: boolean) => ReactNode
}

function Cargando() {
  return (
    <div className="flex items-center justify-center py-16 text-informativo">
      <Loader2 size={20} className="animate-spin" aria-label="Cargando" />
    </div>
  )
}

/** La barra de una sección que es tabla dinámica: solo el Cliente y las acciones. */
function Barra({ view, setView, columnaCliente, acciones, children }: Comun & { children: ReactNode }) {
  const model = useDataTable<unknown>({
    rows: [], columns: [columnaCliente as DataColumn<unknown>], getRowId: () => '', view, onViewChange: setView,
  })
  return (
    <div className="space-y-3">
      <div className="print:hidden" data-no-copy><TableToolbar model={model} actions={acciones(model, false)} /></div>
      {children}
    </div>
  )
}

/** Una sección que es una lista: la tabla del kit con su barra (C9). */
function TablaDelReporte<T>({ view, setView, columnaCliente, acciones, tableKey, rows, columns, getRowId, empty, search }: Comun & {
  tableKey: string
  rows: T[]
  columns: DataColumn<T>[]
  getRowId: (row: T) => string
  empty: string
  search: (row: T, q: string) => boolean
}) {
  const preferencias = useTablePreferences(tableKey)
  const model = useDataTable<T>({
    rows, columns: [...columns, columnaCliente as DataColumn<T>], getRowId, view, onViewChange: setView,
    columnPrefs: preferencias.columns, search, pageSize: 100,
  })
  return (
    <div className="space-y-3">
      <div className="print:hidden" data-no-copy>
        <TableToolbar model={model} searchPlaceholder="Buscar patente, conductor o empresa…" preferences={preferencias}
          actions={acciones(model as DataTableModel<unknown>, true)} />
      </div>
      <DataTable model={model} label={empty} empty={empty} />
    </div>
  )
}

type Vuelta = OperationTypeReport['second_legs'][number]

function TablaDeSegundasVueltas({ reporte, tipo, tripHref, ...comun }: Comun & {
  reporte: OperationTypeReport; tipo: string; tripHref: (id: string) => string
}) {
  const columnas = useMemo<DataColumn<Vuelta>[]>(() => [
    { id: 'plate', header: 'Patente', hideable: false, value: v => v.tractor_plate,
      render: v => <span className="font-identificador font-medium">{v.tractor_plate}</span> },
    { id: 'carrier', header: 'Empresa', value: v => v.carrier_name },
    { id: 'driver', header: 'Conductor', value: v => v.driver_name },
    { id: 'trip', header: 'Nº viaje', value: v => tripCodes(v.trips).join(', ') || null, values: v => tripCodes(v.trips),
      render: v => <TripCodeLinks trips={v.trips} href={tripHref} /> },
    { id: 'origin', header: 'Origen del viaje', value: v => v.origin },
    { id: 'zone', header: 'Tipo de destino', value: v => v.destination_zone },
    { id: 'legs', header: 'Vueltas', align: 'right', value: v => String(v.legs),
      render: v => <span className="font-bold text-accent">{v.legs}</span> },
  ], [tripHref])
  return (
    <TablaDelReporte {...comun} tableKey="closure.report.second_legs" rows={reporte.second_legs} columns={columnas}
      getRowId={v => v.tractor_plate} empty={`Ningún equipo de ${tipo} hizo una segunda vuelta`}
      search={(v, q) => [v.tractor_plate, v.carrier_name, v.driver_name, ...tripCodes(v.trips)].some(x => (x ?? '').toLowerCase().includes(q))} />
  )
}

type Empresa = OperationTypeReport['carriers'][number]

function TablaDeEmpresas({ reporte, tipo, ...comun }: Comun & { reporte: OperationTypeReport; tipo: string }) {
  const columnas = useMemo<DataColumn<Empresa>[]>(() => [
    { id: 'carrier', header: 'Empresa', hideable: false, value: e => e.carrier_name,
      render: e => <span className="font-medium">{e.carrier_name}</span> },
    { id: 'enrolled', header: 'Enrolados', align: 'right', value: e => String(e.enrolled) },
    { id: 'assigned', header: 'Asignados', align: 'right', value: e => String(e.assigned) },
    { id: 'unassigned', header: 'No asignados', align: 'right', value: e => String(e.unassigned) },
    { id: 'utilization', header: '% utilización', align: 'right', value: e => String(e.utilization_pct),
      render: e => <span className="font-bold text-accent">{e.utilization_pct}%</span> },
  ], [])
  return (
    <TablaDelReporte {...comun} tableKey="closure.report.carriers" rows={reporte.carriers} columns={columnas}
      getRowId={e => e.carrier_name} empty={`No hay empresas de ${tipo} enroladas`}
      search={(e, q) => e.carrier_name.toLowerCase().includes(q)} />
  )
}

function TablaDeDotacion({ rows, ...comun }: Comun & { rows: FleetDriverGapRow[] }) {
  const columnas = useMemo<DataColumn<FleetDriverGapRow>[]>(() => [
    { id: 'carrier', header: 'Empresa', hideable: false, value: r => r.business_name,
      render: r => <span className="font-medium">{r.business_name}</span> },
    { id: 'tractors', header: 'Tractos', align: 'right', value: r => String(r.n_tractos) },
    { id: 'drivers', header: 'Conductores', align: 'right', value: r => String(r.n_conductores) },
    { id: 'gap', header: 'Diferencia', align: 'right', value: r => String(r.gap),
      render: r => <span>{fleetGapShortfall(r)}</span> },
  ], [])
  return (
    <TablaDelReporte {...comun} tableKey="closure.report.staffing" rows={rows} columns={columnas}
      getRowId={r => r.carrier_id} empty="No hay empresas con desbalance de dotación"
      search={(r, q) => r.business_name.toLowerCase().includes(q)} />
  )
}
