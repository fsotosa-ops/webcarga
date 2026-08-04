'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle, FilePlus2 } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { AlertStatTiles } from '../AlertStatTiles'
import type { DriverDayStatusValue, UnassignedReasonMeta } from '@/lib/types'

type Category = 'total' | 'assigned' | 'unassigned' | 'mismatch'

const STATUS_LABEL: Record<DriverDayStatusValue, string> = {
  ASSIGNED: 'Asignado', UNASSIGNED: 'No asignado', MISMATCH: 'Por regularizar',
}
const STATUS_CLS: Record<DriverDayStatusValue, string> = {
  ASSIGNED:   'bg-green-50 text-green-700 border-green-200',
  UNASSIGNED: 'bg-amber-50 text-amber-700 border-amber-200',
  MISMATCH:   'bg-red-50 text-red-700 border-red-200',
}
const OPERATION_TYPE_CLS: Record<string, string> = {
  Tractoreo:       'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Equipo Completo': 'bg-gray-100 text-gray-600 border-transparent',
}

interface Props {
  fecha:              string
  unassignedReasons:  UnassignedReasonMeta[]
  onSelectTrip:       (tripId: string) => void
  onCreateManualTrip: (driverId: string, driverName: string) => void
}

/** Sección "Cerrar Tractoreo" del Centro de Cierre (Tarea 7, plan 2.4) —
 *  HU-03 Bloque 1, ahora por CONDUCTOR (Tarea 4/5). Combina el patrón de
 *  tiles+tabla+selector por fila de CloseDayDialog.tsx (código muerto,
 *  cierre por conductor) con el mecanismo de selección masiva+motivo en
 *  lote de EquipmentCloseDayDialog.tsx (en uso hoy, cierre por tracto) —
 *  ninguno de los dos se toca ni se borra acá. Es una SECCIÓN embebida en
 *  una página (Tarea 1.1), no un diálogo: sin backdrop/foco/Escape.
 *
 *  El botón de "Confirmar cierre" (con override admin+nota) vive a nivel
 *  de página (Tarea 1.1/1.5) porque encadena este cierre con el de Equipos
 *  Completos en una sola acción — esta sección solo resuelve pendientes,
 *  no dispara el cierre. */
export function TractoreoDriverClosureSection({ fecha, unassignedReasons, onSelectTrip, onCreateManualTrip }: Props) {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<Category | ''>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchReason, setBatchReason] = useState('')
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingReason, setSavingReason] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })

  async function handleSetReason(driverId: string, reasonId: string) {
    setSavingReason(driverId)
    try {
      await dailyClosuresApi.setReason(driverId, fecha, reasonId)
      await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    } finally {
      setSavingReason(null)
    }
  }

  function toggleSelected(driverId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(driverId)) next.delete(driverId); else next.add(driverId)
      return next
    })
  }

  async function handleApplyBatch() {
    if (!batchReason || selected.size === 0) return
    setSavingBatch(true)
    try {
      await dailyClosuresApi.setReasonBatch(fecha, Array.from(selected), batchReason)
      setSelected(new Set()); setBatchReason('')
      await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    } finally {
      setSavingBatch(false)
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  const displayedDrivers =
    category === 'total'      ? data.drivers :
    category === 'assigned'   ? data.drivers.filter(d => d.status === 'ASSIGNED') :
    category === 'unassigned' ? data.drivers.filter(d => d.status === 'UNASSIGNED') :
    category === 'mismatch'   ? data.drivers.filter(d => d.status === 'MISMATCH') :
    data.drivers.filter(d => d.status === 'MISMATCH' || (d.status === 'UNASSIGNED' && !d.unassigned_reason_id))
  const showTable = category !== '' || data.pending_count > 0

  return (
    <div className="space-y-4">
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
                <th className="text-left px-3 py-2">Conductor</th>
                <th className="text-left px-3 py-2">Empresa</th>
                <th className="text-left px-3 py-2">Tracto habitual</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {displayedDrivers.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-300 italic">Sin conductores en esta categoría</td></tr>
              )}
              {displayedDrivers.map(d => (
                <tr key={d.driver_id}>
                  <td className="px-3 py-2">
                    {d.status === 'UNASSIGNED' && (
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${d.full_name}`}
                        checked={selected.has(d.driver_id)}
                        onChange={() => toggleSelected(d.driver_id)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-text-primary">{d.full_name}</td>
                  <td className="px-3 py-2 text-gray-500">{d.carrier_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500">{d.last_known_tractor_plate ?? 'Sin tracto reciente'}</span>
                      {d.last_known_operation_type && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${OPERATION_TYPE_CLS[d.last_known_operation_type] ?? 'bg-gray-100 text-gray-500 border-transparent'}`}>
                          {d.last_known_operation_type}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[d.status]}`}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {d.status === 'UNASSIGNED' && (
                      <div className="space-y-1">
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
                        {!d.unassigned_reason_id && d.driver_pending_docs_critical && d.suggested_reason_id && (
                          <button
                            type="button"
                            onClick={() => handleSetReason(d.driver_id, d.suggested_reason_id!)}
                            className="block text-[10px] text-amber-600 hover:text-amber-800 hover:underline"
                          >
                            Sugerido: {unassignedReasons.find(r => r.id === d.suggested_reason_id)?.label ?? 'Documentación vencida'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onCreateManualTrip(d.driver_id, d.full_name)}
                          className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                        >
                          <FilePlus2 size={10} /> Crear viaje manual
                        </button>
                      </div>
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
                          href={d.carrier_id ? `/dashboard/carriers/${d.carrier_id}` : '/dashboard/carriers'}
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
    </div>
  )
}
