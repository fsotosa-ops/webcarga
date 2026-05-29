'use client'

import { useEffect, useState, useCallback } from 'react'
import { Search, Loader2, ChevronLeft, ChevronRight, X, Plus, PenLine } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { filterGroupsApi, type FilterGroup, type GroupColor } from '@/lib/api/filterGroups'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import type { Trip, ComplianceAlertSummary, TripsMeta } from '@/lib/types'
import { TripTable } from '@/components/dashboard/TripTable'
import { TripSlideOver } from '@/components/dashboard/TripSlideOver'
import { GroupBuilder } from '@/components/dashboard/GroupBuilder'

type Tab        = 'en_curso' | 'historial'
type BoolFilter = boolean | null

const HISTORIAL_LIMIT = 100

// ── Default status categories ─────────────────────────────────────────────────
const STATUS_GROUPS = [
  { id: 'en_ruta',    label: 'En Ruta',    statuses: ['ASIGNADO', 'ORIGEN', 'RUTA'],              on: 'bg-blue-500  border-blue-500  text-white', off: 'text-blue-600  border-blue-200  bg-blue-50/70  hover:border-blue-300'   },
  { id: 'en_local',   label: 'En Local',   statuses: ['EN LOCAL', 'VIAJE EN PREDIO'],              on: 'bg-orange-500 border-orange-500 text-white', off: 'text-orange-600 border-orange-200 bg-orange-50/70 hover:border-orange-300' },
  { id: 'retornando', label: 'Retornando', statuses: ['RETORNANDO', 'RETORNADO CD'],               on: 'bg-cyan-500   border-cyan-500   text-white', off: 'text-cyan-700   border-cyan-200   bg-cyan-50/70   hover:border-cyan-300'   },
  { id: 'cerrado',    label: 'Cerrados',   statuses: ['CERRADO FINALIZADO', 'CERRADO INCOMPLETO', 'CERRADO MANUAL', 'CERRADO SIN GPS', 'CERRADO POR OTRO VIAJE', 'CERRADO FINALIZADO CC'], on: 'bg-slate-500  border-slate-500  text-white', off: 'text-slate-600  border-slate-200  bg-slate-50/70  hover:border-slate-300' },
  { id: 'problema',   label: 'Problema',   statuses: ['CANCELADO', 'EN PANA', 'DEVUELTO'],         on: 'bg-red-500    border-red-500    text-white', off: 'text-red-600    border-red-200    bg-red-50/70    hover:border-red-300'     },
] as const

type DefaultGroupId = (typeof STATUS_GROUPS)[number]['id']

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

const FLAG_CHIPS = [
  { label: 'Activo',     on: 'bg-blue-500   border-blue-500   text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-blue-200   hover:text-blue-600'   },
  { label: 'Trabajando', on: 'bg-green-500  border-green-500  text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-green-200  hover:text-green-600'  },
  { label: 'Asignado',   on: 'bg-violet-500 border-violet-500 text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-violet-200 hover:text-violet-600' },
  { label: '1ra Vuelta', on: 'bg-amber-500  border-amber-500  text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-amber-200  hover:text-amber-600'  },
] as const

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

// ─────────────────────────────────────────────────────────────────────────────
export default function DiarioPage() {
  const [tab,            setTab]            = useState<Tab>('en_curso')
  const [fecha,          setFecha]          = useState(todayISO)
  const [q,              setQ]              = useState('')
  const [fechaDesde,     setFechaDesde]     = useState('')
  const [fechaHasta,     setFechaHasta]     = useState('')
  // Active group: 'default:id' or 'custom:id'
  const [activeGroup,    setActiveGroup]    = useState<string | null>(null)
  const [fActivo,        setFActivo]        = useState<BoolFilter>(null)
  const [fTrabajando,    setFTrabajando]    = useState<BoolFilter>(null)
  const [fAsignado,      setFAsignado]      = useState<BoolFilter>(null)
  const [fPrimeraVuelta, setFPrimeraVuelta] = useState<BoolFilter>(null)
  const [page,           setPage]           = useState(1)

  const [trips,          setTrips]          = useState<Trip[]>([])
  const [total,          setTotal]          = useState(0)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)
  const [selected,       setSelected]       = useState<Trip | null>(null)
  const [alertSummary,   setAlertSummary]   = useState<ComplianceAlertSummary | null>(null)
  const [tripsMeta,      setTripsMeta]      = useState<TripsMeta | null>(null)

  // Custom groups
  const [customGroups,   setCustomGroups]   = useState<FilterGroup[]>([])
  const [showBuilder,    setShowBuilder]    = useState(false)
  const [editingGroup,   setEditingGroup]   = useState<FilterGroup | undefined>(undefined)

  const today   = todayISO()
  const isToday = fecha === today

  // Resolve active group statuses
  const statusParam = (() => {
    if (!activeGroup) return ''
    if (activeGroup.startsWith('default:')) {
      const id = activeGroup.slice(8) as DefaultGroupId
      return STATUS_GROUPS.find(g => g.id === id)?.statuses.join(',') ?? ''
    }
    // custom:uuid
    const id = activeGroup.slice(7)
    return customGroups.find(g => g.id === id)?.statuses.join(',') ?? ''
  })()

  const activeCount = [
    q, fechaDesde, fechaHasta, activeGroup,
    fActivo, fTrabajando, fAsignado, fPrimeraVuelta,
  ].filter(v => v !== '' && v !== null).length

  function clearFilters() {
    setQ(''); setFechaDesde(''); setFechaHasta('')
    setActiveGroup(null)
    setFActivo(null); setFTrabajando(null); setFAsignado(null); setFPrimeraVuelta(null)
    setPage(1)
  }

  function toggleDefaultGroup(id: string) {
    const key = `default:${id}`
    setActiveGroup(prev => (prev === key ? null : key))
    setPage(1)
  }

  function toggleCustomGroup(id: string) {
    const key = `custom:${id}`
    setActiveGroup(prev => (prev === key ? null : key))
    setPage(1)
  }

  function toggleFlag(val: BoolFilter, setter: React.Dispatch<React.SetStateAction<BoolFilter>>) {
    setter(prev => (prev === true ? null : true))
    setPage(1)
  }

  const load = useCallback(() => {
    setLoading(true); setError(null)
    const boolParams = {
      ...(fActivo        != null ? { activo:         fActivo }        : {}),
      ...(fTrabajando    != null ? { trabajando:     fTrabajando }    : {}),
      ...(fAsignado      != null ? { asignado:       fAsignado }      : {}),
      ...(fPrimeraVuelta != null ? { primera_vuelta: fPrimeraVuelta } : {}),
    }
    const params =
      tab === 'en_curso'
        ? { fecha, view: 'en_curso' as const, q, status: statusParam, limit: 200, ...boolParams }
        : { view: 'historial' as const, q, fecha_desde: fechaDesde, fecha_hasta: fechaHasta,
            status: statusParam, limit: HISTORIAL_LIMIT, page, ...boolParams }

    tripsApi.list(params)
      .then(res => { setTrips(res.data); setTotal(res.count) })
      .catch(e => setError(e instanceof Error ? e.message : 'Error cargando viajes'))
      .finally(() => setLoading(false))
  }, [tab, fecha, q, fechaDesde, fechaHasta, statusParam, fActivo, fTrabajando, fAsignado, fPrimeraVuelta, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    transportersApi.getComplianceAlertSummary().then(setAlertSummary).catch(console.error)
    filterGroupsApi.list().then(setCustomGroups).catch(console.error)
    fetchTripsMeta().then(setTripsMeta).catch(() => { /* fallback gracioso — usa defaults en TripTable/TripSlideOver */ })
  }, [])

  function handleSaved(updated: Trip) {
    setSelected(updated)
    setTrips(prev => prev.map(t => (t.id === updated.id ? updated : t)))
  }

  function handleGroupSaved(group: FilterGroup) {
    setCustomGroups(prev => {
      const exists = prev.find(g => g.id === group.id)
      return exists ? prev.map(g => g.id === group.id ? group : g) : [...prev, group]
    })
  }

  function handleGroupDeleted(id: string) {
    setCustomGroups(prev => prev.filter(g => g.id !== id))
    if (activeGroup === `custom:${id}`) setActiveGroup(null)
  }

  const totalPages = Math.max(1, Math.ceil(total / HISTORIAL_LIMIT))

  return (
    <div className="flex h-full overflow-hidden relative">
      {showBuilder && (
        <GroupBuilder
          editing={editingGroup}
          onSaved={handleGroupSaved}
          onDeleted={handleGroupDeleted}
          onClose={() => { setShowBuilder(false); setEditingGroup(undefined) }}
          statuses={tripsMeta?.statuses}
        />
      )}

      {/* ── Main ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-4 md:p-6 space-y-4 flex-1 overflow-y-auto">

          {/* Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-mulish font-bold text-xl text-text-primary capitalize">
                {tab === 'en_curso' ? fmtDate(fecha) : 'Base Histórica'}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {loading ? '…' : `${total.toLocaleString('es-CL')} viaje${total !== 1 ? 's' : ''}`}
              </p>
            </div>

            {tab === 'en_curso' && (
              <div className="flex items-center bg-white border border-border rounded-lg p-0.5 shrink-0">
                <button onClick={() => setFecha(shiftDay(fecha, -1))} className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-500">
                  <ChevronLeft size={16} />
                </button>
                {!isToday && (
                  <button onClick={() => setFecha(today)} className="px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/5 rounded-md transition-colors">
                    Hoy
                  </button>
                )}
                <button
                  onClick={() => { if (!isToday) setFecha(shiftDay(fecha, 1)) }}
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
                onClick={() => { setTab(t.key); setPage(1) }}
                className={`pb-2.5 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Filter bar ───────────────────────────────────────────── */}
          <div className="bg-white border border-border rounded-xl px-3.5 py-3 space-y-3">

            {/* Row 1 — search + date range + clear */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  value={q}
                  onChange={e => { setQ(e.target.value); setPage(1) }}
                  placeholder="Tracto, conductor, EETT…"
                  className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-52 bg-white placeholder:text-gray-400 transition-all"
                />
              </div>

              {tab === 'historial' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Desde</span>
                  <input type="date" value={fechaDesde} onChange={e => { setFechaDesde(e.target.value); setPage(1) }}
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all" />
                  <span className="text-gray-300 text-xs">—</span>
                  <input type="date" value={fechaHasta} onChange={e => { setFechaHasta(e.target.value); setPage(1) }}
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all" />
                </div>
              )}

              {activeCount > 0 && (
                <button onClick={clearFilters}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 rounded-lg bg-white transition-colors ml-auto">
                  <X size={11} />
                  Limpiar
                  <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-gray-100 rounded-full text-gray-600">{activeCount}</span>
                </button>
              )}
            </div>

            {/* Row 2 — status groups (default + custom) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-12 shrink-0">Estado</span>

              {/* Default groups */}
              {STATUS_GROUPS.map(g => {
                const key = `default:${g.id}`
                const active = activeGroup === key
                return (
                  <button
                    key={g.id}
                    onClick={() => toggleDefaultGroup(g.id)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${active ? g.on : g.off}`}
                  >
                    {g.label}
                    {active && g.statuses.length > 1 && (
                      <span className="ml-1 opacity-70 text-[9px]">·{g.statuses.length}</span>
                    )}
                  </button>
                )
              })}

              {/* Divider between default and custom */}
              {customGroups.length > 0 && (
                <span className="text-gray-200 text-sm mx-0.5">·</span>
              )}

              {/* Custom groups */}
              {customGroups.map(g => {
                const key = `custom:${g.id}`
                const active = activeGroup === key
                const cls = COLOR_CLS[g.color] ?? COLOR_CLS.blue
                return (
                  <div key={g.id} className="relative group/chip flex items-center">
                    <button
                      onClick={() => toggleCustomGroup(g.id)}
                      className={`text-[11px] font-semibold pl-2.5 pr-1.5 py-1 rounded-full border transition-all flex items-center gap-1 ${active ? cls.on : cls.off}`}
                    >
                      {g.name}
                      {active && g.statuses.length > 1 && (
                        <span className="opacity-70 text-[9px]">·{g.statuses.length}</span>
                      )}
                    </button>
                    {/* Edit button — appears on hover */}
                    <button
                      onClick={e => { e.stopPropagation(); setEditingGroup(g); setShowBuilder(true) }}
                      className="absolute -right-1 -top-1 w-4 h-4 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center opacity-0 group-hover/chip:opacity-100 transition-opacity hover:bg-gray-50"
                      title="Editar grupo"
                    >
                      <PenLine size={8} className="text-gray-500" />
                    </button>
                  </div>
                )
              })}

              {/* Create group button */}
              <button
                onClick={() => { setEditingGroup(undefined); setShowBuilder(true) }}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-accent hover:text-accent transition-all"
                title="Crear grupo personalizado"
              >
                <Plus size={11} />
                Grupo
              </button>
            </div>

            {/* Row 3 — boolean flag chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-12 shrink-0">Mostrar</span>
              {([
                { chip: FLAG_CHIPS[0], val: fActivo,        setter: setFActivo        },
                { chip: FLAG_CHIPS[1], val: fTrabajando,    setter: setFTrabajando    },
                { chip: FLAG_CHIPS[2], val: fAsignado,      setter: setFAsignado      },
                { chip: FLAG_CHIPS[3], val: fPrimeraVuelta, setter: setFPrimeraVuelta },
              ]).map(({ chip, val, setter }) => (
                <button
                  key={chip.label}
                  onClick={() => toggleFlag(val, setter)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${val === true ? chip.on : chip.off}`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : (
            <TripTable
              trips={trips}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              onSaved={handleSaved}
              alertSummary={alertSummary}
              meta={tripsMeta}
            />
          )}

          {/* Historial pagination */}
          {tab === 'historial' && !loading && total > 0 && (
            <div className="flex items-center justify-between pt-2 pb-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-600"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <p className="text-xs text-gray-500">
                {total > HISTORIAL_LIMIT ? (
                  <>Página <span className="font-semibold text-gray-700">{page}</span> de <span className="font-semibold text-gray-700">{totalPages}</span><span className="text-gray-400 ml-2">· {total.toLocaleString('es-CL')} viajes</span></>
                ) : (
                  <span className="text-gray-400">{total.toLocaleString('es-CL')} viaje{total !== 1 ? 's' : ''}</span>
                )}
              </p>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-600"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          )}

        </div>
      </div>

      <TripSlideOver trip={selected} onClose={() => setSelected(null)} onSaved={handleSaved} meta={tripsMeta} />
    </div>
  )
}
