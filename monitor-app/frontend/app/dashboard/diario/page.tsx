'use client'

import { useEffect, useState, useCallback } from 'react'
import { Search, Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import type { Trip, ComplianceAlertSummary } from '@/lib/types'
import { TripTable } from '@/components/dashboard/TripTable'
import { TripSlideOver } from '@/components/dashboard/TripSlideOver'

type Tab        = 'en_curso' | 'historial'
type BoolFilter = boolean | null

const HISTORIAL_LIMIT = 100

// ── Status categories ─────────────────────────────────────────────────────────
// Each category maps to one or more raw status values from current_status_tms.
// The backend receives a comma-joined string and uses = ANY($N::text[]).
const STATUS_GROUPS = [
  {
    id:       'en_ruta',
    label:    'En Ruta',
    statuses: ['ASIGNADO', 'ORIGEN', 'RUTA'],
    on:  'bg-blue-500  border-blue-500  text-white',
    off: 'text-blue-600  border-blue-200  bg-blue-50/70  hover:border-blue-300',
  },
  {
    id:       'en_local',
    label:    'En Local',
    statuses: ['EN LOCAL', 'VIAJE EN PREDIO'],
    on:  'bg-orange-500 border-orange-500 text-white',
    off: 'text-orange-600 border-orange-200 bg-orange-50/70 hover:border-orange-300',
  },
  {
    id:       'retornando',
    label:    'Retornando',
    statuses: ['RETORNANDO', 'RETORNADO CD'],
    on:  'bg-cyan-500   border-cyan-500   text-white',
    off: 'text-cyan-700   border-cyan-200   bg-cyan-50/70   hover:border-cyan-300',
  },
  {
    id:       'cerrado',
    label:    'Cerrados',
    statuses: [
      'CERRADO FINALIZADO', 'CERRADO INCOMPLETO', 'CERRADO MANUAL',
      'CERRADO SIN GPS', 'CERRADO POR OTRO VIAJE', 'CERRADO FINALIZADO CC',
    ],
    on:  'bg-slate-500  border-slate-500  text-white',
    off: 'text-slate-600  border-slate-200  bg-slate-50/70  hover:border-slate-300',
  },
  {
    id:       'problema',
    label:    'Problema',
    statuses: ['CANCELADO', 'EN PANA', 'DEVUELTO'],
    on:  'bg-red-500    border-red-500    text-white',
    off: 'text-red-600    border-red-200    bg-red-50/70    hover:border-red-300',
  },
] as const

type StatusGroupId = (typeof STATUS_GROUPS)[number]['id']

// ── Boolean flag chips ────────────────────────────────────────────────────────
const FLAG_CHIPS = [
  { label: 'Activo',     on: 'bg-blue-500   border-blue-500   text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-blue-200   hover:text-blue-600'   },
  { label: 'Trabajando', on: 'bg-green-500  border-green-500  text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-green-200  hover:text-green-600'  },
  { label: 'Asignado',   on: 'bg-violet-500 border-violet-500 text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-violet-200 hover:text-violet-600' },
  { label: '1ra Vuelta', on: 'bg-amber-500  border-amber-500  text-white', off: 'text-gray-500 border-gray-200 bg-white hover:border-amber-200  hover:text-amber-600'  },
] as const

// ── Date helpers ──────────────────────────────────────────────────────────────
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
  const [statusGroup,    setStatusGroup]    = useState<StatusGroupId | null>(null)
  const [fActivo,        setFActivo]        = useState<BoolFilter>(null)
  const [fTrabajando,    setFTrabajando]    = useState<BoolFilter>(null)
  const [fAsignado,      setFAsignado]      = useState<BoolFilter>(null)
  const [fPrimeraVuelta, setFPrimeraVuelta] = useState<BoolFilter>(null)
  const [page,           setPage]           = useState(1)

  const [trips,        setTrips]        = useState<Trip[]>([])
  const [total,        setTotal]        = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [selected,     setSelected]     = useState<Trip | null>(null)
  const [alertSummary, setAlertSummary] = useState<ComplianceAlertSummary | null>(null)

  const today   = todayISO()
  const isToday = fecha === today

  // Status param: comma-joined list of statuses for the selected group
  const statusParam = statusGroup
    ? STATUS_GROUPS.find(g => g.id === statusGroup)!.statuses.join(',')
    : ''

  // Count active filters for the clear badge
  const activeCount = [
    q, fechaDesde, fechaHasta, statusGroup,
    fActivo, fTrabajando, fAsignado, fPrimeraVuelta,
  ].filter(v => v !== '' && v !== null).length

  function clearFilters() {
    setQ(''); setFechaDesde(''); setFechaHasta('')
    setStatusGroup(null)
    setFActivo(null); setFTrabajando(null); setFAsignado(null); setFPrimeraVuelta(null)
    setPage(1)
  }

  function toggleStatusGroup(id: StatusGroupId) {
    setStatusGroup(prev => (prev === id ? null : id))
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
    transportersApi.getComplianceAlertSummary()
      .then(setAlertSummary).catch(console.error)
  }, [])

  function handleSaved(updated: Trip) {
    setSelected(updated)
    setTrips(prev => prev.map(t => (t.id === updated.id ? updated : t)))
  }

  const totalPages = Math.max(1, Math.ceil(total / HISTORIAL_LIMIT))

  return (
    <div className="flex h-full overflow-hidden relative">

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

            {/* Date navigator */}
            {tab === 'en_curso' && (
              <div className="flex items-center bg-white border border-border rounded-lg p-0.5 shrink-0">
                <button
                  onClick={() => setFecha(shiftDay(fecha, -1))}
                  className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-500"
                >
                  <ChevronLeft size={16} />
                </button>
                {!isToday && (
                  <button
                    onClick={() => setFecha(today)}
                    className="px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/5 rounded-md transition-colors"
                  >
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
                  tab === t.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Filter bar ───────────────────────────────────────────── */}
          <div className="bg-white border border-border rounded-xl px-3.5 py-3 space-y-3">

            {/* Row 1 — search + date range (historial) + clear */}
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
                  <input
                    type="date"
                    value={fechaDesde}
                    onChange={e => { setFechaDesde(e.target.value); setPage(1) }}
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all"
                  />
                  <span className="text-gray-300 text-xs">—</span>
                  <input
                    type="date"
                    value={fechaHasta}
                    onChange={e => { setFechaHasta(e.target.value); setPage(1) }}
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all"
                  />
                </div>
              )}

              {activeCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 rounded-lg bg-white transition-colors ml-auto"
                >
                  <X size={11} />
                  Limpiar
                  <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-gray-100 rounded-full text-gray-600">
                    {activeCount}
                  </span>
                </button>
              )}
            </div>

            {/* Row 2 — status category chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-12 shrink-0">Estado</span>
              {STATUS_GROUPS.map(g => (
                <button
                  key={g.id}
                  onClick={() => toggleStatusGroup(g.id)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                    statusGroup === g.id ? g.on : g.off
                  }`}
                >
                  {g.label}
                  {statusGroup === g.id && (
                    <span className="ml-1 opacity-70 text-[9px]">
                      {g.statuses.length > 1 ? `·${g.statuses.length}` : ''}
                    </span>
                  )}
                </button>
              ))}
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
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                    val === true ? chip.on : chip.off
                  }`}
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
                  <>
                    Página{' '}
                    <span className="font-semibold text-gray-700">{page}</span>
                    {' '}de{' '}
                    <span className="font-semibold text-gray-700">{totalPages}</span>
                    <span className="text-gray-400 ml-2">· {total.toLocaleString('es-CL')} viajes</span>
                  </>
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

      {/* Slide-over */}
      <TripSlideOver trip={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />
    </div>
  )
}
