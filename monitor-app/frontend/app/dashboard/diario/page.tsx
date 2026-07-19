'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Loader2, ChevronLeft, ChevronRight, X, Plus, PenLine, Upload } from 'lucide-react'
import { filterGroupsApi, type FilterGroup, type GroupColor } from '@/lib/api/filterGroups'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { tripsApi, type TripListResponse } from '@/lib/api/trips'
import type { Trip, TripsMeta } from '@/lib/types'
import { TripTable, type ComplianceAlertSummary } from '@/components/dashboard/TripTable'
import { TripBoard } from '@/components/dashboard/TripBoard'
import { ViewToggle, type ViewMode } from '@/components/dashboard/ViewToggle'
import { TripSlideOver } from '@/components/dashboard/TripSlideOver'
import { GroupBuilder } from '@/components/dashboard/GroupBuilder'
import { FilterPopover } from '@/components/dashboard/FilterPopover'
import { TripAssignDialog } from '@/components/dashboard/TripAssignDialog'
import { TripBulkUpload } from '@/components/dashboard/TripBulkUpload'
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
import { UserCheck } from 'lucide-react'

const VIEW_MODE_STORAGE_KEY = 'diario:vista-en-curso'

const HISTORIAL_LIMIT = 100

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

// ── Custom group color classes ─────────────────────────────────────────────────
const COLOR_CLS: Record<GroupColor, { on: string; off: string }> = {
  blue:   { on: 'bg-blue-500   border-blue-500   text-white', off: 'text-blue-700   border-blue-300   bg-blue-50   hover:border-blue-400'   },
  green:  { on: 'bg-green-500  border-green-500  text-white', off: 'text-green-700  border-green-300  bg-green-50  hover:border-green-400'  },
  orange: { on: 'bg-orange-500 border-orange-500 text-white', off: 'text-orange-700 border-orange-300 bg-orange-50 hover:border-orange-400' },
  purple: { on: 'bg-purple-500 border-purple-500 text-white', off: 'text-purple-700 border-purple-300 bg-purple-50 hover:border-purple-400' },
  red:    { on: 'bg-red-500    border-red-500    text-white', off: 'text-red-700    border-red-300    bg-red-50    hover:border-red-400'    },
  teal:   { on: 'bg-teal-500   border-teal-500   text-white', off: 'text-teal-700   border-teal-300   bg-teal-50   hover:border-teal-400'   },
  amber:  { on: 'bg-amber-500  border-amber-500  text-white', off: 'text-amber-700  border-amber-300  bg-amber-50  hover:border-amber-400'  },
  pink:   { on: 'bg-pink-500   border-pink-500   text-white', off: 'text-pink-700   border-pink-300   bg-pink-50   hover:border-pink-400'   },
  slate:  { on: 'bg-slate-500  border-slate-500  text-white', off: 'text-slate-700  border-slate-300  bg-slate-50  hover:border-slate-400'  },
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function shiftDay(iso: string, delta: number) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return d.toISOString().split('T')[0]
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
  const [f, dispatch] = useDiarioFilters(todayISO())

  const [selected,       setSelected]       = useState<Trip | null>(null)
  const [alertSummary,   setAlertSummary]   = useState<ComplianceAlertSummary | null>(null)
  const [tripsMeta,      setTripsMeta]      = useState<TripsMeta | null>(null)
  const [showCreate,     setShowCreate]     = useState(false)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [viewMode,       setViewMode]       = useState<ViewMode>('tabla')

  // Custom groups
  const [customGroups,      setCustomGroups]      = useState<FilterGroup[]>([])
  const [showBuilder,       setShowBuilder]       = useState(false)
  const [editingGroup,      setEditingGroup]      = useState<FilterGroup | undefined>(undefined)
  const [prefillFromFilter, setPrefillFromFilter] = useState(false)

  // Debounce de la búsqueda: no disparar un fetch por cada tecla
  const qDebounced = useDebouncedValue(f.q, 300)

  const today   = todayISO()
  const isToday = f.fecha === today

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
  const locParams = {
    ...(f.fRegion ? { origin_region: f.fRegion } : {}),
    ...(f.fCity   ? { origin_city:   f.fCity }   : {}),
  }
  const params: TripListParams =
    f.tab === 'en_curso'
      ? { fecha: f.fecha, view: 'en_curso', q: qDebounced, status: statusParam, tms: f.fTms.join(','), limit: 200, ...boolParams, ...locParams }
      : { view: 'historial', q: qDebounced, fecha_desde: f.fechaDesde, fecha_hasta: f.fechaHasta,
          status: statusParam, tms: f.fTms.join(','), limit: HISTORIAL_LIMIT, page: f.page, ...boolParams, ...locParams }

  const queryClient = useQueryClient()
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
    if (f.tab !== 'en_curso' || f.activeSignals.length === 0) return trips
    return trips.filter(t => matchesActiveSignals(t, f.activeSignals, tripsMeta?.temperature_ranges ?? [], alertRules))
  }, [trips, f.tab, f.activeSignals, tripsMeta?.temperature_ranges, alertRules])

  // ── Conductores disponibles (sin viaje abierto hoy) — solo para el conteo
  // del tile, la lista sugerida vive dentro de TripAssignDialog (Ronda 26)
  const availableCountQuery = useQuery({
    queryKey: ['available-drivers', f.fecha],
    queryFn: () => tripsApi.availableDrivers(f.fecha),
    enabled: f.tab === 'en_curso',
  })
  const availableCount = availableCountQuery.data?.length ?? 0

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
    setSelected(updated)
    // Actualiza el viaje en todas las listas cacheadas — sin refetch
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }

  function handleCreated(newTrip: Trip) {
    setSelected(newTrip)
    // El viaje recién creado debe quedar visible: si su fecha no coincide con el
    // filtro actual, saltamos a esa fecha (si no, la lista lo escondería)
    if (newTrip.planning_date && (f.tab !== 'en_curso' || newTrip.planning_date !== f.fecha)) {
      dispatch({ type: 'patch', patch: { tab: 'en_curso', fecha: newTrip.planning_date } })
    }
    queryClient.invalidateQueries({ queryKey: ['trips'] })
  }

  function handleBulkImported(count: number) {
    if (count > 0) queryClient.invalidateQueries({ queryKey: ['trips'] })
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

  const totalPages = Math.max(1, Math.ceil(total / HISTORIAL_LIMIT))

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

          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-mulish font-bold text-xl text-text-primary capitalize">
                {f.tab === 'en_curso' ? fmtDate(f.fecha) : 'Base Histórica'}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                <span>{loading ? '…' : `${total.toLocaleString('es-CL')} viaje${total !== 1 ? 's' : ''}`}</span>
                {f.tab === 'en_curso' && (
                  <LastUpdated updatedAt={tripsQuery.dataUpdatedAt} fetching={fetching && !loading} />
                )}
              </p>
            </div>

            {f.tab === 'en_curso' && (
              <div className="flex items-center bg-white border border-border rounded-lg p-0.5 shrink-0">
                <button onClick={() => dispatch({ type: 'patch', patch: { fecha: shiftDay(f.fecha, -1) } })} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-500">
                  <ChevronLeft size={16} />
                </button>
                {!isToday && (
                  <button onClick={() => dispatch({ type: 'patch', patch: { fecha: today } })} className="px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/5 rounded-md transition-colors">
                    Hoy
                  </button>
                )}
                <button
                  onClick={() => { if (!isToday) dispatch({ type: 'patch', patch: { fecha: shiftDay(f.fecha, 1) } }) }}
                  disabled={isToday}
                  className="p-1.5 rounded-md transition-colors text-gray-500 disabled:opacity-25 disabled:cursor-not-allowed hover:enabled:bg-gray-100"
                  title={isToday ? 'No hay datos de días futuros' : 'Día siguiente'}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
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

          {/* Barra de acciones — vista + agregar viaje */}
          <div className="flex items-center justify-between gap-3">
            {f.tab === 'en_curso' ? (
              <ViewToggle value={viewMode} onChange={handleViewModeChange} />
            ) : <div />}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowBulkUpload(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-accent transition-colors"
              >
                <Upload size={12} />
                Carga masiva (CSV)
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Plus size={13} />
                Agregar viaje
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

              {/* Conductores disponibles hoy — atajo directo a crear viaje,
                  con la lista ya sugerida dentro del diálogo (Ronda 26) */}
              {availableCount > 0 && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 bg-white border border-green-200 rounded-xl px-3.5 py-2 transition-all hover:border-green-400 ml-auto"
                >
                  <UserCheck size={14} className="text-green-600" />
                  <span className="text-lg font-bold leading-none text-green-600">{availableCount}</span>
                  <span className="text-[11px] font-medium text-gray-500">
                    conductor{availableCount !== 1 ? 'es' : ''} disponible{availableCount !== 1 ? 's' : ''}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* ── Barra de filtros compacta: búsqueda + Estado + popover ── */}
          <div className="bg-white border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
            <div className="relative shrink-0">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={f.q}
                onChange={e => dispatch({ type: 'patch', patch: { q: e.target.value } })}
                placeholder="Tracto, conductor, EETT, cliente, ID…"
                className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-60 bg-white placeholder:text-gray-400 transition-all"
              />
            </div>

            {/* Estado: grupos default + custom */}
            {defaultGroups.map(g => {
              const key = `default:${g.id}`
              const active = f.activeGroup === key
              return (
                <button
                  key={g.id}
                  onClick={() => dispatch({ type: 'toggleGroup', key })}
                  aria-pressed={active}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${active ? g.on : g.off}`}
                >
                  {g.label}
                  {active && g.statuses.length > 1 && (
                    <span className="ml-1 opacity-70 text-[9px]">·{g.statuses.length}</span>
                  )}
                </button>
              )
            })}

            {customGroups.length > 0 && <span className="text-gray-200 text-sm">·</span>}

            {customGroups.map(g => {
              const key = `custom:${g.id}`
              const active = f.activeGroup === key
              const cls = COLOR_CLS[g.color] ?? COLOR_CLS.blue
              return (
                <span key={g.id} className={`inline-flex items-center rounded-full border transition-all ${active ? cls.on : cls.off}`}>
                  <button
                    onClick={() => dispatch({ type: 'toggleGroup', key })}
                    aria-pressed={active}
                    className="text-[11px] font-semibold pl-2.5 pr-1 py-1"
                  >
                    {g.name}
                    {active && g.statuses.length > 1 && (
                      <span className="opacity-70 text-[9px] ml-1">·{g.statuses.length}</span>
                    )}
                  </button>
                  {/* Edición siempre visible (antes solo-hover: invisible en touch) */}
                  <button
                    onClick={e => { e.stopPropagation(); setEditingGroup(g); setShowBuilder(true) }}
                    aria-label={`Editar grupo ${g.name}`}
                    className="pr-2 pl-0.5 py-1 opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <PenLine size={9} />
                  </button>
                </span>
              )
            })}

            <button
              onClick={() => { setEditingGroup(undefined); setPrefillFromFilter(false); setShowBuilder(true) }}
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-accent hover:text-accent transition-all"
              title="Crear grupo personalizado"
            >
              <Plus size={11} />
              Grupo
            </button>

            {statusParam && (
              <button
                onClick={() => { setEditingGroup(undefined); setPrefillFromFilter(true); setShowBuilder(true) }}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-accent/40 text-accent hover:border-accent hover:bg-accent/5 transition-all"
                title="Guardar el filtro de estado actual como grupo"
              >
                <Plus size={11} />
                Guardar como grupo
              </button>
            )}

            {/* Filtros ocasionales (Fuente, Indicadores, fechas) + Limpiar */}
            <div className="flex items-center gap-2 ml-auto">
              <FilterPopover filters={f} dispatch={dispatch} meta={tripsMeta} />
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
            <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : (
            <div className={`transition-opacity duration-150 ${fetching ? 'opacity-50' : ''}`} aria-busy={fetching}>
              {f.tab === 'en_curso' && viewMode === 'tablero' ? (
                <TripBoard
                  trips={visibleTrips}
                  groups={defaultGroups}
                  meta={tripsMeta}
                  onSaved={handleSaved}
                  onSelect={setSelected}
                  updatedIds={updatedIds}
                />
              ) : (
                <TripTable
                  trips={visibleTrips}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                  alertSummary={alertSummary}
                  meta={tripsMeta}
                  updatedIds={updatedIds}
                />
              )}
            </div>
          )}

          {/* Historial pagination */}
          {f.tab === 'historial' && !loading && total > 0 && (
            <div className="flex items-center justify-between pt-2 pb-1">
              <button
                onClick={() => dispatch({ type: 'patch', patch: { page: Math.max(1, f.page - 1) } })}
                disabled={f.page === 1}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-600"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <p className="text-xs text-gray-500">
                {total > HISTORIAL_LIMIT ? (
                  <>Página <span className="font-semibold text-gray-700">{f.page}</span> de <span className="font-semibold text-gray-700">{totalPages}</span><span className="text-gray-400 ml-2">· {total.toLocaleString('es-CL')} viajes</span></>
                ) : (
                  <span className="text-gray-400">{total.toLocaleString('es-CL')} viaje{total !== 1 ? 's' : ''}</span>
                )}
              </p>
              <button
                onClick={() => dispatch({ type: 'patch', patch: { page: Math.min(totalPages, f.page + 1) } })}
                disabled={f.page >= totalPages}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-600"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          )}

        </div>
      </div>

      <TripSlideOver trip={selected} onClose={() => setSelected(null)} onSaved={handleSaved} meta={tripsMeta} />
      <TripAssignDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
        meta={tripsMeta}
        fecha={f.fecha}
      />
      <TripBulkUpload
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onImported={handleBulkImported}
        meta={tripsMeta}
      />
    </div>
  )
}
