'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ClipboardCheck, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { dailyClosuresApi, isClosePendingError } from '@/lib/api/dailyClosures'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { AlertStatTiles, type AlertStatTile } from '@/components/dashboard/AlertStatTiles'
import type { DriverDayStatusValue } from '@/lib/types'

const ADMIN_ROLES = new Set(['admin', 'owner'])

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

const STATUS_LABEL: Record<DriverDayStatusValue, string> = {
  ASSIGNED: 'Asignado', UNASSIGNED: 'No asignado', MISMATCH: 'Mismatch',
}
const STATUS_CLS: Record<DriverDayStatusValue, string> = {
  ASSIGNED:   'bg-green-50 text-green-700 border-green-200',
  UNASSIGNED: 'bg-amber-50 text-amber-700 border-amber-200',
  MISMATCH:   'bg-red-50 text-red-700 border-red-200',
}

/** "Cuadratura del día" (Fase 1, HU-01/02/03) — el concepto que Pablo (CEO)
 *  describió como "cuadrar la caja" en la reunión del 20/07: todo conductor
 *  activo debe quedar clasificado antes de poder cerrar el día. Reusa el
 *  catálogo app.unassigned_reasons (ya usado en TripSlideOver) y el patrón
 *  de tiles clickeables ya validado en Empresas/Seguros. */
export default function CuadraturaPage() {
  const [fecha, setFecha] = useState(todayISO())
  const [statusFilter, setStatusFilter] = useState<'' | DriverDayStatusValue>('')
  const [canAdmin, setCanAdmin] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')
  const [closeErr, setCloseErr] = useState<string | null>(null)
  const [pendingList, setPendingList] = useState<{ driver_id: string; full_name: string; status: string }[] | null>(null)
  const [savingReason, setSavingReason] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })

  const { data: meta } = useQuery({ queryKey: ['trips-meta'], queryFn: fetchTripsMeta })

  const tiles: AlertStatTile[] = useMemo(() => [
    { id: '', label: 'Total', value: data?.total_drivers ?? 0, tone: 'neutral' },
    { id: 'ASSIGNED', label: 'Asignados', value: data?.assigned_count ?? 0, tone: 'success' },
    { id: 'UNASSIGNED', label: 'No asignados', value: data?.unassigned_count ?? 0, tone: 'neutral' },
    { id: 'MISMATCH', label: 'Mismatch', value: data?.mismatch_count ?? 0, tone: 'danger' },
  ], [data])

  const drivers = useMemo(() => {
    if (!data) return []
    return statusFilter ? data.drivers.filter(d => d.status === statusFilter) : data.drivers
  }, [data, statusFilter])

  async function handleSetReason(driverId: string, reasonId: string) {
    setSavingReason(driverId)
    try {
      await dailyClosuresApi.setReason(driverId, fecha, reasonId)
      await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    } finally {
      setSavingReason(null)
    }
  }

  async function handleClose(override?: boolean) {
    setClosing(true); setCloseErr(null)
    try {
      await dailyClosuresApi.close(fecha, override, overrideNote)
      setPendingList(null)
      setOverrideOpen(false)
      setOverrideNote('')
      await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    } catch (e) {
      if (isClosePendingError(e)) {
        setPendingList(e.detail.pending)
        setCloseErr(e.detail.message)
      } else {
        setCloseErr(e instanceof Error ? e.message : 'No se pudo cerrar el día')
      }
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <ClipboardCheck size={18} className="text-accent" /> Cuadratura del día
        </h1>
        <input
          type="date"
          value={fecha}
          onChange={e => setFecha(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5"
        />
      </div>

      {data?.closed && data.closure && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          <p className="text-xs text-green-800">
            Día cerrado — {data.closure.resolved_count}/{data.closure.total_drivers} resueltos
            {data.closure.override_count > 0 && `, ${data.closure.override_count} con override`}.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : data && (
        <>
          <AlertStatTiles tiles={tiles} active={statusFilter} onSelect={id => setStatusFilter(id as typeof statusFilter)} />

          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Conductor</th>
                  <th className="text-left px-4 py-2.5">Empresa</th>
                  <th className="text-left px-4 py-2.5">Estado</th>
                  <th className="text-left px-4 py-2.5">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {drivers.map(d => (
                  <tr key={d.driver_id}>
                    <td className="px-4 py-2.5 font-medium text-text-primary">{d.full_name}</td>
                    <td className="px-4 py-2.5 text-gray-500">{d.carrier_name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[d.status]}`}>
                        {STATUS_LABEL[d.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {d.status === 'UNASSIGNED' && (
                        <select
                          value={d.unassigned_reason_id ?? ''}
                          disabled={savingReason === d.driver_id}
                          onChange={e => handleSetReason(d.driver_id, e.target.value)}
                          className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                        >
                          <option value="">— Sin especificar —</option>
                          {meta?.unassigned_reasons.map(r => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </select>
                      )}
                      {d.status === 'MISMATCH' && (
                        <span className="text-[11px] text-red-500 flex items-center gap-1">
                          <AlertTriangle size={11} /> Revisar en Empresas
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {drivers.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-300 italic">Sin conductores para este filtro</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {!data.closed && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-3">
              {closeErr && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{closeErr}</p>
              )}
              {pendingList && pendingList.length > 0 && (
                <ul className="text-[11px] text-gray-500 list-disc list-inside">
                  {pendingList.map(p => <li key={p.driver_id}>{p.full_name} — {STATUS_LABEL[p.status as DriverDayStatusValue] ?? p.status}</li>)}
                </ul>
              )}
              {pendingList && pendingList.length > 0 && canAdmin && !overrideOpen && (
                <button type="button" onClick={() => setOverrideOpen(true)} className="text-[11px] font-semibold text-amber-700 underline">
                  Forzar cierre con override
                </button>
              )}
              {overrideOpen && (
                <div className="space-y-2">
                  <textarea
                    value={overrideNote}
                    onChange={e => setOverrideNote(e.target.value)}
                    placeholder="Comentario de justificación (obligatorio)"
                    className="w-full text-xs border border-border rounded-lg px-3 py-2"
                    rows={2}
                  />
                  <button
                    type="button"
                    disabled={closing || !overrideNote.trim()}
                    onClick={() => handleClose(true)}
                    className="text-xs font-semibold bg-amber-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
                  >
                    {closing ? 'Cerrando…' : 'Confirmar override y cerrar'}
                  </button>
                </div>
              )}
              <button
                type="button"
                disabled={closing || data.pending_count > 0}
                onClick={() => handleClose(false)}
                title={data.pending_count > 0 ? `${data.pending_count} conductor(es) sin resolver` : undefined}
                className="w-full text-sm font-semibold bg-accent text-white rounded-lg py-2 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {closing ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
                Cerrar día
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
