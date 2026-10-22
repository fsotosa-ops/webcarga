'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileDown, Loader2, RefreshCw } from 'lucide-react'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { useDataTable, type ColumnPrefs } from '@/components/ui/tabla/data/useDataTable'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { Button } from '@/components/ui/Button'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import { ApiError } from '@/lib/api/client'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  DEFAULT_PERIOD, readPeriod, resolvePeriod, todayInChile, writePeriod, type DateField, type Period,
} from '@/lib/analytics/period'
import {
  analyticsApi, ExportTooLargeError, type AnalyticsColumnMeta, type AnalyticsDataset, type AnalyticsQuery,
  type AnalyticsRow, type SavedView, type SavedViewState,
} from '@/lib/api/analytics'
import type { PivotRow } from '@/lib/utils/pivot'
import { FleetPivot } from './FleetPivot'
import { PeriodPicker } from './PeriodPicker'
import { SavedViewsPanel } from './SavedViewsPanel'
import { SaveViewDialog } from './SaveViewDialog'
import { toDataColumns } from './analyticsColumns'

/** Analítica: la BDOT reconstruida (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md).
 *  Todo lo que define la vista vive en la URL: conjunto de datos, período, fecha, filtros, búsqueda y orden. */

export const DATASETS: { id: AnalyticsDataset; label: string; noun: string; dateFields: DateField[] }[] = [
  { id: 'trips', label: 'Viajes', noun: 'viajes', dateFields: ['planning', 'delivered', 'signed'] },
  { id: 'fleet', label: 'Flota por día', noun: 'registros', dateFields: ['business'] },
]
export const PAGE_SIZES = [50, 100, 200]
/** La tabla dinámica arma todo en el navegador: hasta 20.000 filas de una vez (lo mismo limita la API). */
const PIVOT_MAX = 20_000

/** Una fila de analytics.fleet_daily en lo que lee la tabla dinámica. */
const comoFilaDePivot = (r: AnalyticsRow): PivotRow => ({
  carrier_name: (r.carrier_name as string | null) ?? null,
  client_names: (r.client_names as string[] | null) ?? [],
  status: r.status as PivotRow['status'],
  unassigned_reason_label: (r.reason as string | null) ?? null,
  business_date: String(r.business_date),
})
const EXPORT_MAX = 50_000

const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/')
const horaChile = new Intl.DateTimeFormat('es-CL', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago',
})

/** Escribe parámetros de la URL sin navegar, como `useUrlView` (Next sincroniza useSearchParams). */
function writeParams(pathname: string, params: URLSearchParams) {
  const s = params.toString()
  window.history.replaceState(null, '', s ? `${pathname}?${s}` : pathname)
}

function Frescura({ loadedAt }: { loadedAt: string | null | undefined }) {
  if (!loadedAt) return null
  const cuando = new Date(loadedAt)
  const viejo = Date.now() - cuando.getTime() > 2 * 3600_000
  return (
    <span className={`text-etiqueta ${viejo ? 'text-status-pendiente font-semibold' : 'text-informativo'}`}
      title={viejo ? 'El modelo no se recarga hace más de dos horas' : 'Se recarga cada hora, a los :20'}>
      Datos al {horaChile.format(cuando)}
    </span>
  )
}

/** Las columnas de una vista guardada como preferencia de la tabla: las suyas visibles y en su orden, el resto
 *  oculto. "BDOT completo" (all_columns) = todas las del catálogo. Una columna que ya no existe se ignora (la
 *  tabla del kit no la encuentra). */
function columnasDeLaVista(v: SavedView, catalogo: AnalyticsColumnMeta[]): ColumnPrefs {
  // "Todas" = todas las que NO son personales (HU, criterio 10): un dato personal se elige a propósito.
  if (v.view.all_columns) return catalogo.map(c => ({ id: c.id, hidden: !!c.personal }))
  const propias = v.columns.filter(c => !c.hidden).map(c => ({ id: c.id, hidden: false }))
  const ids = new Set(propias.map(c => c.id))
  return [...propias, ...catalogo.filter(c => !ids.has(c.id)).map(c => ({ id: c.id, hidden: true }))]
}

/** Una vista en forma canónica para comparar: la base (jsonb) devuelve las claves de un objeto en otro orden
 *  ({"dir", "column"}), así que se compara por valores, no por el texto del objeto. */
function canonica(v: SavedViewState): string {
  const filtros = Object.keys(v.filters ?? {}).sort().map(k => [k, v.filters[k]])
  return JSON.stringify([filtros, v.q ?? '', v.sort ? [v.sort.column, v.sort.dir] : null,
    [v.period?.preset ?? null, v.period?.from ?? null, v.period?.to ?? null], v.date_field ?? null])
}
const mismaVista = (a: SavedViewState, b: SavedViewState) => canonica(a) === canonica(b)

/** Una vista (de la URL o guardada) sin lo que el catálogo de esta persona no tiene: una columna retirada, o una
 *  personal sin el permiso. Si no, la API responde 422 y la pantalla queda en "no se pudo" para siempre. */
function limpiarVista(v: TableView, catalogo: AnalyticsColumnMeta[]): TableView {
  const filtrables = new Set(catalogo.filter(c => c.filter === 'values').map(c => c.id))
  const existen = new Set(catalogo.map(c => c.id))
  return {
    filters: Object.fromEntries(Object.entries(v.filters ?? {}).filter(([k]) => filtrables.has(k))),
    q: v.q ?? '',
    sort: v.sort && existen.has(v.sort.column) ? v.sort : null,
  }
}

/** Descargar un archivo: el enlace va al documento y la URL se libera después (Safari y Firefox cancelaban la
 *  descarga si se revocaba al instante, con el enlace fuera del documento). */
function bajarArchivo(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function Aviso({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-2 py-2">
      <p>{children}</p>
      {action}
    </div>
  )
}

export function AnalyticsWorkspace() {
  const puedeLeer = usePermiso('analytics.read')
  if (!puedeLeer) {
    return <p className="rounded-xl border border-border bg-white px-4 py-6 text-center text-dato text-informativo">
      No tienes acceso a Analítica</p>
  }
  return <Workspace />
}

function Workspace() {
  const pathname = usePathname()
  const params = useSearchParams()
  const puedeDescargar = usePermiso('analytics.export')
  const puedeCompartir = usePermiso('analytics.manage_views')
  const qc = useQueryClient()
  const dataset: AnalyticsDataset = params.get('dataset') === 'fleet' ? 'fleet' : 'trips'
  const meta = DATASETS.find(d => d.id === dataset)!
  const { period, dateField: fechaEnUrl } = readPeriod(params)
  const dateField: DateField = fechaEnUrl && meta.dateFields.includes(fechaEnUrl) ? fechaEnUrl : meta.dateFields[0]
  const today = todayInChile()
  const rango = resolvePeriod(period, today)

  const [view, setView] = useUrlView()
  const [pagina, setPagina] = useState({ page: 0, size: PAGE_SIZES[0] })
  const [aviso, setAviso] = useState<string | null>(null)
  const [descargando, setDescargando] = useState(false)

  const columnas = useQuery({ queryKey: ['analytics-columns', dataset], queryFn: () => analyticsApi.columns(dataset),
    staleTime: 5 * 60_000 })
  const columns = useMemo(() => toDataColumns(columnas.data ?? []), [columnas.data])
  const preferenciasGuardadas = useTablePreferences(`analytics.${dataset}`)

  // La vista guardada activa (`vista=<id>` en la URL). Mientras está activa, sus columnas mandan; mover columnas
  // cambia la sesión, no las preferencias de la persona.
  const vistas = useQuery({ queryKey: ['analytics-views', dataset], queryFn: () => analyticsApi.views(dataset) })
  const activa = vistas.data?.find(v => v.id === params.get('vista')) ?? null
  const [columnasDeSesion, setColumnasDeSesion] = useState<ColumnPrefs | null>(null)
  const [guardandoVista, setGuardandoVista] = useState(false)
  const [renombrando, setRenombrando] = useState<SavedView | null>(null)
  const [borrando, setBorrando] = useState<SavedView | null>(null)
  const columnasActivas = activa ? (columnasDeSesion ?? columnasDeLaVista(activa, columnas.data ?? [])) : null
  const preferencias = activa
    ? { columns: columnasActivas, save: setColumnasDeSesion, reset: () => setColumnasDeSesion(null), ready: true }
    : preferenciasGuardadas

  // Tabla dinámica: solo en Flota por día (lo que era la Reportería).
  const modo: 'table' | 'pivot' = dataset === 'fleet' && params.get('mode') === 'pivot' ? 'pivot' : 'table'
  // La consulta nunca lleva un filtro o un orden que el catálogo de esta persona no tiene (Review Focus 3 y 4).
  const vistaDeConsulta = limpiarVista(view, columnas.data ?? [])
  const consulta: AnalyticsQuery = modo === 'pivot'
    ? { dataset, period, dateField, view: vistaDeConsulta, page: 0, size: PIVOT_MAX }
    : { dataset, period, dateField, view: vistaDeConsulta, page: pagina.page, size: pagina.size }
  const filas = useQuery({
    queryKey: ['analytics-rows', consulta, today, modo],
    queryFn: () => analyticsApi.rows(consulta, today, modo),
    enabled: columnas.isSuccess,
    placeholderData: keepPreviousData,
  })
  // Mientras llega la página nueva no se muestran cifras viejas (una cifra derivada no se muestra sin el dato).
  const listo = filas.isSuccess && !filas.isPlaceholderData

  const model = useDataTable<AnalyticsRow>({
    rows: filas.data?.rows ?? [], columns, getRowId: r => r._id, view, onViewChange: setView,
    columnPrefs: preferencias.columns ?? null,
    server: {
      total: listo ? filas.data!.total : null, counts: listo ? filas.data!.counts : null,
      page: pagina.page, pageSize: pagina.size, onPage: (page, size) => setPagina({ page, size }),
    },
  })

  function cambiarPeriodo(p: Period, f: DateField | null = fechaEnUrl) {
    setPagina(x => ({ ...x, page: 0 }))
    writeParams(pathname, writePeriod(new URLSearchParams(window.location.search), p, f))
  }

  const estadoActual: SavedViewState = { ...vistaDeConsulta, period, date_field: dateField,
    ...(modo === 'pivot' ? { mode: 'pivot' as const } : {}) }

  function aplicar(v: SavedView) {
    setPagina(x => ({ ...x, page: 0 }))
    setColumnasDeSesion(null)
    // Igual que al cambiar de conjunto: primero la vista (escribe desde la URL que conoce), después lo demás.
    const catalogo = v.dataset === dataset ? (columnas.data ?? []) : null
    const vista = { filters: v.view.filters ?? {}, q: v.view.q ?? '', sort: v.view.sort ?? null }
    setView(catalogo ? limpiarVista(vista, catalogo) : vista)
    const p = writePeriod(new URLSearchParams(window.location.search), v.view.period ?? DEFAULT_PERIOD,
      v.view.date_field ?? null)
    p.set('dataset', v.dataset)
    p.set('vista', v.id)
    if (v.view.mode === 'pivot') p.set('mode', 'pivot'); else p.delete('mode')
    writeParams(pathname, p)
  }

  const cambiada = !!activa && (!mismaVista(estadoActual, { ...activa.view,
    ...limpiarVista(activa.view, columnas.data ?? []),
    date_field: activa.view.date_field ?? DATASETS.find(d => d.id === activa.dataset)!.dateFields[0] })
    || (activa.view.mode === 'pivot') !== (modo === 'pivot') || columnasDeSesion !== null)

  const columnasVisibles = (): ColumnPrefs => model.visibleColumns.map(c => ({ id: c.id, hidden: false }))

  async function guardarCambios() {
    if (!activa) return
    setAviso(null)
    // "Todas las columnas" sigue siéndolo si no se movieron: así la vista suma las columnas nuevas del catálogo.
    const todas = !!activa.view.all_columns && columnasDeSesion === null
    try {
      const v = await analyticsApi.updateView(activa.id, {
        view: { ...estadoActual, ...(todas ? { all_columns: true } : {}) },
        columns: todas ? [] : columnasVisibles(),
      })
      qc.setQueryData<SavedView[]>(['analytics-views', dataset], xs => xs?.map(x => (x.id === v.id ? v : x)))
      setColumnasDeSesion(null)
    } catch {
      setAviso('No se pudieron guardar los cambios de la vista. Vuelve a intentarlo.')
    }
  }

  async function renombrar(name: string) {
    const v = await analyticsApi.updateView(renombrando!.id, { name })
    qc.setQueryData<SavedView[]>(['analytics-views', dataset], xs => xs?.map(x => (x.id === v.id ? v : x)))
  }

  async function borrar() {
    const id = borrando!.id
    await analyticsApi.deleteView(id)
    qc.setQueryData<SavedView[]>(['analytics-views', dataset], xs => xs?.filter(x => x.id !== id))
    if (activa?.id === id) {
      const p = new URLSearchParams(window.location.search)
      p.delete('vista')
      writeParams(pathname, p)
    }
  }

  async function guardarNueva(name: string, shared: boolean) {
    const v = await analyticsApi.createView({ dataset, name, scope: shared ? 'shared' : 'personal',
      view: estadoActual, columns: columnasVisibles() })
    qc.setQueryData<SavedView[]>(['analytics-views', dataset], xs => [...(xs ?? []), v])
    const p = new URLSearchParams(window.location.search)
    p.set('vista', v.id)
    writeParams(pathname, p)
    setColumnasDeSesion(null)
  }

  function cambiarModo(m: 'table' | 'pivot') {
    const p = new URLSearchParams(window.location.search)
    if (m === 'pivot') p.set('mode', 'pivot'); else p.delete('mode')
    writeParams(pathname, p)
  }

  function cambiarConjunto(id: AnalyticsDataset) {
    if (id === dataset) return
    setPagina(x => ({ ...x, page: 0 }))
    // Los filtros y la fecha de un conjunto no existen en el otro. Primero se vacía la vista (escribe la URL
    // desde la que conoce) y después el conjunto encima de esa URL: al revés, la vista borraba el conjunto.
    setView(EMPTY_VIEW)
    setColumnasDeSesion(null)
    const p = writePeriod(new URLSearchParams(window.location.search), period, null)
    p.set('dataset', id)
    p.delete('vista')
    p.delete('mode')
    writeParams(pathname, p)
  }

  async function descargar() {
    setAviso(null)
    setDescargando(true)
    try {
      const { blob, filename } = await analyticsApi.export(consulta, model.visibleColumns.map(c => c.id), today)
      bajarArchivo(blob, filename)
    } catch (e) {
      setAviso(e instanceof ExportTooLargeError
        ? `El período tiene ${e.total.toLocaleString('es-CL')} filas; el máximo por descarga es `
          + `${EXPORT_MAX.toLocaleString('es-CL')}. Acota el período o los filtros.`
        : 'No se pudo descargar el Excel. Vuelve a intentarlo.')
    } finally {
      setDescargando(false)
    }
  }

  const hayFiltros = Object.keys(view.filters).length > 0 || !!view.q
  const vacio = hayFiltros
    ? <Aviso action={<Button variant="link" onClick={() => setView(EMPTY_VIEW)}>Quitar filtros</Button>}>
        Ningún {dataset === 'trips' ? 'viaje' : 'registro'} cumple los filtros</Aviso>
    : <Aviso action={period.preset !== 'last_30d'
        ? <Button variant="link" onClick={() => cambiarPeriodo(DEFAULT_PERIOD)}>Ver los últimos 30 días</Button>
        : undefined}>
        {dataset === 'trips' && dateField === 'planning'
          ? `No hay viajes planificados entre el ${ddmmyyyy(rango.from)} y el ${ddmmyyyy(rango.to)}`
          : `No hay ${meta.noun} entre el ${ddmmyyyy(rango.from)} y el ${ddmmyyyy(rango.to)}`}
      </Aviso>

  // El límite se sabe antes de descargar: el total de la página ya está (HU, criterio 12).
  const demasiadas = listo && filas.data!.total > EXPORT_MAX
  const excel = (
    <Button disabled={!puedeDescargar || descargando || !listo || demasiadas}
      title={!puedeDescargar ? 'Pide a un supervisor que la descargue'
        : demasiadas ? `El período tiene ${filas.data!.total.toLocaleString('es-CL')} filas; el máximo por descarga es `
          + `${EXPORT_MAX.toLocaleString('es-CL')}. Acota el período o los filtros.` : undefined}
      onClick={() => { void descargar() }}>
      {descargando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        : <FileDown size={14} aria-hidden="true" />}
      Excel
    </Button>
  )

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <SavedViewsPanel views={vistas.data ?? []} activeId={activa?.id ?? null} onApply={aplicar}
        onNew={() => setGuardandoVista(true)} onRename={setRenombrando} onDelete={setBorrando} />
      {guardandoVista && <SaveViewDialog canShare={puedeCompartir} onClose={() => setGuardandoVista(false)}
        onSave={guardarNueva} />}
      {renombrando && <SaveViewDialog canShare={false} title="Renombrar vista" initialName={renombrando.name}
        onClose={() => setRenombrando(null)} onSave={name => renombrar(name)} />}
      {borrando && (
        <ConfirmDialog title={`Borrar la vista «${borrando.name}»`} confirmLabel="Borrar vista" tone="danger"
          description={borrando.scope === 'shared' ? 'La deja de ver todo el equipo.' : 'No se puede deshacer.'}
          errorFallback="No se pudo borrar la vista" onConfirm={borrar} onClose={() => setBorrando(null)} />
      )}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Conjunto de datos" className="inline-flex rounded-lg border border-border bg-white p-0.5">
            {DATASETS.map(d => (
              <button key={d.id} type="button" aria-pressed={d.id === dataset} onClick={() => cambiarConjunto(d.id)}
                className={`rounded-md px-3 py-1 text-dato font-medium ${d.id === dataset
                  ? 'bg-accent/10 text-text-primary' : 'text-informativo hover:text-text-primary'}`}>
                {d.label}
              </button>
            ))}
          </div>
          <PeriodPicker period={period} onPeriod={p => cambiarPeriodo(p)} dateField={dateField}
            onDateField={f => cambiarPeriodo(period, f)} dateFields={meta.dateFields} today={today} />
          {dataset === 'fleet' && (
            <div role="group" aria-label="Modo" className="hidden rounded-lg border border-border bg-white p-0.5 md:inline-flex">
              {([['table', 'Tabla'], ['pivot', 'Tabla dinámica']] as const).map(([m, etiqueta]) => (
                <button key={m} type="button" aria-pressed={m === modo} onClick={() => cambiarModo(m)}
                  className={`rounded-md px-3 py-1 text-dato font-medium ${m === modo
                    ? 'bg-accent/10 text-text-primary' : 'text-informativo hover:text-text-primary'}`}>
                  {etiqueta}
                </button>
              ))}
            </div>
          )}
          <Frescura loadedAt={filas.data?.loaded_at} />
          {cambiada && (
            <span className="inline-flex items-center gap-2">
              {activa!.can_edit && (
                <Button variant="primary" size="sm" onClick={() => { void guardarCambios() }}>Guardar cambios</Button>
              )}
              <Button size="sm" onClick={() => aplicar(activa!)}>Descartar</Button>
            </span>
          )}
        </div>

        {filas.isError || columnas.isError ? (
          <div className="flex items-center gap-3 rounded-lg border border-status-incidente/20 bg-status-incidente/5 px-4 py-3">
            <p className="flex-1 text-dato text-status-incidente">
              {/* Un 422 trae por qué (un período de más de 400 días): reintentar no lo arregla, decirlo sí. */}
              {filas.error instanceof ApiError && filas.error.status === 422 && typeof filas.error.detail === 'string'
                ? filas.error.detail : `No se pudieron cargar los ${meta.noun}`}</p>
            <button type="button" onClick={() => { void columnas.refetch(); void filas.refetch() }}
              className="inline-flex items-center gap-1.5 text-dato font-semibold text-status-incidente">
              <RefreshCw size={12} aria-hidden="true" /> Reintentar
            </button>
          </div>
        ) : modo === 'pivot' ? (
          <>
            <p className="text-dato text-informativo md:hidden">La tabla dinámica se usa en un computador: en el
              teléfono no cabe. Elige el modo Tabla para ver los registros.</p>
            <div className="hidden space-y-3 md:block">
              {/* Los filtros se ven y se quitan igual que en la tabla (la Reportería abre con "Conductores"). */}
              <TableToolbar model={model} />
              {!listo ? <p className="py-8 text-center text-dato text-informativo">Cargando…</p>
                : filas.data!.total > PIVOT_MAX
                  ? <p className="text-dato text-status-incidente">El período tiene {filas.data!.total.toLocaleString('es-CL')}
                      {' '}registros; la tabla dinámica arma hasta {PIVOT_MAX.toLocaleString('es-CL')}. Acota el período o los
                      filtros.</p>
                  : <FleetPivot rows={filas.data!.rows.map(comoFilaDePivot)}
                      filename={`tabla_dinamica_${rango.from}_${rango.to}.csv`} />}
            </div>
          </>
        ) : (
          <>
            <TableToolbar model={model} preferences={preferencias} actions={excel}
              searchPlaceholder={dataset === 'trips' ? 'Buscar Nº de viaje, patente o empresa…' : 'Buscar patente o empresa…'} />
            {aviso && <p role="alert" className="text-dato text-status-incidente">{aviso}</p>}
            <div className={filas.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
              <DataTable model={model} label={meta.label} pageSizes={PAGE_SIZES} stickyFirstColumn
                empty={listo ? vacio : null} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
