'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FileDown, Loader2, RefreshCw } from 'lucide-react'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { Button } from '@/components/ui/Button'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { EMPTY_VIEW } from '@/lib/table/viewInUrl'
import {
  DEFAULT_PERIOD, readPeriod, resolvePeriod, todayInChile, writePeriod, type DateField, type Period,
} from '@/lib/analytics/period'
import {
  analyticsApi, ExportTooLargeError, type AnalyticsDataset, type AnalyticsQuery, type AnalyticsRow,
} from '@/lib/api/analytics'
import { PeriodPicker } from './PeriodPicker'
import { toDataColumns } from './analyticsColumns'

/** Analítica: la BDOT reconstruida (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md).
 *  Todo lo que define la vista vive en la URL: conjunto de datos, período, fecha, filtros, búsqueda y orden. */

export const DATASETS: { id: AnalyticsDataset; label: string; noun: string; dateFields: DateField[] }[] = [
  { id: 'trips', label: 'Viajes', noun: 'viajes', dateFields: ['planning', 'delivered', 'signed'] },
  { id: 'fleet', label: 'Flota por día', noun: 'registros', dateFields: ['business'] },
]
export const PAGE_SIZES = [50, 100, 200]
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

function Aviso({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-2 py-2">
      <p>{children}</p>
      {action}
    </div>
  )
}

export function AnalyticsWorkspace({ aside }: { aside?: ReactNode } = {}) {
  const puedeLeer = usePermiso('analytics.read')
  if (!puedeLeer) {
    return <p className="rounded-xl border border-border bg-white px-4 py-6 text-center text-dato text-informativo">
      No tienes acceso a Analítica</p>
  }
  return <Workspace aside={aside} />
}

function Workspace({ aside }: { aside?: ReactNode }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const puedeDescargar = usePermiso('analytics.export')
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
  const preferencias = useTablePreferences(`analytics.${dataset}`)

  const consulta: AnalyticsQuery = { dataset, period, dateField, view, page: pagina.page, size: pagina.size }
  const filas = useQuery({
    queryKey: ['analytics-rows', consulta, today],
    queryFn: () => analyticsApi.rows(consulta, today),
    enabled: columnas.isSuccess,
    placeholderData: keepPreviousData,
  })
  // Mientras llega la página nueva no se muestran cifras viejas (una cifra derivada no se muestra sin el dato).
  const listo = filas.isSuccess && !filas.isPlaceholderData

  const model = useDataTable<AnalyticsRow>({
    rows: filas.data?.rows ?? [], columns, getRowId: r => r._id, view, onViewChange: setView,
    columnPrefs: preferencias.columns,
    server: {
      total: listo ? filas.data!.total : null, counts: listo ? filas.data!.counts : null,
      page: pagina.page, pageSize: pagina.size, onPage: (page, size) => setPagina({ page, size }),
    },
  })

  function cambiarPeriodo(p: Period, f: DateField | null = fechaEnUrl) {
    setPagina(x => ({ ...x, page: 0 }))
    writeParams(pathname, writePeriod(new URLSearchParams(params.toString()), p, f))
  }

  function cambiarConjunto(id: AnalyticsDataset) {
    if (id === dataset) return
    setPagina(x => ({ ...x, page: 0 }))
    // Los filtros y la fecha de un conjunto no existen en el otro. Primero se vacía la vista (escribe la URL
    // desde la que conoce) y después el conjunto encima de esa URL: al revés, la vista borraba el conjunto.
    setView(EMPTY_VIEW)
    const p = writePeriod(new URLSearchParams(window.location.search), period, null)
    p.set('dataset', id)
    writeParams(pathname, p)
  }

  async function descargar() {
    setAviso(null)
    setDescargando(true)
    try {
      const { blob, filename } = await analyticsApi.export(consulta, model.visibleColumns.map(c => c.id), today)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
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

  const excel = (
    <Button disabled={!puedeDescargar || descargando || !listo}
      title={puedeDescargar ? undefined : 'Pide a un supervisor que la descargue'}
      onClick={() => { void descargar() }}>
      {descargando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        : <FileDown size={14} aria-hidden="true" />}
      Excel
    </Button>
  )

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {aside}
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
          <Frescura loadedAt={filas.data?.loaded_at} />
        </div>

        {filas.isError || columnas.isError ? (
          <div className="flex items-center gap-3 rounded-lg border border-status-incidente/20 bg-status-incidente/5 px-4 py-3">
            <p className="flex-1 text-dato text-status-incidente">
              No se pudieron cargar los {meta.noun}</p>
            <button type="button" onClick={() => { void columnas.refetch(); void filas.refetch() }}
              className="inline-flex items-center gap-1.5 text-dato font-semibold text-status-incidente">
              <RefreshCw size={12} aria-hidden="true" /> Reintentar
            </button>
          </div>
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
