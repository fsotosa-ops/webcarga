'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ClipboardCheck, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { dailyClosuresApi, isClosePendingError } from '@/lib/api/dailyClosures'
import type { DriverDayStatusValue, UnassignedReasonMeta } from '@/lib/types'

// "Por regularizar" en vez de "Mismatch" (feedback del usuario 2026-07-22:
// el término técnico está fuera del vocabulario operativo de la app) —
// misma palabra que usa Pablo en la reunión del 20/07 para este caso
// exacto ("regularizar la operación sin perder trazabilidad").
const STATUS_LABEL: Record<DriverDayStatusValue, string> = {
  ASSIGNED: 'Asignado', UNASSIGNED: 'No asignado', MISMATCH: 'Por regularizar',
}
const STATUS_CLS: Record<DriverDayStatusValue, string> = {
  ASSIGNED:   'bg-green-50 text-green-700 border-green-200',
  UNASSIGNED: 'bg-amber-50 text-amber-700 border-amber-200',
  MISMATCH:   'bg-red-50 text-red-700 border-red-200',
}

interface Props {
  open:               boolean
  fecha:              string
  canAdmin:           boolean
  unassignedReasons:  UnassignedReasonMeta[]
  onClose:            () => void
}

/** "Cerrar el día" (spec 2026-07-21-cuadratura-reporteria-redesign-design.md)
 *  — reemplaza la página aislada de Cuadratura. Se abre desde un botón en el
 *  Diario, hereda la fecha que ya está activa ahí (sin date picker propio).
 *  Resumen básico + operativo (tiles informativos, no clickeables a un
 *  pivot — esa interacción se removió a pedido del usuario, ahora vive en
 *  Reportería). Reusa 100% el backend de daily_closures.py sin cambios. */
export function CloseDayDialog({ open, fecha, canAdmin, unassignedReasons, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')
  const [closeErr, setCloseErr] = useState<string | null>(null)
  const [pendingList, setPendingList] = useState<{ driver_id: string; full_name: string; status: string }[] | null>(null)
  const [savingReason, setSavingReason] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setOverrideOpen(false); setOverrideNote(''); setCloseErr(null); setPendingList(null)
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

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

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Cerrar el día"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-3xl max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <ClipboardCheck size={16} className="text-accent" /> Cerrar el día — {fecha}
            </h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {isLoading || !data ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <>
                {data.closed && data.closure && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                    <p className="text-xs text-green-800">
                      Día cerrado — {data.closure.resolved_count}/{data.closure.total_drivers} resueltos
                      {data.closure.override_count > 0 && `, ${data.closure.override_count} con override`}.
                    </p>
                  </div>
                )}

                {/* Resumen básico y operativo — informativo, no clickeable */}
                <div className="grid grid-cols-4 gap-2.5">
                  {([
                    ['Total', data.total_drivers, 'text-text-primary'],
                    ['Asignados', data.assigned_count, 'text-green-600'],
                    ['No asignados', data.unassigned_count, 'text-text-primary'],
                    ['Por regularizar', data.mismatch_count, 'text-red-600'],
                  ] as const).map(([label, value, cls]) => (
                    <div key={label} className="border border-border rounded-xl px-3 py-2.5 bg-white">
                      <p className={`text-xl font-bold leading-none ${cls}`}>{value}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{label}</p>
                    </div>
                  ))}
                </div>

                {data.pending_count > 0 && (
                  <div className="bg-white rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                          <th className="text-left px-3 py-2">Conductor</th>
                          <th className="text-left px-3 py-2">Estado</th>
                          <th className="text-left px-3 py-2">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {data.drivers
                          .filter(d => d.status === 'MISMATCH' || (d.status === 'UNASSIGNED' && !d.unassigned_reason_id))
                          .map(d => (
                            <tr key={d.driver_id}>
                              <td className="px-3 py-2 font-medium text-text-primary">{d.full_name}</td>
                              <td className="px-3 py-2">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[d.status]}`}>
                                  {STATUS_LABEL[d.status]}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {d.status === 'UNASSIGNED' && (
                                  <select
                                    value={d.unassigned_reason_id ?? ''}
                                    disabled={savingReason === d.driver_id}
                                    onChange={e => handleSetReason(d.driver_id, e.target.value)}
                                    className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                                  >
                                    <option value="">— Sin especificar —</option>
                                    {unassignedReasons.map(r => (
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
                      </tbody>
                    </table>
                  </div>
                )}

                {!data.closed && (
                  <div className="space-y-3">
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
        </div>
      </div>
    </>
  )
}
