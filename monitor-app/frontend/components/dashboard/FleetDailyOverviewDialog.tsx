'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, LayoutGrid, X, Search } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import type { FleetOverviewCategory, FleetOverviewEquipment } from '@/lib/types'

type CategoryFilter = FleetOverviewCategory['category'] | ''

interface Props {
  open:   boolean
  fecha:  string
  onClose: () => void
  /** Abre el viaje real de un equipo con carga hoy — mismo patrón que
   *  FleetCenterDialog.onSelectTrip. */
  onSelectTrip: (tripId: string) => void
}

const CATEGORY_LABEL: Record<FleetOverviewCategory['category'], string> = {
  TRACTOREO:       'Tractoreo',
  EQUIPO_COMPLETO: 'Equipos Completos',
  SIN_CLASIFICAR:  'Sin clasificar',
}

/** HU-01 (Cierre del Día, Fase 2): "Vista de flota del día" — separa la
 *  flota activa en Tractoreo / Equipos Completos / Sin clasificar (tipo de
 *  operación de la empresa, Fase 1) y muestra CON CARGA / SIN CARGA hoy con
 *  % de utilización por categoría. Cruzado por link con Centro de Flota
 *  (asignar viajes) y Cuadratura (cerrar el día), mismo patrón de modales
 *  cruzados ya establecido — no fusiona responsabilidades. */
export function FleetDailyOverviewDialog({ open, fecha, onClose, onSelectTrip }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [category, setCategory] = useState<CategoryFilter>('')
  const [q, setQ] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['fleet-daily-overview', fecha],
    queryFn: () => tripsApi.fleetDailyOverview(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setCategory(''); setQ('')
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

  const categories = data?.categories ?? []
  const equipment = data?.equipment ?? []

  const byCategory = category === '' ? equipment : equipment.filter(e => e.categories.includes(category))
  const qLower = q.trim().toLowerCase()
  const filtered = qLower === '' ? byCategory : byCategory.filter(e =>
    e.tractor_plate.toLowerCase().includes(qLower)
    || e.carrier_name.toLowerCase().includes(qLower)
    || (e.client_name ?? '').toLowerCase().includes(qLower),
  )

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Vista de Flota del Día"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <LayoutGrid size={16} className="text-accent" /> Vista de Flota del Día — {fecha}
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
                <div className="grid grid-cols-3 gap-2.5">
                  {categories.map(c => {
                    const isActive = category === c.category
                    return (
                      <button
                        key={c.category}
                        type="button"
                        onClick={() => setCategory(prev => (prev === c.category ? '' : c.category))}
                        aria-pressed={isActive}
                        className={`text-left rounded-xl border p-3 transition-colors ${
                          isActive ? 'border-accent bg-accent/5' : 'border-border bg-white hover:border-gray-300'
                        }`}
                      >
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                          {CATEGORY_LABEL[c.category]}
                        </p>
                        <p className="text-xs text-text-primary">
                          <span className="font-bold">{c.assigned}</span> asignados / <span className="font-bold">{c.unassigned}</span> sin asignar
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{c.utilization_pct}% utilización</p>
                      </button>
                    )
                  })}
                </div>

                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Buscar patente, empresa o cliente…"
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
                        <th className="text-left px-3 py-2">Categoría</th>
                        <th className="text-left px-3 py-2">Estado hoy</th>
                        <th className="text-right px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {filtered.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-300 italic">Sin equipos en esta categoría</td></tr>
                      ) : filtered.map((e: FleetOverviewEquipment) => (
                        <tr key={e.asset_id}>
                          <td className="px-3 py-2 font-semibold text-text-primary">{e.tractor_plate}</td>
                          <td className="px-3 py-2">{e.carrier_name}</td>
                          <td className="px-3 py-2 text-gray-400">
                            {e.categories.map(c => CATEGORY_LABEL[c]).join(' + ')}
                          </td>
                          <td className="px-3 py-2">
                            {e.con_carga ? (
                              <span className="text-green-600 font-semibold">Con carga{e.client_name ? ` — ${e.client_name}` : ''}</span>
                            ) : (
                              <span className="text-gray-400">Sin carga</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {e.con_carga && e.trip_id && (
                              <button
                                type="button"
                                onClick={() => onSelectTrip(e.trip_id as string)}
                                className="text-[11px] font-semibold text-accent hover:text-accent/80"
                              >
                                Ver viaje
                              </button>
                            )}
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
