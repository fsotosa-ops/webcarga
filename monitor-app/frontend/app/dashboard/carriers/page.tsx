'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search, Plus } from 'lucide-react'
import type { CarrierListFacets, CarrierOperationalStatus } from '@/lib/types'
import { carriersApi, type CarrierCreateResult } from '@/lib/api/carriers'
import { NewCarrierPanel } from '@/components/dashboard/NewCarrierPanel'
import { useTransporters } from '@/hooks/useTransporters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { CARRIER_LIFECYCLE_GROUP_LABELS, ENABLEMENT_GROUP_LABELS } from '@/lib/states'
import { TransporterCard } from '@/components/dashboard/TransporterCard'
import { CarriersTable } from '@/components/directory/CarriersTable'
import { ResultadosDelDirectorio } from '@/components/dashboard/ResultadosDelDirectorio'
import { ViewToggle, type ViewMode } from '@/components/dashboard/ViewToggle'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { directoryKeys, invalidateDirectory } from '@/lib/queries/directorio'
import { PageContainer } from '@/components/ui/PageContainer'
import { inputClass } from '@/components/ui/Field'


type TransporterTab = 'active' | 'legacy' | 'onboarding'
type EnablementTab = '' | 'enabled' | 'not_enabled'

const LIMIT = 100
const VIEW_MODE_STORAGE_KEY = 'empresas:vista'
const VIEW_LABELS = { tablero: 'Tarjetas', tabla: 'Tabla' }

/** Cada tab agrupa los `operational_status` que significan lo mismo para quien
 *  mira. Filtrar server-side, no sobre una sola página — 214 > el límite de 100
 *  por página del backend.
 *
 *  "Dadas de baja" manda LOS DOS estados de baja. `LEGACY_INACTIVE` es la empresa
 *  que llegó inactiva desde el padrón viejo; `INACTIVE` es la que alguien dio
 *  de baja desde la app. La distinción existe en la base y no le importa a
 *  nadie acá: hasta el 2026-09-07 la pestaña filtraba sólo la primera, así que
 *  el resumen de esta misma pantalla decía "214 inactivas" y la lista mostraba
 *  206 — y las 8 que faltaban eran justo las dadas de baja desde la app. Pablo,
 *  04/09: *"yo di de baja esa empresa y no aparece"*. Una de las 8 era la suya.
 *
 *  ONBOARDING (empresa creada sin tax_id) es la tercera tab. */
const TABS: { id: TransporterTab; label: string; status: CarrierOperationalStatus[] }[] = [
  { id: 'active',     label: CARRIER_LIFECYCLE_GROUP_LABELS.active,     status: ['ACTIVE'] },
  { id: 'legacy',     label: CARRIER_LIFECYCLE_GROUP_LABELS.inactive,   status: ['LEGACY_INACTIVE', 'INACTIVE'] },
  { id: 'onboarding', label: CARRIER_LIFECYCLE_GROUP_LABELS.onboarding, status: ['ONBOARDING'] },
]

/** Segundo eje, solo para las activas: Habilitada / No habilitada lo calcula la
 *  API (`compliance_summary.can_operate`, D-R6). Una empresa dada de baja o en
 *  onboarding no cuenta como "No habilitada" en una cola (spec §3). Los
 *  conteos vienen de `facets`, acotados a la pestaña y la búsqueda actuales
 *  (no cambian al elegir un filtro). */
const ENABLEMENT_TABS: { id: EnablementTab; label: string; facetKey: keyof CarrierListFacets }[] = [
  { id: '',            label: 'Todas',                             facetKey: 'total' },
  { id: 'not_enabled', label: ENABLEMENT_GROUP_LABELS.not_enabled, facetKey: 'not_enabled' },
  { id: 'enabled',     label: ENABLEMENT_GROUP_LABELS.enabled,     facetKey: 'enabled' },
]

export default function EmpresasTransportePage() {
  return (
    <Suspense fallback={null}>
      <EmpresasTransportePageInner />
    </Suspense>
  )
}

/** Ronda 43 (Hallazgo F): flujo de alta guiado desde el "Sin identificar"
 *  del Diario (TripSlideOver) — llega acá con `?create=1` (+ business_name/
 *  driver_name/tractor_plate ya reportados por el TMS) y abre el panel de
 *  "Nueva empresa" pre-cargado en vez de una búsqueda que no filtra por
 *  nombre de conductor. driver_name/tractor_plate se reenvían a la ficha de
 *  la empresa recién creada (ver handleAddCarrier) para pre-cargar también
 *  "+ Conductor"/"+ Equipo" ahí. */
function EmpresasTransportePageInner() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  // La lista con sus filtros: la ficha de cada empresa vuelve ahí (N3, Entrega 1 de fichas).
  const returnTo = searchParams.toString() ? `/dashboard/carriers?${searchParams.toString()}` : '/dashboard/carriers'
  const [q, setQ]                 = useState('')
  const [tab, setTab]             = useState<TransporterTab>('active')
  const [enablementTab, setEnablementTab] = useState<EnablementTab>('')
  const [page, setPage]           = useState(1)
  const [viewMode, setViewMode]   = useState<ViewMode>('tablero')
  const canEdit = usePermiso('directory.edit')
  const [addCarrierOpen, setAddCarrierOpen] = useState(searchParams.get('create') === '1')
  const qDebounced = useDebouncedValue(q, 300)


  /** Alta manual de una empresa (distinta del bulk-load de Mage) — el
   *  formulario en sí vive en NewCarrierPanel (reusado también desde
   *  Certificación); acá solo se decide qué pasa después de crear: redirige
   *  a la ficha recién creada, donde ya existen los flujos reales de alta
   *  de conductores/equipos/contactos/pólizas ("+ Conductor"/"+ Equipo"/
   *  "+ Póliza"), no hace falta duplicarlos acá. */
  async function handleCarrierCreated(created: CarrierCreateResult) {
    await invalidateDirectory(queryClient, { entity: 'carrier', id: created.id, type: 'create' })
    // Ronda 43 (Hallazgo F): si venimos del flujo guiado de "Sin
    // identificar", reenviar conductor/patente ya reportados por el TMS
    // para pre-cargar "+ Conductor"/"+ Equipo" en la ficha recién creada.
    const handoff = new URLSearchParams()
    const driverName = searchParams.get('driver_name')
    const tractorPlate = searchParams.get('tractor_plate')
    if (driverName)   handoff.set('driver_name', driverName)
    if (tractorPlate) handoff.set('tractor_plate', tractorPlate)
    const qs = handoff.toString()
    router.push(`/dashboard/carriers/${created.id}${qs ? `?${qs}` : ''}`)
  }

  const currentStatus = TABS.find(t => t.id === tab)!.status

  useEffect(() => { setEnablementTab('') }, [tab])

  useEffect(() => { setPage(1) }, [tab, enablementTab, qDebounced])

  const query = useTransporters({ q: qDebounced, operational_status: currentStatus, enablement: tab === 'active' ? enablementTab : '', page, limit: LIMIT })

  // El mismo texto busca las tres cosas. Con menos de dos letras no se pide
  // nada: el resultado seria el padron entero, que no es una respuesta.
  const busqueda = useQuery({
    queryKey: directoryKeys.search(qDebounced),
    queryFn: () => carriersApi.buscar(qDebounced),
    enabled: qDebounced.trim().length >= 2,
    staleTime: 30_000,
  })
  const items = useMemo(() => query.data?.data ?? [], [query.data])
  const tabTotal = query.data?.count ?? 0
  const loading  = query.isPending
  const fetching = query.isFetching
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando empresas') : null

  // Conteos por tab independientes de la paginación (limit=1: solo interesa
  // `count`) — derivados de TABS, no hardcodeados: agregar una tab nueva al
  // array la suma automáticamente acá sin tocar este bloque.
  const otherTabs = TABS.filter(t => t.id !== tab)
  const otherCountQueries = useQueries({
    queries: otherTabs.map(t => ({
      queryKey: directoryKeys.carrierCount(t.status, qDebounced),
      queryFn: () => carriersApi.list({ q: qDebounced, operational_status: t.status, limit: 1 }),
    })),
  })
  // facets.total = conteo real de la tab actual sin el filtro de habilitación
  // (a diferencia de tabTotal, que sí lo aplica) — así el badge de la tab no
  // cambia al elegir un filtro de habilitación.
  // `undefined` mientras la consulta está en vuelo: un "0" ahí afirma algo falso.
  const tabCounts: Record<TransporterTab, number | undefined> = TABS.reduce((acc, t) => {
    if (t.id === tab) {
      acc[t.id] = query.data?.facets.total
    } else {
      const idx = otherTabs.findIndex(ot => ot.id === t.id)
      acc[t.id] = otherCountQueries[idx]?.data?.count
    }
    return acc
  }, {} as Record<TransporterTab, number | undefined>)
  const grandTotal = TABS.reduce((sum, t) => sum + (tabCounts[t.id] ?? 0), 0)
  const countsReady = TABS.every(t => tabCounts[t.id] !== undefined)
  const badge = (n: number | undefined) => n === undefined ? undefined : String(n)

  const totalPages = Math.max(1, Math.ceil(tabTotal / LIMIT))

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (saved === 'tabla' || saved === 'tablero') setViewMode(saved)
  }, [])

  function handleViewModeChange(v: ViewMode) {
    setViewMode(v)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, v)
  }

  const emptyLabel = q ? 'Sin resultados' : `Sin empresas en ${TABS.find(t => t.id === tab)!.label.toLowerCase()}`

  return (
    <PageContainer>
      {/* La acción principal a la derecha del título (kit de fichas). */}
      <EncabezadoDePagina
        titulo="Empresas de Transporte"
        bajada={!countsReady ? '…' : `${grandTotal.toLocaleString('es-CL')} empresa${grandTotal !== 1 ? 's' : ''}`}
      >
        <ViewToggle value={viewMode} onChange={handleViewModeChange} labels={VIEW_LABELS} />
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddCarrierOpen(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90"
          >
            <Plus size={14} aria-hidden="true" /> Nueva empresa
          </button>
        )}
      </EncabezadoDePagina>

      <NewCarrierPanel
        open={addCarrierOpen}
        initialBusinessName={searchParams.get('business_name') ?? ''}
        onClose={() => setAddCarrierOpen(false)}
        onCreated={handleCarrierCreated}
      />

      {/* Dos ejes que no se mezclan, con el control segmentado del kit: el ciclo de
          vida (lo decide una persona) y, solo entre las activas, la habilitación (la
          calcula la API; una dada de baja no es "No habilitada", spec §3). */}
      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo pointer-events-none" aria-hidden="true" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Empresa, conductor o patente…"
            aria-label="Buscar empresa, conductor o patente"
            className={`${inputClass({ size: 'sm' })} pl-8 w-72 max-w-full`}
          />
        </div>
        <SegmentedControl
          label="Ciclo de vida"
          options={TABS.map(t => ({ id: t.id, label: t.label, badge: badge(tabCounts[t.id]) }))}
          value={tab}
          onChange={setTab}
        />
        {tab === 'active' && (
          <SegmentedControl
            label="Habilitación"
            options={ENABLEMENT_TABS.map(t => ({ id: t.id || 'all', label: t.label, badge: badge(query.data?.facets[t.facetKey]) }))}
            value={enablementTab || 'all'}
            onChange={id => setEnablementTab(id === 'all' ? '' : id as EnablementTab)}
          />
        )}
      </div>

      {busqueda.data && <ResultadosDelDirectorio datos={busqueda.data} />}

      {error ? (
        <Estado tipo="error" titulo="No se pudieron cargar las empresas" detalle={error} />
      ) : loading ? (
        <Estado tipo="cargando" />
      ) : items.length === 0 ? (
        <Estado tipo="vacio" titulo={emptyLabel} />
      ) : viewMode === 'tablero' ? (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          {items.map(item => <TransporterCard returnTo={returnTo} key={item.id} item={item} />)}
        </div>
      ) : (
        <div className={`transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          <CarriersTable items={items} returnTo={returnTo} />
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-informativo hover:border-accion disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={13} /> Anterior
          </button>
          <span className="text-xs text-informativo">Página {page} de {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-informativo hover:border-accion disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Siguiente <ChevronRight size={13} />
          </button>
        </div>
      )}
    </PageContainer>
  )
}
