'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ClipboardCheck, AlertTriangle, CheckCircle2, X, Truck } from 'lucide-react'
import { dailyClosuresApi, isClosePendingError } from '@/lib/api/dailyClosures'
import { AlertStatTiles } from './AlertStatTiles'
import type { DriverDayStatusValue, UnassignedReasonMeta } from '@/lib/types'

type Category = 'total' | 'assigned' | 'unassigned' | 'mismatch'

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
  /** Centro de Flota (2026-07-28) — cross-link, no fusión: cuadratura de
   *  conductores y disponibilidad de equipo son vistas separadas. */
  onOpenFleetCenter:  () => void
  /** Abre el viaje real que causó un MISMATCH puntual (ver trip_id en
   *  DriverDayStatusRow) — reemplaza el link genérico a Empresas cuando hay
   *  un viaje concreto al que apuntar. */
  onSelectTrip:       (tripId: string) => void
}

/** "Cerrar el día" (spec 2026-07-21-cuadratura-reporteria-redesign-design.md)
 *  — reemplaza la página aislada de Cuadratura. Se abre desde un botón en el
 *  Diario, hereda la fecha que ya está activa ahí (sin date picker propio).
 *  Reusa 100% el backend de daily_closures.py sin cambios.
 *
 *  Ronda 45 (2026-07-26): las 4 tiles de resumen pasan a ser clickeables
 *  (mismo patrón AlertStatTiles que Empresas) y filtran la tabla de abajo
 *  por categoría completa — antes la tabla solo mostraba lo que faltaba
 *  resolver (mismatch + no asignados sin motivo), sin forma de ver/gestionar
 *  el resto (ej. no asignados que ya tienen motivo, o revisar los
 *  asignados). Sin tile activa, la tabla vuelve al comportamiento original
 *  (solo pendientes) — es el foco real de "cerrar el día". Pedido explícito
 *  del usuario, y coincide con feedback histórico real (Fabian, UAT
 *  2026-07-06: "debería tirarse el listado entero... debería quedarte como
 *  todo lo pendiente ahí en esa ventana"). */
export function CloseDayDialog({ open, fecha, canAdmin, unassignedReasons, onClose, onOpenFleetCenter, onSelectTrip }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')
  const [closeErr, setCloseErr] = useState<string | null>(null)
  const [pendingList, setPendingList] = useState<{ driver_id: string; full_name: string; status: string }[] | null>(null)
  const [savingReason, setSavingReason] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [category, setCategory] = useState<Category | ''>('')

  const { data, isLoading } = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setOverrideOpen(false); setOverrideNote(''); setCloseErr(null); setPendingList(null); setCategory('')
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

  // Sin categoría activa: comportamiento original (solo lo que falta
  // resolver para poder cerrar el día). Con una tile clickeada: la
  // categoría completa, incluyendo filas que ya no requieren acción (ej.
  // no asignados con motivo ya puesto, o los asignados para revisar).
  const displayedDrivers = !data ? [] : (
    category === 'total'      ? data.drivers :
    category === 'assigned'   ? data.drivers.filter(d => d.status === 'ASSIGNED') :
    category === 'unassigned' ? data.drivers.filter(d => d.status === 'UNASSIGNED') :
    category === 'mismatch'   ? data.drivers.filter(d => d.status === 'MISMATCH') :
    data.drivers.filter(d => d.status === 'MISMATCH' || (d.status === 'UNASSIGNED' && !d.unassigned_reason_id))
  )
  const showTable = !!data && (category !== '' || data.pending_count > 0)

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
            <button
              type="button"
              onClick={onOpenFleetCenter}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-accent transition-colors"
            >
              <Truck size={12} /> Ver equipos disponibles
            </button>

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

                {/* Resumen básico y operativo — clickeable, filtra la tabla de abajo por categoría */}
                <AlertStatTiles
                  tiles={[
                    { id: 'total', label: 'Total', value: data.total_drivers, tone: 'neutral' },
                    { id: 'assigned', label: 'Asignados', value: data.assigned_count, tone: 'success' },
                    { id: 'unassigned', label: 'No asignados', value: data.unassigned_count, tone: 'neutral' },
                    { id: 'mismatch', label: 'Por regularizar', value: data.mismatch_count, tone: 'danger' },
                  ]}
                  active={category}
                  onSelect={id => setCategory(prev => (prev === id ? '' : id) as Category | '')}
                />

                {showTable && (
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
                        {displayedDrivers.length === 0 && (
                          <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-300 italic">Sin conductores en esta categoría</td></tr>
                        )}
                        {displayedDrivers
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
                                  <>
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
                                    {/* Ronda 43: sugerencia de UI, no un trigger de base de datos — el
                                        operador confirma con el click, no se escribe nada solo. */}
                                    {!d.unassigned_reason_id && d.driver_pending_docs_critical && d.suggested_reason_id && (
                                      <button
                                        type="button"
                                        onClick={() => handleSetReason(d.driver_id, d.suggested_reason_id!)}
                                        className="block text-[10px] text-amber-600 hover:text-amber-800 hover:underline mt-1"
                                      >
                                        Sugerido: {unassignedReasons.find(r => r.id === d.suggested_reason_id)?.label ?? 'Documentación vencida'}
                                      </button>
                                    )}
                                  </>
                                )}
                                {d.status === 'MISMATCH' && (
                                  d.trip_id ? (
                                    <button
                                      type="button"
                                      onClick={() => onSelectTrip(d.trip_id!)}
                                      className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                                    >
                                      <AlertTriangle size={11} /> Ver viaje
                                    </button>
                                  ) : (
                                    <a
                                      href={d.carrier_id ? `/dashboard/transportistas/empresa/${d.carrier_id}` : '/dashboard/transportistas'}
                                      className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                                    >
                                      <AlertTriangle size={11} /> Revisar en Empresas
                                    </a>
                                  )
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
