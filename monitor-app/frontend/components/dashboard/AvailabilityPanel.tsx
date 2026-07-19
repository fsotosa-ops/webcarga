'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Phone, Truck, UserCheck, ArrowRight } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import type { AvailableDriver, AvailableAsset } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils/datetime'

type Tab = 'conductores' | 'equipos'

interface Props {
  open:          boolean
  fecha:         string
  onClose:       () => void
  /** Abre el formulario de viaje nuevo pre-llenado con este conductor */
  onAssignDriver: (driver: AvailableDriver) => void
  /** Abre el formulario de viaje nuevo pre-llenado con este equipo */
  onAssignAsset:  (asset: AvailableAsset) => void
}

export function useAvailableDrivers(fecha: string, enabled: boolean) {
  return useQuery({
    queryKey: ['available-drivers', fecha],
    queryFn: () => tripsApi.availableDrivers(fecha),
    enabled,
    refetchInterval: 120_000,
  })
}

export function useAvailableAssets(fecha: string, enabled: boolean) {
  return useQuery({
    queryKey: ['available-assets', fecha],
    queryFn: () => tripsApi.availableAssets(fecha),
    enabled,
    refetchInterval: 120_000,
  })
}

export function AvailabilityPanel({ open, fecha, onClose, onAssignDriver, onAssignAsset }: Props) {
  const [tab, setTab] = useState<Tab>('conductores')
  const driversQuery = useAvailableDrivers(fecha, open && tab === 'conductores')
  const assetsQuery  = useAvailableAssets(fecha, open && tab === 'equipos')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const drivers = driversQuery.data ?? []
  const assets  = assetsQuery.data ?? []
  const query   = tab === 'conductores' ? driversQuery : assetsQuery

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Disponibilidad"
        tabIndex={-1}
        className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[380px] bg-white shadow-2xl flex flex-col focus:outline-none animate-modal-in"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <UserCheck size={16} className="text-green-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-800">Disponibilidad</h2>
              <p className="text-[10px] text-gray-400">Sin viaje abierto hoy — reasignables</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-border shrink-0 px-5">
          <button
            type="button"
            onClick={() => setTab('conductores')}
            aria-pressed={tab === 'conductores'}
            className={`text-xs font-semibold px-3 py-2.5 border-b-2 transition-colors ${
              tab === 'conductores' ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Conductores
          </button>
          <button
            type="button"
            onClick={() => setTab('equipos')}
            aria-pressed={tab === 'equipos'}
            className={`text-xs font-semibold px-3 py-2.5 border-b-2 transition-colors ${
              tab === 'equipos' ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Equipos
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {query.isPending && (
            <div className="space-y-2" aria-label="Cargando">
              {[0, 1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          )}
          {query.error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {query.error instanceof Error ? query.error.message : 'Error al cargar'}
            </p>
          )}

          {tab === 'conductores' && !driversQuery.isPending && !driversQuery.error && drivers.length === 0 && (
            <p className="text-xs text-gray-300 italic text-center py-8">
              Ningún conductor disponible en este momento
            </p>
          )}
          {tab === 'conductores' && drivers.map(d => (
            <div key={d.driver_id} className="border border-border rounded-xl p-3 bg-white shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{d.driver_name}</p>
                  <p className="text-[10px] text-gray-400">
                    {d.carrier_name ?? 'Sin empresa'} · {d.trips_total} viaje{d.trips_total !== 1 ? 's' : ''} hoy
                    {d.last_report_at && ` · libre ${formatRelativeTime(d.last_report_at)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                {d.tractor_plate && (
                  <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-600">
                    <Truck size={11} className="text-gray-400" /> {d.tractor_plate}
                  </span>
                )}
                {d.driver_phone && (
                  <a href={`tel:${d.driver_phone}`} className="inline-flex items-center gap-1 font-mono text-accent hover:underline">
                    <Phone size={10} /> {d.driver_phone}
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => onAssignDriver(d)}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-accent border border-accent/30 hover:bg-accent/5 rounded-lg px-3 py-1.5 transition-colors"
              >
                Asignar a viaje nuevo
                <ArrowRight size={12} />
              </button>
            </div>
          ))}

          {tab === 'equipos' && !assetsQuery.isPending && !assetsQuery.error && assets.length === 0 && (
            <p className="text-xs text-gray-300 italic text-center py-8">
              Ningún equipo disponible en este momento
            </p>
          )}
          {tab === 'equipos' && assets.map(a => (
            <div key={a.asset_id} className="border border-border rounded-xl p-3 bg-white shadow-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate font-mono">{a.tractor_plate}</p>
                  <p className="text-[10px] text-gray-400">
                    {a.carrier_name ?? 'Sin empresa'} · {a.trips_total} viaje{a.trips_total !== 1 ? 's' : ''} hoy
                    {a.last_report_at && ` · libre ${formatRelativeTime(a.last_report_at)}`}
                  </p>
                </div>
              </div>
              {a.asset_type && (
                <div className="flex items-center gap-3 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <Truck size={11} className="text-gray-400" /> {a.asset_type}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => onAssignAsset(a)}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-accent border border-accent/30 hover:bg-accent/5 rounded-lg px-3 py-1.5 transition-colors"
              >
                Asignar a viaje nuevo
                <ArrowRight size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
