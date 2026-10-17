'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, ChevronDown, ArrowRight, ClipboardCheck } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { SearchInput } from '@/components/ui/SearchInput'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { AlertStatTiles } from './AlertStatTiles'
import type { AvailableAsset, BusyAsset } from '@/lib/types'
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
  /** Abre el viaje real de un equipo ocupado (categoría "En viaje hoy",
   *  Opción B — 2026-07-28). Mismo patrón que CloseDayDialog.onSelectTrip. */
  onSelectTrip:   (tripId: string) => void
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
export function FleetCenterDialog({ open, fecha, onClose, onOpenCloseDay, onAssign, onNewTrip, onImportCsv, onSelectTrip }: Props) {
  const [category, setCategory] = useState<Category>('')
  const [q, setQ] = useState('')
  const [showNewMenu, setShowNewMenu] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['available-assets', fecha],
    queryFn: () => tripsApi.availableAssets(fecha),
    enabled: open,
  })

  // Cada apertura parte limpia. Fondo, Escape y foco son del kit (PanelLateral).
  useEffect(() => {
    if (!open) return
    setCategory(''); setQ(''); setShowNewMenu(false)
  }, [open])

  if (!open) return null

  const items = data?.items ?? []
  const busy = data?.busy ?? []
  const neverAssigned = items.filter(i => i.trips_total === 0)
  const released = items.filter(i => i.trips_total > 0)

  const byCategory =
    category === 'never'    ? neverAssigned :
    category === 'released' ? released :
    items

  const qLower = q.trim().toLowerCase()
  const filtered = qLower === '' ? byCategory : byCategory.filter(a =>
    a.tractor_plate.toLowerCase().includes(qLower)
    || (a.carrier_name ?? '').toLowerCase().includes(qLower)
    || (a.driver_name ?? '').toLowerCase().includes(qLower)
  )
  const filteredBusy = qLower === '' ? busy : busy.filter(a =>
    a.tractor_plate.toLowerCase().includes(qLower)
    || (a.carrier_name ?? '').toLowerCase().includes(qLower)
    || (a.client_name ?? '').toLowerCase().includes(qLower)
  )

  return (
    <PanelLateral placement="center" ancho="amplio" titulo={`Centro de Flota — ${fecha}`} onCerrar={onClose} pie={null}>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onOpenCloseDay}
                className="flex items-center gap-1.5 text-etiqueta font-semibold text-informativo hover:text-accion transition-colors"
              >
                <ClipboardCheck size={12} /> Ver cuadratura de conductores
              </button>

              <div className="relative shrink-0">
                <div className="flex">
                  <button
                    type="button"
                    onClick={onNewTrip}
                    className="flex items-center gap-1.5 bg-accent text-white text-dato font-semibold px-3.5 py-2 rounded-l-lg hover:bg-accent/90 transition-colors"
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
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-border rounded-lg shadow-lg z-10 text-dato overflow-hidden">
                    <button type="button" onClick={() => { setShowNewMenu(false); onNewTrip() }} className="w-full text-left px-3 py-2 hover:bg-bg-main">
                      Viaje individual
                    </button>
                    <button type="button" onClick={() => { setShowNewMenu(false); onImportCsv() }} className="w-full text-left px-3 py-2 hover:bg-bg-main border-t border-border/60">
                      Importar CSV (varios)
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isLoading || !data ? (
              <div className="flex items-center justify-center py-16 text-informativo">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <>
                <AlertStatTiles
                  tiles={[
                    { id: 'never', label: 'Nunca asignados hoy', value: neverAssigned.length, tone: 'danger' },
                    { id: 'released', label: 'Liberados tras viaje', value: released.length, tone: 'success' },
                    { id: 'busy', label: 'En viaje hoy', value: busy.length, tone: 'neutral' },
                  ]}
                  active={category}
                  onSelect={id => setCategory(prev => (prev === id ? '' : id) as Category)}
                />

                <SearchInput value={q} onChange={setQ} label="Buscar equipo" placeholder="Buscar patente, conductor o empresa…" />

                <div className="bg-white rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-dato">
                    {category === 'busy' ? (
                      <>
                        <thead>
                          <tr className="bg-bg-main text-etiqueta font-semibold text-informativo">
                            <th className="text-left px-3 py-2">Patente</th>
                            <th className="text-left px-3 py-2">Empresa</th>
                            <th className="text-left px-3 py-2">Cliente</th>
                            <th className="text-left px-3 py-2">Estado actual</th>
                            <th className="text-right px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {filteredBusy.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-4 text-center text-informativo italic">Sin equipos en esta categoría</td></tr>
                          ) : filteredBusy.map((a: BusyAsset) => (
                            <tr key={a.asset_id}>
                              <td className="px-3 py-2 font-semibold text-text-primary">{a.tractor_plate}</td>
                              <td className="px-3 py-2">{a.carrier_name ?? '—'}</td>
                              <td className="px-3 py-2">{a.client_name ?? '—'}</td>
                              <td className="px-3 py-2 text-informativo">{a.current_status ?? '—'}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => onSelectTrip(a.trip_id)}
                                  className="flex items-center gap-1 ml-auto text-etiqueta font-semibold text-accent hover:text-accion/80"
                                >
                                  Ver viaje <ArrowRight size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    ) : (
                      <>
                        <thead>
                          <tr className="bg-bg-main text-etiqueta font-semibold text-informativo">
                            <th className="text-left px-3 py-2">Patente</th>
                            <th className="text-left px-3 py-2">Empresa</th>
                            <th className="text-left px-3 py-2">Conductor habitual</th>
                            <th className="text-left px-3 py-2">Última actividad</th>
                            <th className="text-right px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {filtered.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-4 text-center text-informativo italic">Sin equipos en esta categoría</td></tr>
                          ) : filtered.map(a => (
                            <tr key={a.asset_id}>
                              <td className="px-3 py-2 font-semibold text-text-primary">{a.tractor_plate}</td>
                              <td className="px-3 py-2">{a.carrier_name ?? '—'}</td>
                              <td className="px-3 py-2">
                                {a.driver_name ?? <span className="text-warning">Sin conductor asignado hoy</span>}
                              </td>
                              <td className="px-3 py-2 text-informativo">
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
                                  className="flex items-center gap-1 ml-auto text-etiqueta font-semibold text-accent hover:text-accion/80"
                                >
                                  Asignar viaje <ArrowRight size={11} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    )}
                  </table>
                </div>
              </>
            )}
          </div>
    </PanelLateral>
  )
}
