'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Truck, X, Search, ChevronDown, ArrowRight, ClipboardCheck } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { AlertStatTiles } from './AlertStatTiles'
import type { AvailableAsset } from '@/lib/types'
import type { FleetAssignValue } from './FleetAssignSection'

type Category = 'never' | 'released' | 'busy' | ''

interface Props {
  open:           boolean
  fecha:          string
  onClose:        () => void
  onOpenCloseDay: () => void
  onAssign:       (fleet: FleetAssignValue) => void
  onNewTrip:      () => void
  onImportCsv:    () => void
}

function toFleetValue(a: AvailableAsset): FleetAssignValue {
  return {
    driver_id: a.driver_id, driver_name: a.driver_name, driver_rut: a.driver_rut, driver_phone: a.driver_phone,
    carrier_id: a.carrier_id, carrier_name: a.carrier_name,
    tractor_asset_id: a.asset_id, tractor_plate: a.tractor_plate, trailer_plate: null,
  }
}

/** "Centro de Flota" (spec 2026-07-28-centro-de-flota-design.md) — disponibilidad
 *  de EQUIPO (no de conductor, ver spec) para hoy. Cruzado con CloseDayDialog
 *  por link, no fusionado: la cuadratura de conductores sigue ahí sin cambios.
 *  Reemplaza el pill "conductores disponibles" + los botones "Agregar viaje"
 *  y "Carga masiva (CSV)" del Diario — un solo punto de entrada. */
export function FleetCenterDialog({ open, fecha, onClose, onOpenCloseDay, onAssign, onNewTrip, onImportCsv }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [category, setCategory] = useState<Category>('')
  const [q, setQ] = useState('')
  const [showNewMenu, setShowNewMenu] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['available-assets', fecha],
    queryFn: () => tripsApi.availableAssets(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setCategory(''); setQ(''); setShowNewMenu(false)
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const items = data?.items ?? []
  const neverAssigned = items.filter(i => i.trips_total === 0)
  const released = items.filter(i => i.trips_total > 0)
  const busyCount = Math.max(0, (data?.total_active ?? 0) - items.length)

  const byCategory =
    category === 'never'    ? neverAssigned :
    category === 'released' ? released :
    category === 'busy'     ? [] :
    items

  const qLower = q.trim().toLowerCase()
  const filtered = qLower === '' ? byCategory : byCategory.filter(a =>
    a.tractor_plate.toLowerCase().includes(qLower)
    || (a.carrier_name ?? '').toLowerCase().includes(qLower)
    || (a.driver_name ?? '').toLowerCase().includes(qLower)
  )

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Centro de Flota"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-3xl max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Truck size={16} className="text-accent" /> Centro de Flota — {fecha}
            </h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onOpenCloseDay}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-accent transition-colors"
              >
                <ClipboardCheck size={12} /> Ver cuadratura de conductores
              </button>

              <div className="relative shrink-0">
                <div className="flex">
                  <button
                    type="button"
                    onClick={onNewTrip}
                    className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold px-3.5 py-2 rounded-l-lg hover:bg-accent/90 transition-colors"
                  >
                    Nuevo viaje
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewMenu(v => !v)}
                    aria-label="Más opciones de creación"
                    aria-expanded={showNewMenu}
                    className="flex items-center bg-accent text-white px-2 rounded-r-lg border-l border-white/25 hover:bg-accent/90 transition-colors"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                {showNewMenu && (
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-border rounded-lg shadow-lg z-10 text-xs overflow-hidden">
                    <button type="button" onClick={() => { setShowNewMenu(false); onNewTrip() }} className="w-full text-left px-3 py-2 hover:bg-gray-50">
                      Viaje individual
                    </button>
                    <button type="button" onClick={() => { setShowNewMenu(false); onImportCsv() }} className="w-full text-left px-3 py-2 hover:bg-gray-50 border-t border-border/60">
                      Importar CSV (varios)
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isLoading || !data ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <>
                <AlertStatTiles
                  tiles={[
                    { id: 'never', label: 'Nunca asignados hoy', value: neverAssigned.length, tone: 'danger' },
                    { id: 'released', label: 'Liberados tras viaje', value: released.length, tone: 'success' },
                    { id: 'busy', label: 'En viaje hoy', value: busyCount, tone: 'neutral' },
                  ]}
                  active={category}
                  onSelect={id => setCategory(prev => (prev === id ? '' : id) as Category)}
                />

                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Buscar patente, conductor o empresa…"
                    aria-label="Buscar equipo"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
                  />
                </div>

                <div className="bg-white rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                        <th className="text-left px-3 py-2">Patente</th>
                        <th className="text-left px-3 py-2">Empresa</th>
                        <th className="text-left px-3 py-2">Conductor habitual</th>
                        <th className="text-left px-3 py-2">Última actividad</th>
                        <th className="text-right px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {category === 'busy' ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-300 italic">
                          En viaje ahora — revisalos en el Diario, no en Centro de Flota
                        </td></tr>
                      ) : filtered.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-300 italic">Sin equipos en esta categoría</td></tr>
                      ) : filtered.map(a => (
                        <tr key={a.asset_id}>
                          <td className="px-3 py-2 font-semibold text-text-primary">{a.tractor_plate}</td>
                          <td className="px-3 py-2">{a.carrier_name ?? '—'}</td>
                          <td className="px-3 py-2">
                            {a.driver_name ?? <span className="text-amber-600">Sin conductor asignado hoy</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            {a.trips_total === 0
                              ? 'Sin viajes hoy'
                              : a.last_report_at
                                ? `Cerró viaje ${new Date(a.last_report_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
                                : 'Liberado'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => onAssign(toFleetValue(a))}
                              className="flex items-center gap-1 ml-auto text-[11px] font-semibold text-accent hover:text-accent/80"
                            >
                              Asignar viaje <ArrowRight size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
