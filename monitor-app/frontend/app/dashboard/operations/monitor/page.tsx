'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X, ClipboardCheck, Truck } from 'lucide-react'
import { filterGroupsApi, type FilterGroup } from '@/lib/api/filterGroups'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { tripsApi, type TripListResponse } from '@/lib/api/trips'
import type { Trip, TripsMeta } from '@/lib/types'
import { TripTable } from '@/components/dashboard/TripTable'
import { TripBoard } from '@/components/dashboard/TripBoard'
import { ViewToggle, type ViewMode } from '@/components/dashboard/ViewToggle'
import { GroupBuilder } from '@/components/dashboard/GroupBuilder'
import { FilterPopover } from '@/components/dashboard/FilterPopover'
import { PaginationControls } from '@/components/dashboard/PaginationControls'
import { TripAssignDialog } from '@/components/dashboard/TripAssignDialog'
import { TripBulkUpload } from '@/components/dashboard/TripBulkUpload'
import { FleetCenterDialog } from '@/components/dashboard/FleetCenterDialog'
import type { FleetAssignValue } from '@/components/dashboard/FleetAssignSection'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useTrips, type TripListParams } from '@/hooks/useTrips'
import { useDiarioFilters, countActiveFilters } from '@/hooks/useDiarioFilters'
import { formatRelativeTime } from '@/lib/utils/datetime'
import { DEFAULT_ALERT_RULES } from '@/lib/utils/kpis'
import {
  alertSignalDefs, computeSignalCounts, matchesActiveSignals, severityBand,
} from '@/lib/utils/alertSignals'
import { usePinnedAlertSignals } from '@/hooks/usePinnedAlertSignals'
import { AlertsPopover } from '@/components/dashboard/AlertsPopover'
import { Estado } from '@/components/ui/Estado'

const VIEW_MODE_STORAGE_KEY = 'diario:vista-en-curso'

// ── Group display config (labels + chip colors only — membership comes from meta.statuses) ──
const GROUP_DISPLAY: Record<string, { label: string; on: string; off: string }> = {
  en_ruta:    { label: 'En Ruta',    on: 'bg-blue-500   border-blue-500   text-white', off: 'text-blue-600   border-blue-200   bg-blue-50/70   hover:border-blue-300'   },
  en_local:   { label: 'En Local',   on: 'bg-orange-500 border-orange-500 text-white', off: 'text-orange-600 border-orange-200 bg-orange-50/70 hover:border-orange-300' },
  retornando: { label: 'Retornando', on: 'bg-cyan-500   border-cyan-500   text-white', off: 'text-cyan-700   border-cyan-200   bg-cyan-50/70   hover:border-cyan-300'   },
  cerrado:    { label: 'Cerrados',   on: 'bg-slate-500  border-slate-500  text-white', off: 'text-slate-600  border-slate-200  bg-slate-50/70  hover:border-slate-300'  },
  problema:   { label: 'Problema',   on: 'bg-red-500    border-red-500    text-white', off: 'text-red-600    border-red-200    bg-red-50/70    hover:border-red-300'     },
  otro:       { label: 'Otro',       on: 'bg-gray-500   border-gray-500   text-white', off: 'text-gray-600   border-gray-200   bg-gray-50/70   hover:border-gray-300'    },
}

const GROUP_ORDER = ['en_ruta', 'en_local', 'retornando', 'cerrado', 'problema', 'otro']

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

// Se re-renderiza solo (tick) para que "hace X" no quede congelado entre polls
function LastUpdated({ updatedAt, fetching }: { updatedAt: number; fetching: boolean }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  if (!updatedAt) return null
  return (
    <span className="text-[10px] text-gray-300 whitespace-nowrap">
      {fetching
        ? 'Actualizando…'
        : `Actualizado ${formatRelativeTime(new Date(updatedAt).toISOString())}`}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function DiarioPage() {
  const [f, dispatch] = useDiarioFilters()

  const [tripsMeta,      setTripsMeta]      = useState<TripsMeta | null>(null)
  const [showCreate,      setShowCreate]      = useState(false)
  const [showBulkUpload,  setShowBulkUpload]  = useState(false)
  const [showFleetCenter, setShowFleetCenter] = useState(false)
  const [prefillFleet,    setPrefillFleet]    = useState<FleetAssignValue | null>(null)
  const [viewMode,        setViewMode]        = useState<ViewMode>('tabla')
  // Bug 5.5: preferencia de visualización, no un filtro — no entra al
  // reducer de useDiarioFilters (no debe contarse en countActiveFilters/clear).
  const [historialPageSize, setHistorialPageSize] = useState(100)

  // Custom groups
  const [customGroups,      setCustomGroups]      = useState<FilterGroup[]>([])
  const [showBuilder,       setShowBuilder]       = useState(false)
  const [editingGroup,      setEditingGroup]      = useState<FilterGroup | undefined>(undefined)
  const [prefillFromFilter, setPrefillFromFilter] = useState(false)

  // Debounce de la búsqueda: no disparar un fetch por cada tecla
  const qDebounced = useDebouncedValue(f.q, 300)

  // "En Curso" ya no navega por fecha (2026-08-02) — is_active es el
  // criterio principal. `today` sigue haciendo falta para Centro de
  // Flota/Cerrar el día/Nuevo viaje, que sí son conceptos de "hoy".
  // Se recalcula en cada render (no queda pegado si la pestaña sigue
  // abierta después de medianoche).
  const today = todayISO()

  // Derive default filter groups from meta.statuses (group membership comes from DB)
  const defaultGroups = useMemo(() => {
    if (!tripsMeta?.statuses?.length) return []
    const grouped: Record<string, string[]> = {}
    for (const s of tripsMeta.statuses) {
      const g = s.group ?? 'otro'
      if (!grouped[g]) grouped[g] = []
      grouped[g].push(s.id)
    }
    return GROUP_ORDER
      .filter(g => grouped[g]?.length > 0)
      .map(g => ({
        id:       g,
        statuses: grouped[g],
        ...(GROUP_DISPLAY[g] ?? { label: g, on: GROUP_DISPLAY.otro.on, off: GROUP_DISPLAY.otro.off }),
      }))
  }, [tripsMeta?.statuses])

  // Resolve active group statuses
  const statusParam = (() => {
    if (!f.activeGroup) return ''
    if (f.activeGroup.startsWith('default:')) {
      const id = f.activeGroup.slice(8)
      return defaultGroups.find(g => g.id === id)?.statuses.join(',') ?? ''
    }
    // custom:uuid
    const id = f.activeGroup.slice(7)
    return customGroups.find(g => g.id === id)?.statuses.join(',') ?? ''
  })()

  const activeCount = countActiveFilters(f)

  // ── Data: TanStack Query + polling (60s, solo En Curso) ─────────────────────
  const boolParams = {
    ...(f.activeSignals.includes('active')          ? { is_active:        true } : {}),
    ...(f.activeSignals.includes('working')         ? { is_working:       true } : {}),
    ...(f.activeSignals.includes('assigned')        ? { is_assigned:      true } : {}),
    ...(f.activeSignals.includes('second_leg_plus') ? { second_leg_plus:  true } : {}),
  }
  // Default: viaje más recientemente reportado por el TMS primero (bug
  // 5.6) — aplica a En Curso e Historial por igual, confirmado con el
  // usuario. El backend sigue defaulteando a planning_date si no viene
  // sort_by (contrato sin cambios), este default nuevo vive acá.
  const sortParams = { sort_by: f.sortKey ?? 'status_reported_at', sort_dir: f.sortDir }
  const catalogFilterParams = {
    client:     f.fClient.join(','),
    cargo_type: f.fCargoType.join(','),
    origin:     f.fOrigin.join(','),
  }
  const params: TripListParams =
    f.tab === 'en_curso'
      // is_active:true es el criterio principal de "En Curso" (2026-08-02,
      // reemplaza al filtro por planning_date exacto) — se fuerza DESPUÉS
      // de boolParams para que nunca dependa de que el usuario active el
      // toggle "Activo" del popover de alertas: acá siempre es implícito.
      ? { view: 'en_curso', ...boolParams, is_active: true, q: qDebounced, status: statusParam,
          tms: f.fTms.join(','), ...catalogFilterParams, ...sortParams, limit: 200 }
      : { view: 'historial', q: qDebounced, fecha_desde: f.fechaDesde, fecha_hasta: f.fechaHasta,
          status: statusParam, tms: f.fTms.join(','), ...catalogFilterParams, ...sortParams,
          limit: historialPageSize, page: f.page, ...boolParams }

  const queryClient = useQueryClient()
  const router       = useRouter()
  const pathname      = usePathname()
  // Mientras el overlay interceptado está abierto, la URL real de este mismo
  // árbol de React sigue siendo /monitor/trips/[id] (Next.js actualiza el
  // router context aunque este componente monte por el slot `children`, no
  // por `@modal`) — se usa para resaltar la fila abierta en la tabla, mismo
  // rol que cumplía `selected?.id` antes.
  const openTripId = pathname.match(/\/trips\/([^/?]+)/)?.[1] ?? null
  const tripsQuery  = useTrips(params, { poll: f.tab === 'en_curso' })

  const trips    = tripsQuery.data?.data ?? []
  const total    = tripsQuery.data?.count ?? 0
  const loading  = tripsQuery.isPending
  const fetching = tripsQuery.isFetching
  const error    = tripsQuery.error ? (tripsQuery.error instanceof Error ? tripsQuery.error.message : 'Error cargando viajes') : null

  // ── Alertas accionables: excepciones derivadas de la data ya cargada (un clic = filtro) ──
  const alertRules = tripsMeta?.monitor_alert_rules ?? DEFAULT_ALERT_RULES
  const signalDefs = useMemo(() => alertSignalDefs(alertRules), [alertRules])
  const signalCounts = useMemo(
    () => computeSignalCounts(trips, tripsMeta?.temperature_ranges ?? [], alertRules),
    [trips, tripsMeta?.temperature_ranges, alertRules],
  )
  const { pinned, togglePin } = usePinnedAlertSignals()
  const visibleTrips = useMemo(() => {
    let result = trips
    if (f.tab === 'en_curso' && f.activeSignals.length > 0) {
      result = result.filter(t => matchesActiveSignals(t, f.activeSignals, tripsMeta?.temperature_ranges ?? [], alertRules))
    }
    // Tipo de operación (Fase 2, Plan 7; swap a destino 2026-08-02, ítem 12
    // de la minuta) — a diferencia de activeSignals, aplica en ambos tabs
    // (en_curso e historial): no es una alerta de operación en vivo, es una
    // clasificación permanente. Se filtra por las paradas DESTINATION (94%
    // de cobertura real) en vez de origin_operation_type (orígenes son casi
    // siempre CD propios de WebCarga, no locales de cliente — ~70%+ quedaba
    // sin clasificar). Un viaje matchea si CUALQUIERA de sus destinos cae en
    // el tipo seleccionado (multi-destino: basta con que un tramo real
    // pertenezca a RM/Zona Cero para que el viaje sea relevante al filtro).
    if (f.fOperationType.length > 0) {
      result = result.filter(t =>
        t.stops.some(
          s => s.stop_type === 'DESTINATION' && f.fOperationType.includes(s.operation_type ?? ''),
        ),
      )
    }
    return result
  }, [trips, f.tab, f.activeSignals, f.fOperationType, tripsMeta?.temperature_ranges, alertRules])

  // Centro de Flota (2026-07-28) — mismo queryKey que usa FleetCenterDialog
  // internamente, así el badge del botón y el modal comparten cache y no
  // duplican el fetch cuando se abre.
  const fleetAvailableQuery = useQuery({
    queryKey: ['available-assets', today],
    queryFn: () => tripsApi.availableAssets(today),
    enabled: f.tab === 'en_curso',
  })

  const fleetAvailableCount = fleetAvailableQuery.data?.items.length ?? 0

  // ── Glow: marca filas cuyo último reporte TMS cambió entre refetches ────────
  const prevReportedRef = useRef<Map<string, string | null>>(new Map())
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!trips.length) return
    const prev = prevReportedRef.current
    const changed = new Set<string>()
    for (const t of trips) {
      const before = prev.get(t.id)
      if (before !== undefined && before !== t.status_reported_at) changed.add(t.id)
    }
    prevReportedRef.current = new Map(trips.map(t => [t.id, t.status_reported_at]))
    if (changed.size) {
      setUpdatedIds(changed)
      const timer = setTimeout(() => setUpdatedIds(new Set()), 2500)
      return () => clearTimeout(timer)
    }
  }, [trips])

  useEffect(() => {
    // TODO(H2.6): sin productor desde que se borró transporters.py — ver TripTable.tsx
    filterGroupsApi.list().then(setCustomGroups).catch(console.error)
    fetchTripsMeta().then(setTripsMeta).catch(() => { /* fallback gracioso — usa defaults en TripTable/TripSlideOver */ })
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (saved === 'tabla' || saved === 'tablero') setViewMode(saved)
  }, [])

  function handleViewModeChange(v: ViewMode) {
    setViewMode(v)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, v)
  }

  function handleSaved(updated: Trip) {
    queryClient.setQueryData(['trip', updated.id], updated)
    // Actualiza el viaje en todas las listas cacheadas — sin refetch
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }

  function handleCreated(newTrip: Trip) {
    // El viaje recién creado debe quedar visible — "En Curso" ya no filtra
    // por fecha (2026-08-02), solo por is_active, así que alcanza con
    // asegurar el tab correcto sin importar planning_date.
    if (f.tab !== 'en_curso') {
      dispatch({ type: 'patch', patch: { tab: 'en_curso' } })
    }
    queryClient.invalidateQueries({ queryKey: ['trips'] })
    queryClient.setQueryData(['trip', newTrip.id], newTrip)
    router.push(`/dashboard/operations/monitor/trips/${newTrip.id}`)
  }

  function handleBulkImported(count: number) {
    if (count > 0) queryClient.invalidateQueries({ queryKey: ['trips'] })
  }

  // Tarea 15 (plan 1.6): el Centro de Cierre unificado reemplaza a
  // EquipmentCloseDayDialog/FleetDailyOverviewDialog/StatusReportDialog —
  // "Cerrar el día" desde Flota navega a la página nueva en vez de abrir
  // otro diálogo local.
  function openCloseDayFromFleet() {
    setShowFleetCenter(false)
    router.push('/dashboard/operations/closures')
  }

  // Compartido entre FleetCenterDialog (equipo "En viaje hoy") y
  // BitacoraFollowupBadge — ambos necesitan abrir un viaje real por id.
  function handleSelectTrip(tripId: string) {
    setShowFleetCenter(false)
    router.push(`/dashboard/operations/monitor/trips/${tripId}`)
  }

  // Click en BitacoraFollowupBadge (2026-07-28) — abre el mismo detalle que
  // un click de fila normal, pero además pide que la página de detalle
  // scrollee derecho a la Bitácora en vez de abrir arriba del todo.
  function handleSelectTripFocusNotes(trip: Trip) {
    queryClient.setQueryData(['trip', trip.id], trip)
    router.push(`/dashboard/operations/monitor/trips/${trip.id}?focus=bitacora`)
  }

  function handleAssignFromFleet(fleet: FleetAssignValue) {
    setShowFleetCenter(false)
    setPrefillFleet(fleet)
    setShowCreate(true)
  }

  function handleNewTripFromFleet() {
    setShowFleetCenter(false)
    setPrefillFleet(null)
    setShowCreate(true)
  }

  function handleImportCsvFromFleet() {
    setShowFleetCenter(false)
    setShowBulkUpload(true)
  }

  function handleGroupSaved(group: FilterGroup) {
    setCustomGroups(prev => {
      const exists = prev.find(g => g.id === group.id)
      return exists ? prev.map(g => g.id === group.id ? group : g) : [...prev, group]
    })
  }

  function handleGroupDeleted(id: string) {
    setCustomGroups(prev => prev.filter(g => g.id !== id))
    if (f.activeGroup === `custom:${id}`) dispatch({ type: 'patch', patch: { activeGroup: null } })
  }

  const totalPages = Math.max(1, Math.ceil(total / historialPageSize))

  return (
    <div className="flex h-full overflow-hidden relative">
      {showBuilder && (
        <GroupBuilder
          editing={editingGroup}
          onSaved={handleGroupSaved}
          onDeleted={handleGroupDeleted}
          onClose={() => { setShowBuilder(false); setEditingGroup(undefined); setPrefillFromFilter(false) }}
          statuses={tripsMeta?.statuses}
          initialStatuses={prefillFromFilter && statusParam ? statusParam.split(',') : undefined}
        />
      )}

      {/* ── Main ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-4 md:p-6 space-y-4 flex-1 overflow-y-auto">

          {/* Header — "En Curso" ya no navega por fecha (2026-08-02): filtra
              por is_active, sin importar planning_date, así que no hay
              ningún día que mostrar/navegar acá. Esa necesidad (mirar un
              día específico) la cubre el tab Historial con su rango. */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-mulish font-bold text-xl text-text-primary capitalize">
                {f.tab === 'en_curso' ? 'En Curso' : 'Base Histórica'}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                <span>{loading ? '…' : `${total.toLocaleString('es-CL')} viaje${total !== 1 ? 's' : ''}`}</span>
                {f.tab === 'en_curso' && (
                  <LastUpdated updatedAt={tripsQuery.dataUpdatedAt} fetching={fetching && !loading} />
                )}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            {([
              { key: 'en_curso',  label: 'En Curso'  },
              { key: 'historial', label: 'Historial' },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => dispatch({ type: 'patch', patch: { tab: t.key } })}
                className={`pb-2.5 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
                  f.tab === t.key ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Barra de acciones — vista + gestión de flota */}
          <div className="flex items-center justify-between gap-3">
            {f.tab === 'en_curso' ? (
              <ViewToggle value={viewMode} onChange={handleViewModeChange} />
            ) : <div />}
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/dashboard/operations/closures')}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-accent border border-border rounded-lg px-3 py-1.5 transition-colors"
                title="Centro de Cierre — resumen, pendientes, cerrar Tractoreo/Equipos Completos y reporte del día"
              >
                <ClipboardCheck size={13} />
                Cerrar el día
              </button>
              <button
                onClick={() => setShowFleetCenter(true)}
                className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Truck size={13} />
                Flota
                {fleetAvailableCount > 0 && (
                  <span className="bg-white/25 rounded-full px-1.5 text-[10px] font-bold">{fleetAvailableCount}</span>
                )}
              </button>
            </div>
          </div>

          {/* ── Alertas: 3 tiles pineadas (severidad visual) + popover para
              el resto — reemplaza las 2 filas crecientes de KPI cards/flags
              (Ronda 26, escalabilidad de filtros). Estado no se toca, sigue
              como fila separada más abajo — es la dimensión de navegación
              primaria, no una alerta. */}
          {f.tab === 'en_curso' && !loading && (
            <div className="flex items-center gap-2 flex-wrap">
              {signalDefs.filter(d => pinned.includes(d.id)).map(def => {
                const count  = signalCounts[def.id] ?? 0
                const active = f.activeSignals.includes(def.id)
                const band   = severityBand(count)
                return (
                  <button
                    key={def.id}
                    onClick={() => dispatch({ type: 'toggleSignal', id: def.id })}
                    disabled={count === 0 && !active}
                    aria-pressed={active}
                    className={`flex items-center gap-2 bg-white border rounded-xl px-3.5 py-2 transition-all disabled:opacity-40 disabled:cursor-default ${
                      active ? def.activeCls : band === 'critical' ? 'border-gray-300' : 'border-border hover:border-gray-300'
                    }`}
                  >
                    <span className={`leading-none font-bold ${
                      band === 'neutral'  ? 'text-sm text-gray-300' :
                      band === 'elevated' ? `text-base ${def.colorCls}` :
                                             `text-lg ${def.colorCls}`
                    }`}>
                      {count}
                    </span>
                    <span className="text-[11px] font-medium text-gray-500">{def.label}</span>
                    {active && <X size={11} className="text-gray-400" />}
                  </button>
                )
              })}

              <AlertsPopover
                defs={signalDefs}
                counts={signalCounts}
                active={f.activeSignals}
                pinned={pinned}
                onToggle={id => dispatch({ type: 'toggleSignal', id })}
                onTogglePin={togglePin}
              />

              {f.activeSignals.filter(id => !pinned.includes(id)).map(id => {
                const def = signalDefs.find(d => d.id === id)
                if (!def) return null
                return (
                  <span key={id} className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/10 rounded-full pl-2.5 pr-1.5 py-1">
                    {def.label}
                    <button type="button" onClick={() => dispatch({ type: 'toggleSignal', id })} aria-label={`Quitar filtro ${def.label}`}>
                      <X size={11} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {/* ── Barra de filtros compacta: búsqueda + Cliente + popover ── */}
          <div className="bg-white border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
            <div className="relative shrink-0">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={f.q}
                onChange={e => dispatch({ type: 'patch', patch: { q: e.target.value } })}
                placeholder="Tracto, conductor, EETT, cliente, ID, entrega…"
                className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-60 bg-white placeholder:text-gray-400 transition-all"
              />
            </div>

            {/* Cliente — dinámico según quién realmente tiene viajes en el
                Diario (bug 5.2, GET /trips/meta), no el catálogo completo
                de public.shippers. Estado (antes acá) se movió al popover
                "Filtros" — Operaciones pidió Cliente visible de entrada. */}
            {(tripsMeta?.clients ?? []).map(c => {
              const active = f.fClient.includes(c.name)
              return (
                <button
                  key={c.id}
                  onClick={() => dispatch({ type: 'toggleClient', id: c.name })}
                  aria-pressed={active}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                    active ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {c.name}
                </button>
              )
            })}

            {/* Filtros ocasionales (Estado, Fuente, Indicadores, fechas) + Limpiar */}
            <div className="flex items-center gap-2 ml-auto">
              <FilterPopover
                filters={f} dispatch={dispatch} meta={tripsMeta}
                defaultGroups={defaultGroups} customGroups={customGroups} statusParam={statusParam}
                onEditGroup={g => { setEditingGroup(g); setShowBuilder(true) }}
                onCreateGroup={() => { setEditingGroup(undefined); setPrefillFromFilter(false); setShowBuilder(true) }}
                onSaveAsGroup={() => { setEditingGroup(undefined); setPrefillFromFilter(true); setShowBuilder(true) }}
              />
              {activeCount > 0 && (
                <button onClick={() => dispatch({ type: 'clear' })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 rounded-lg bg-white transition-colors">
                  <X size={11} />
                  Limpiar
                  <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-gray-100 rounded-full text-gray-600">{activeCount}</span>
                </button>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          {/* Table / Board — en refetch la data anterior queda visible, atenuada (sin flash de spinner) */}
          {loading ? (
            <Estado tipo="cargando" />
          ) : (
            <div className={`transition-opacity duration-150 ${fetching ? 'opacity-50' : ''}`} aria-busy={fetching}>
              {f.tab === 'en_curso' && viewMode === 'tablero' ? (
                <TripBoard
                  trips={visibleTrips}
                  groups={defaultGroups}
                  meta={tripsMeta}
                  onSaved={handleSaved}
                  onSelect={trip => {
                    queryClient.setQueryData(['trip', trip.id], trip)
                    router.push(`/dashboard/operations/monitor/trips/${trip.id}`)
                  }}
                  onSelectFocusNotes={handleSelectTripFocusNotes}
                  updatedIds={updatedIds}
                />
              ) : (
                <TripTable
                  trips={visibleTrips}
                  selectedId={openTripId}
                  onSelect={trip => {
                    queryClient.setQueryData(['trip', trip.id], trip)
                    router.push(`/dashboard/operations/monitor/trips/${trip.id}`)
                  }}
                  onSelectFocusNotes={handleSelectTripFocusNotes}
                  meta={tripsMeta}
                  updatedIds={updatedIds}
                  sortKey={f.sortKey}
                  sortDir={f.sortDir}
                  onSort={col => dispatch({ type: 'toggleSort', col })}
                />
              )}
            </div>
          )}

          {/* Historial pagination */}
          {f.tab === 'historial' && !loading && total > 0 && (
            <PaginationControls
              page={f.page}
              totalPages={totalPages}
              total={total}
              pageSize={historialPageSize}
              onPageChange={p => dispatch({ type: 'patch', patch: { page: p } })}
              onPageSizeChange={size => {
                setHistorialPageSize(size)
                dispatch({ type: 'patch', patch: { page: 1 } })
              }}
            />
          )}

        </div>
      </div>

      <TripAssignDialog
        open={showCreate}
        onClose={() => { setShowCreate(false); setPrefillFleet(null) }}
        onCreated={handleCreated}
        meta={tripsMeta}
        fecha={today}
        initialFleet={prefillFleet ?? undefined}
      />
      <TripBulkUpload
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onImported={handleBulkImported}
        meta={tripsMeta}
      />
      <FleetCenterDialog
        open={showFleetCenter}
        fecha={today}
        onClose={() => setShowFleetCenter(false)}
        onOpenCloseDay={openCloseDayFromFleet}
        onAssign={handleAssignFromFleet}
        onNewTrip={handleNewTripFromFleet}
        onImportCsv={handleImportCsvFromFleet}
        onSelectTrip={handleSelectTrip}
      />
    </div>
  )
}
