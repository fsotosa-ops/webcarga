'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ClipboardCheck, CheckCircle2, X, Truck } from 'lucide-react'
import { equipmentClosuresApi, isEquipmentClosePendingError } from '@/lib/api/equipmentClosures'
import { AlertStatTiles } from './AlertStatTiles'
import type { EquipmentDayStatusRow, UnassignedReasonMeta } from '@/lib/types'

type Category = 'total' | 'assigned' | 'unassigned' | ''

interface Props {
  open:              boolean
  fecha:             string
  canAdmin:          boolean
  unassignedReasons: UnassignedReasonMeta[]
  onClose:           () => void
  onOpenFleetCenter: () => void
}

/** "Cerrar el día" — Fase 4, HU-03. Reemplaza a CloseDayDialog (cierre por
 *  conductor) como el flujo que la UI usa: el cierre ahora es por
 *  TRACTO/EQUIPO (confirmado contra HU_CierreDelDia_Diario2.md 30/07 — ver
 *  AGENTLOG.md). BLOQUE 1 (Tractoreo, incluye "Sin clasificar" mientras el
 *  tracto no tenga fleet_service_type_id clasificado): cierre activo,
 *  motivo obligatorio, selección masiva con checkbox. BLOQUE 2 (Equipos
 *  Completos): cierre pasivo, solo resumen por empresa, nunca bloquea. El
 *  conductor se sigue mostrando junto a cada tracto (ya no es la unidad que
 *  se cierra) — mismo patrón que Centro de Flota. */
export function EquipmentCloseDayDialog({ open, fecha, canAdmin, unassignedReasons, onClose, onOpenFleetCenter }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<Category>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchReason, setBatchReason] = useState('')
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingReason, setSavingReason] = useState<string | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')
  const [closeErr, setCloseErr] = useState<string | null>(null)
  const [pendingList, setPendingList] = useState<{ asset_id: string; tractor_plate: string }[] | null>(null)
  const [closing, setClosing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['equipment-closure', fecha],
    queryFn: () => equipmentClosuresApi.get(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setCategory(''); setSelected(new Set()); setBatchReason('')
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

  async function handleSetReason(assetId: string, reasonId: string) {
    setSavingReason(assetId)
    try {
      await equipmentClosuresApi.setReasonBatch(fecha, [assetId], reasonId)
      await queryClient.invalidateQueries({ queryKey: ['equipment-closure', fecha] })
    } finally {
      setSavingReason(null)
    }
  }

  async function handleApplyBatch() {
    if (!batchReason || selected.size === 0) return
    setSavingBatch(true)
    try {
      await equipmentClosuresApi.setReasonBatch(fecha, Array.from(selected), batchReason)
      setSelected(new Set()); setBatchReason('')
      await queryClient.invalidateQueries({ queryKey: ['equipment-closure', fecha] })
    } finally {
      setSavingBatch(false)
    }
  }

  async function handleClose(override?: boolean) {
    setClosing(true); setCloseErr(null)
    try {
      await equipmentClosuresApi.close(fecha, override, overrideNote)
      setPendingList(null); setOverrideOpen(false); setOverrideNote('')
      await queryClient.invalidateQueries({ queryKey: ['equipment-closure', fecha] })
    } catch (e) {
      if (isEquipmentClosePendingError(e)) {
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

  const tractoreo = data?.tractoreo.equipment ?? []
  const displayedTractoreo =
    category === 'total'      ? tractoreo :
    category === 'assigned'   ? tractoreo.filter(e => e.status === 'ASSIGNED') :
    category === 'unassigned' ? tractoreo.filter(e => e.status === 'UNASSIGNED') :
    tractoreo.filter(e => e.status === 'UNASSIGNED' && !e.unassigned_reason_id)
  const showTable = !!data && (category !== '' || (data.tractoreo.pending_count ?? 0) > 0)

  function toggleSelected(assetId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId)
      return next
    })
  }

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
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <ClipboardCheck size={16} className="text-accent" /> Cerrar el día — {fecha}
            </h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
                      Día cerrado — {data.closure.resolved_count}/{data.closure.total_equipment} resueltos
                      {data.closure.override_count > 0 && `, ${data.closure.override_count} con override`}.
                    </p>
                  </div>
                )}

                {/* BLOQUE 1 — Tractoreo (cierre activo) */}
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Tractoreo — {data.tractoreo.summary.utilization_pct}% utilización
                  </p>
                  <AlertStatTiles
                    tiles={[
                      { id: 'total', label: 'Total', value: data.tractoreo.summary.total, tone: 'neutral' },
                      { id: 'assigned', label: 'Asignados', value: data.tractoreo.summary.assigned, tone: 'success' },
                      { id: 'unassigned', label: 'Sin asignar', value: data.tractoreo.summary.unassigned, tone: 'neutral' },
                      { id: '', label: 'Pendientes', value: data.tractoreo.pending_count, tone: 'danger' },
                    ]}
                    active={category}
                    onSelect={id => setCategory(prev => (prev === id ? '' : id) as Category)}
                  />

                  {selected.size > 0 && (
                    <div className="flex items-center gap-2 bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
                      <span className="text-[11px] font-semibold text-text-primary">{selected.size} seleccionados</span>
                      <select
                        aria-label="Motivo para la selección"
                        value={batchReason}
                        onChange={e => setBatchReason(e.target.value)}
                        className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                      >
                        <option value="">— Elegir motivo —</option>
                        {unassignedReasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={!batchReason || savingBatch}
                        onClick={handleApplyBatch}
                        className="text-[11px] font-semibold bg-accent text-white rounded-lg px-3 py-1 disabled:opacity-50"
                      >
                        {savingBatch ? 'Aplicando…' : 'Aplicar a todos'}
                      </button>
                    </div>
                  )}

                  {showTable && (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            <th className="text-left px-3 py-2 w-8" />
                            <th className="text-left px-3 py-2">Patente</th>
                            <th className="text-left px-3 py-2">Tipo Vehículo</th>
                            <th className="text-left px-3 py-2">Empresa</th>
                            <th className="text-left px-3 py-2">Conductor</th>
                            <th className="text-left px-3 py-2">CD de origen</th>
                            <th className="text-left px-3 py-2">Motivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {displayedTractoreo.length === 0 && (
                            <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-300 italic">Sin equipos en esta categoría</td></tr>
                          )}
                          {displayedTractoreo.map((e: EquipmentDayStatusRow) => (
                            <tr key={e.asset_id}>
                              <td className="px-3 py-2">
                                {e.status === 'UNASSIGNED' && (
                                  <input
                                    type="checkbox"
                                    aria-label={`Seleccionar ${e.tractor_plate}`}
                                    checked={selected.has(e.asset_id)}
                                    onChange={() => toggleSelected(e.asset_id)}
                                  />
                                )}
                              </td>
                              <td className="px-3 py-2 font-semibold text-text-primary">{e.tractor_plate}</td>
                              <td className="px-3 py-2">
                                {e.fleet_service_type_label ? (
                                  <span
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                    style={{
                                      backgroundColor: e.fleet_service_type_bg_color ?? undefined,
                                      color: e.fleet_service_type_text_color ?? undefined,
                                    }}
                                  >
                                    {e.fleet_service_type_label}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 italic">Sin clasificar</span>
                                )}
                              </td>
                              <td className="px-3 py-2">{e.carrier_name ?? '—'}</td>
                              <td className="px-3 py-2">{e.driver_name ?? <span className="text-gray-400">—</span>}</td>
                              <td className="px-3 py-2 text-gray-400">{e.last_known_origin ?? '—'}</td>
                              <td className="px-3 py-2">
                                {e.status === 'ASSIGNED' ? (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">
                                    Con carga
                                  </span>
                                ) : (
                                  <select
                                    value={e.unassigned_reason_id ?? ''}
                                    disabled={savingReason === e.asset_id}
                                    onChange={ev => handleSetReason(e.asset_id, ev.target.value)}
                                    className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                                  >
                                    <option value="">— Sin especificar —</option>
                                    {unassignedReasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                                  </select>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* BLOQUE 2 — Equipos Completos (cierre pasivo, solo resumen) */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    Equipos Completos — {data.equipos_completos.summary.utilization_pct}% utilización (no bloquea el cierre)
                  </p>
                  <div className="bg-white rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                          <th className="text-left px-3 py-2">Empresa</th>
                          <th className="text-right px-3 py-2">Enrolados</th>
                          <th className="text-right px-3 py-2">Asignados</th>
                          <th className="text-right px-3 py-2">No asignados</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {data.equipos_completos.by_carrier.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-300 italic">Sin equipos completos hoy</td></tr>
                        )}
                        {data.equipos_completos.by_carrier.map(b => (
                          <tr key={b.carrier_id ?? 'sin_empresa'}>
                            <td className="px-3 py-2 font-medium text-text-primary">{b.carrier_name ?? '—'}</td>
                            <td className="px-3 py-2 text-right">{b.enrolled}</td>
                            <td className="px-3 py-2 text-right text-green-700">{b.assigned}</td>
                            <td className="px-3 py-2 text-right text-gray-400">{b.unassigned}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {!data.closed && (
                  <div className="space-y-3">
                    {closeErr && (
                      <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{closeErr}</p>
                    )}
                    {pendingList && pendingList.length > 0 && (
                      <ul className="text-[11px] text-gray-500 list-disc list-inside">
                        {pendingList.map(p => <li key={p.asset_id}>{p.tractor_plate}</li>)}
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
                      disabled={closing || data.tractoreo.pending_count > 0}
                      onClick={() => handleClose(false)}
                      title={data.tractoreo.pending_count > 0 ? `${data.tractoreo.pending_count} tracto(s) sin resolver` : undefined}
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
