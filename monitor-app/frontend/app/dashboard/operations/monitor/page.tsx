'use client'

import { Suspense, useEffect, useState, useMemo, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ClipboardCheck, Truck, Ban } from 'lucide-react'
import { filterGroupsApi, type FilterGroup } from '@/lib/api/filterGroups'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { tripsApi } from '@/lib/api/trips'
import type { Trip, TripsMeta } from '@/lib/types'
import { TripTable } from '@/components/dashboard/TripTable'
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
import { AsignarConductorPopover } from '@/components/dashboard/AsignarConductorPopover'
import { useAnularViajes } from '@/hooks/useAnularViajes'
import { useMotivosDeAnulacion } from '@/hooks/useMotivosDeAnulacion'
import { BarraDeSeleccion } from '@/components/ui/BarraDeSeleccion'
import { cuantos } from '@/lib/utils/cuantos'
import { clientesDelFiltro } from '@/lib/monitor/clientesDelFiltro'
import { AvisoFueraDeEnCurso } from '@/components/dashboard/AvisoFueraDeEnCurso'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { EntityQuickView } from '@/components/dashboard/EntityQuickView'
import { useQuickView } from '@/lib/quickView'
import { MONITOR, monitorFiltersFromUrl } from '@/lib/navegacion/viaje'
import { TRIP_STAGES, SIGNAL_TONE_TEXT, tripStageStyle } from '@/lib/states'
import { STATUS_TONE_CLASS, STATUS_TONE_DOT } from '@/components/ui/StatusChip'
import { PageContainer } from '@/components/ui/PageContainer'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { SearchInput } from '@/components/ui/SearchInput'


// Los grupos por defecto del Monitor son las etapas del viaje: etiqueta, orden y
// tono salen del glosario (lib/states.ts), no de un mapa propio (Configuración, Parte 1).
const chipDeEtapa = (group: string) => {
  const { label, tone } = tripStageStyle(group)
  return {
    label,
    on:  `${STATUS_TONE_DOT[tone]} border-transparent font-semibold text-white`,
    off: `${STATUS_TONE_CLASS[tone]} border-border hover:border-informativo`,
  }
}

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
    <span className="text-etiqueta text-informativo whitespace-nowrap">
      {fetching
        ? 'Actualizando…'
        : `Actualizado ${formatRelativeTime(new Date(updatedAt).toISOString())}`}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function DiarioPage() {
  return <Suspense fallback={null}><DiarioPageInner /></Suspense>
}

function DiarioPageInner() {
  const [f, dispatch] = useDiarioFilters(monitorFiltersFromUrl(useSearchParams()))

  const [tripsMeta,      setTripsMeta]      = useState<TripsMeta | null>(null)
  const [showCreate,      setShowCreate]      = useState(false)
  const [showBulkUpload,  setShowBulkUpload]  = useState(false)
  const [showFleetCenter, setShowFleetCenter] = useState(false)
  const [prefillFleet,    setPrefillFleet]    = useState<FleetAssignValue | null>(null)
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
    return TRIP_STAGES
      .filter(c => grouped[c.id]?.length > 0)
      .map(c => ({ id: c.id, statuses: grouped[c.id], ...chipDeEtapa(c.id) }))
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
    shipper_id: f.fClient.join(','),
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
          limit: historialPageSize, page: f.page, ...boolParams,
          // Task 8: "No asignado por WebCarga" — solo tiene sentido en el
          // historial (no mira is_active, ver trips.py). En "En Curso" no
          // se envía: is_active:true de arriba dejaria la lista vacia igual.
          ...(f.fNoAsignadoWebcarga ? { no_asignado_webcarga: true } : {}) }

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
  // Los nombres de los clientes vistos, para que un cliente elegido que ya no
  // tiene viajes en la vista siga visible y se pueda quitar.
  const facetas = tripsQuery.data?.clients
  const [nombresDeClientes, setNombresDeClientes] = useState<Record<string, string>>({})
  if (facetas && facetas.some(c => nombresDeClientes[c.id] !== c.name)) {
    setNombresDeClientes(n => ({ ...n, ...Object.fromEntries(facetas.map(c => [c.id, c.name])) }))
  }
  const opcionesDeCliente = clientesDelFiltro(facetas ?? [], f.fClient, nombresDeClientes)
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
  // ── Identificar al conductor desde la tabla (2026-08-18) ───────────────
  const puedeEditar = usePermiso('trips.edit_sensitive')
  // El alta crea el conductor y lo vincula a su empresa: eso pide directory.edit.
  const puedeDarDeAlta = usePermiso('directory.edit')
  // Vista rápida del tracto, el conductor o la empresa de una fila, como en el Cierre (D4).
  const puedeVerDirectorio = usePermiso('directory.read')
  const puedePedirDocumentos = usePermiso('certification.request')
  const quickView = useQuickView()
  const [asignando, setAsignando] = useState<Trip | null>(null)
  const [soloSinIdentificar, setSoloSinIdentificar] = useState(false)

  // Los candidatos y los viajes REALES de esa persona vienen juntos del
  // backend: el alcance que promete el popover se aplica a los ids que él
  // devuelve, no a un conteo hecho acá sobre lo que la tabla tiene cargado.
  const candidatosQuery = useQuery({
    queryKey: ['driver-candidates', asignando?.driver_name_tms],
    queryFn: () => tripsApi.driverCandidates(asignando!.driver_name_tms!),
    enabled: Boolean(asignando?.driver_name_tms),
  })

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
    // El contador de arriba es un filtro de verdad, y eso NO es un detalle:
    // es la condición que sostiene el diseño de la celda. Sin chip de color
    // por fila (208 filas marcadas no son señal), el camino para descubrir
    // el trabajo pendiente deja de ser "escaneo la tabla" y pasa a ser "veo
    // el número y lo abro". Si esto quedara decorativo, habría que volver al
    // chip por fila.
    if (soloSinIdentificar) {
      result = result.filter(t => !t.driver_id && t.driver_name_tms)
    }
    return result
  }, [trips, f.tab, f.activeSignals, f.fOperationType, tripsMeta?.temperature_ranges, alertRules, soloSinIdentificar])

  // Anular viajes manuales con motivo, uno o varios (spec 2026-10-10). La
  // selección vive sobre lo que se ve: un viaje que sale de la vista se desmarca solo.
  const anulacion = useAnularViajes(visibleTrips)
  const { motivos: motivosDeAnulacion, cargando: cargandoMotivos } = useMotivosDeAnulacion()

  // PERSONAS, no viajes. 27 personas explican 208 viajes: contar viajes
  // exagera el trabajo por 7,7 y hace que la tarea parezca infinita.
  const personasSinIdentificar = useMemo(() => {
    const nombres = new Set<string>()
    for (const t of trips) {
      // `driver_id`, NO `driver_name`: este ultimo cae al nombre del TMS cuando
      // no hay vinculo, asi que el contador daba 0 estructuralmente — y el plan
      // declaro este contador CONDICION DURA del diseño de la celda.
      if (!t.driver_id && t.driver_name_tms) nombres.add(t.driver_name_tms.trim().toUpperCase())
    }
    return nombres.size
  }, [trips])

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
        <PageContainer scrollable>

          {/* Header — "En Curso" ya no navega por fecha (2026-08-02): filtra
              por is_active, sin importar planning_date, así que no hay
              ningún día que mostrar/navegar acá. Esa necesidad (mirar un
              día específico) la cubre el tab Historial con su rango. */}
          <EncabezadoDePagina
            // El módulo se llama como en el menú; En Curso e Historial son sus dos vistas (pestañas).
            titulo="Monitor"
            bajada={
              <span className="flex items-center gap-2">
                <span>{loading ? '…' : `${total.toLocaleString('es-CL')} viaje${total !== 1 ? 's' : ''}`}</span>
                {f.tab === 'en_curso' && (
                  <LastUpdated updatedAt={tripsQuery.dataUpdatedAt} fetching={fetching && !loading} />
                )}
              </span>
            }
          />

          {/* Las dos vistas del Monitor a la izquierda y sus acciones a la derecha, en una
              fila; en un teléfono las acciones pasan a la línea siguiente. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs label="Vista del Monitor" value={f.tab}
              onChange={tab => dispatch({ type: 'patch', patch: { tab } })}
              tabs={[{ id: 'en_curso', label: 'En Curso' }, { id: 'historial', label: 'Historial' }]} />
            <div className="flex items-center gap-3">
              <Button onClick={() => router.push('/dashboard/operations/closures')}
                title="Centro de Cierre — resumen, pendientes, cerrar Tractoreo/Equipos Completos y reporte del día">
                <ClipboardCheck size={13} aria-hidden="true" />
                Cerrar el día
              </Button>
              <Button variant="primary" onClick={() => setShowFleetCenter(true)}>
                <Truck size={13} aria-hidden="true" />
                Flota
                {fleetAvailableCount > 0 && (
                  <span className="rounded-full bg-white/25 px-1.5 text-etiqueta font-bold">{fleetAvailableCount}</span>
                )}
              </Button>
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
                    // Marcada como los recuadros del Cierre; la cifra crece con la gravedad y su
                    // color sale del significado de la señal (SIGNAL_TONE_TEXT).
                    className={`flex items-center gap-2 rounded-xl border bg-white px-3.5 py-2 transition-colors disabled:cursor-default disabled:opacity-40 ${
                      active ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-border hover:bg-bg-main'
                    }`}
                  >
                    <span className={`leading-none font-bold tabular-nums ${
                      band === 'neutral'  ? 'text-dato text-informativo' :
                      band === 'elevated' ? `text-lectura ${SIGNAL_TONE_TEXT[def.tone]}` :
                                             `text-titulo ${SIGNAL_TONE_TEXT[def.tone]}`
                    }`}>
                      {count}
                    </span>
                    <span className="text-etiqueta font-medium text-informativo">{def.label}</span>
                    {active && <X size={11} className="text-informativo" aria-hidden="true" />}
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
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent/10 py-1 pl-2.5 pr-1.5 text-etiqueta font-semibold text-accion">
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
            <SearchInput value={f.q} onChange={q => dispatch({ type: 'patch', patch: { q } })} label="Buscar viajes"
              placeholder="Tracto, conductor, EETT, cliente, ID, entrega…" className="w-60 max-w-full shrink-0" />

            {/* Cliente — los clientes con viajes en la vista (en curso o el
                rango del historial), con su cuenta (GET /trips, 2026-10-11).
                Antes salían de todo el histórico y aparecía un cliente con un
                solo viaje cerrado hace semanas. Estado (antes acá) se movió al
                popover "Filtros" — Operaciones pidió Cliente visible de entrada. */}
            {opcionesDeCliente.map(c => {
              // Por id del cliente del directorio (spec 2026-10-11).
              const active = f.fClient.includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => dispatch({ type: 'toggleClient', id: c.id })}
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-1 text-etiqueta font-semibold transition-colors ${
                    active ? 'border-accent bg-accent text-white' : 'border-border bg-white text-informativo hover:bg-bg-main'
                  }`}
                >
                  {c.name} <span className="tabular-nums opacity-70">{c.count}</span>
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
                <Button size="sm" onClick={() => dispatch({ type: 'clear' })}>
                  <X size={11} aria-hidden="true" />
                  Limpiar
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-bg-main px-1 text-etiqueta font-bold">{activeCount}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div role="alert" className="rounded-xl border border-status-incidente/20 bg-status-incidente/5 px-4 py-3 text-dato text-status-incidente">{error}</div>
          )}

          {/* El aviso vive UNA vez, arriba, y es un filtro — no un chip
              repetido en cada fila. Sólo cuando ya llegó el dato: un "0"
              mientras la consulta está en vuelo afirma algo falso. */}
          {f.tab === 'en_curso' && !loading && personasSinIdentificar > 0 && (
            <button
              type="button"
              onClick={() => setSoloSinIdentificar(v => !v)}
              aria-pressed={soloSinIdentificar}
              className={`self-start inline-flex items-center gap-2 rounded-full border px-3 py-1 text-etiqueta font-semibold transition-colors ${
                soloSinIdentificar
                  ? 'border-espera bg-espera/10 text-espera'
                  : 'border-border ${TEXTO_CUERPO} hover:bg-bg-main'
              }`}
            >
              <span className="text-dato">{personasSinIdentificar}</span>
              {personasSinIdentificar === 1 ? 'conductor sin identificar' : 'conductores sin identificar'}
              {soloSinIdentificar && <X size={12} />}
            </button>
          )}

          {/* La tabla: en refetch la data anterior queda visible, atenuada (sin flash de spinner) */}
          {loading ? (
            <Estado tipo="cargando" />
          ) : (
            <div className={`transition-opacity duration-150 ${fetching ? 'opacity-50' : ''}`} aria-busy={fetching}>
              <>
                {/* Sólo si hay algo que esta persona pueda anular en la vista:
                    los viajes manuales que creó (o todos, con trips.void_any). */}
                {anulacion.hayAnulables && (
                  <div className="mb-2 rounded-lg overflow-hidden border border-border bg-white">
                    <BarraDeSeleccion
                      seleccionados={anulacion.seleccion.ids.size}
                      ayuda="marca los viajes manuales que quieras anular"
                      onLimpiar={anulacion.limpiar}
                      destructiva={{
                        etiqueta:     `Anular ${cuantos(anulacion.seleccion.ids.size, 'viaje')}`,
                        advertencia:  'Quedan anulados con su motivo; no se borran',
                        motivos:      { etiqueta: 'Motivo', opciones: motivosDeAnulacion, cargando: cargandoMotivos },
                        icono:        Ban,
                        confirmacion: `Sí, anular ${anulacion.seleccion.ids.size}`,
                        onConfirmar:  eleccion => anulacion.anularSeleccion(eleccion!),
                        ocupado:      anulacion.ocupado,
                      }}
                    />
                    {anulacion.error && (
                      <p role="alert" className="px-3 py-2 text-etiqueta text-status-incidente bg-status-incidente/5 border-t border-status-incidente/20">
                        {anulacion.error}
                      </p>
                    )}
                  </div>
                )}
                <TripTable
                  trips={visibleTrips}
                  seleccion={anulacion.seleccion}
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
                  onAsignarConductor={puedeEditar ? setAsignando : undefined}
                  onOpenQuickView={puedeVerDirectorio ? quickView.open : undefined}
                />
              </>
            </div>
          )}

          {f.tab === 'en_curso' && (
            <AvisoFueraDeEnCurso
              cantidad={tripsQuery.data?.outside_window_count}
              dias={alertRules.in_progress_idle_days}
              onVer={() => dispatch({ type: 'verActivosEnHistorial' })}
            />
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

        </PageContainer>
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
      {asignando?.driver_name_tms && (
        <Dialog label={`Asignar conductor a ${asignando.driver_name_tms}`} onClose={() => setAsignando(null)}
          className="inset-0 m-auto h-fit w-fit animate-modal-in">
            <AsignarConductorPopover
              nombreTms={asignando.driver_name_tms}
              candidatos={candidatosQuery.data?.candidatos ?? []}
              viajesDeLaPersona={candidatosQuery.data?.trip_ids_de_la_persona.length ?? 0}
              cargando={candidatosQuery.isLoading}
              onCancelar={() => setAsignando(null)}
              onAsignar={async (driverId, aTodos) => {
                const ids = aTodos
                  ? candidatosQuery.data?.trip_ids_de_la_persona ?? [asignando.id]
                  : [asignando.id]
                const asignado = await tripsApi.assignDriver(driverId, ids)
                await queryClient.invalidateQueries({ queryKey: ['trips'] })
                // Con aviso (empresa no habilitada) el popover queda abierto
                // para mostrarlo; "Continuar" lo cierra (D1 §7.1).
                if (asignado.warnings?.length) return asignado.warnings
                setAsignando(null)
              }}
              // NO lleva try/catch acá a propósito: la promesa se le devuelve al
              // popover, que es quien tiene el botón y por lo tanto quien puede
              // mostrar el error, apagar el control y ofrecer la salida. Lo que
              // sí importa es que `setAsignando(null)` viene DESPUÉS del await:
              // si la API falla, el popover queda abierto con lo que se escribió.
              // El alta es la común (AltaDeFlota): crea y después llama a onAsignar.
              puedeDarDeAlta={puedeDarDeAlta}
            />
        </Dialog>
      )}
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
      {quickView.current && (
        <EntityQuickView
          key={`${quickView.current.kind}:${quickView.current.id}`}
          target={quickView.current}
          canGoBack={quickView.canGoBack}
          onNavigate={quickView.navigate}
          onBack={quickView.back}
          onClose={quickView.close}
          returnTo={MONITOR}
          canRequestDocuments={puedePedirDocumentos}
        />
      )}
    </div>
  )
}
