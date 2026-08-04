'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle, FilePlus2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { tripsApi } from '@/lib/api/trips'
import { AlertStatTiles } from '../AlertStatTiles'
import type { DriverDayStatusValue, UnassignedReasonMeta } from '@/lib/types'

type OperationType = 'TRACTOREO' | 'EQUIPO_COMPLETO'
type RowCategory = 'total' | 'assigned' | 'unassigned' | 'mismatch'
const PAGE_SIZE = 10

const STATUS_LABEL: Record<DriverDayStatusValue, string> = {
  ASSIGNED: 'Asignado', UNASSIGNED: 'No asignado', MISMATCH: 'Por regularizar',
}
const STATUS_CLS: Record<DriverDayStatusValue, string> = {
  ASSIGNED:   'bg-green-50 text-green-700 border-green-200',
  UNASSIGNED: 'bg-amber-50 text-amber-700 border-amber-200',
  MISMATCH:   'bg-red-50 text-red-700 border-red-200',
}
const OPERATION_TYPE_CLS: Record<string, string> = {
  Tractoreo:         'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Equipo Completo': 'bg-gray-100 text-gray-600 border-transparent',
}

interface Props {
  fecha:              string
  unassignedReasons:  UnassignedReasonMeta[]
  onSelectTrip:       (tripId: string) => void
  onCreateManualTrip: (driverId: string, driverName: string) => void
}

/** "Flota del día" — unifica lo que antes eran 3 secciones separadas
 *  (Resumen del día / Cerrar Tractoreo / Cerrar Equipos Completos) en un
 *  solo componente (feedback del usuario, 2026-08-04): el tipo de
 *  operación (Tractoreo/Equipo Completo) es un badge de selección/filtro,
 *  y AMBAS vistas comparten la misma estructura (tiles clickeables →
 *  buscador → tabla con columna de estado en badge y acción a la
 *  derecha) — solo cambian los datos y qué acciones aplican, nunca el
 *  layout ("deberían ser lo mismo, solo que al final cambia la vista
 *  según operación", feedback explícito).
 *
 *  El eje cambia según el tipo porque el dato real cambia: Tractoreo se
 *  lee por CONDUCTOR↔empresa (dailyClosuresApi — el conductor es la
 *  unidad real del cierre desde HU-03/minuta 2026-08-03), con acción de
 *  cierre (checkbox + motivo en lote). Equipo Completo no tiene conductor
 *  exclusivo (HU §1.2) — se lee por PATENTE↔empresa
 *  (tripsApi.fleetDailyOverview), sin acción de cierre — pasivo, HU-03
 *  Bloque 2 — pero con el mismo tipo de fila (badge de estado + "Ver
 *  viaje" en la misma columna de Acción). "Sin clasificar" no es una
 *  opción del badge: ya se escala como pendiente (SIN_TIPO_OPERACION) en
 *  la sección Pendientes. */
export function FlotaDelDiaSection({ fecha, unassignedReasons, onSelectTrip, onCreateManualTrip }: Props) {
  const queryClient = useQueryClient()
  const [opType, setOpType] = useState<OperationType>('TRACTOREO')
  const [category, setCategory] = useState<RowCategory | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  // Solo aplica a Tractoreo (única vista con acción de cierre)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchReason, setBatchReason] = useState('')
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingReason, setSavingReason] = useState<string | null>(null)

  const driversQuery = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })
  const fleetQuery = useQuery({
    queryKey: ['fleet-daily-overview', fecha],
    queryFn: () => tripsApi.fleetDailyOverview(fecha),
  })

  useEffect(() => { setCategory(''); setQ(''); setPage(1); setSelected(new Set()) }, [opType])
  useEffect(() => { setPage(1) }, [category, q])

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

  if (driversQuery.isLoading || !driversQuery.data || fleetQuery.isLoading || !fleetQuery.data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  const drivers = driversQuery.data
  const fleet = fleetQuery.data
  const equipoCompletoSummary = fleet.categories.find(c => c.category === 'EQUIPO_COMPLETO')
  const qLower = q.trim().toLowerCase()

  // ── Filas normalizadas a una sola forma, para que la tabla sea 100% la
  // misma estructura sin importar el tipo de operación seleccionado. ──────
  type Row = {
    key: string
    primary: string           // Conductor (Tractoreo) o Patente (Equipo Completo)
    secondary: string | null  // Tracto habitual (Tractoreo) o Cliente (Equipo Completo)
    carrierName: string | null
    statusLabel: string
    statusCls: string
    selectable: boolean
    selected: boolean
    driverId?: string
    tripId?: string | null
    carrierId?: string | null
    unassignedReasonId?: string | null
    driverPendingDocsCritical?: boolean | null
    suggestedReasonId?: string | null
    lastKnownOperationType?: string | null
  }

  const rows: Row[] = opType === 'TRACTOREO'
    ? drivers.drivers.map(d => ({
        key: d.driver_id,
        primary: d.full_name,
        secondary: d.last_known_tractor_plate,
        carrierName: d.carrier_name,
        statusLabel: STATUS_LABEL[d.status],
        statusCls: STATUS_CLS[d.status],
        selectable: d.status === 'UNASSIGNED',
        selected: selected.has(d.driver_id),
        driverId: d.driver_id,
        tripId: d.trip_id,
        carrierId: d.carrier_id,
        unassignedReasonId: d.unassigned_reason_id,
        driverPendingDocsCritical: d.driver_pending_docs_critical,
        suggestedReasonId: d.suggested_reason_id,
        lastKnownOperationType: d.last_known_operation_type,
      }))
    : fleet.equipment.filter(e => e.categories.includes('EQUIPO_COMPLETO')).map(e => ({
        key: e.asset_id,
        primary: e.tractor_plate,
        secondary: e.client_name,
        carrierName: e.carrier_name,
        statusLabel: e.con_carga ? 'Asignado' : 'No asignado',
        statusCls: e.con_carga ? STATUS_CLS.ASSIGNED : STATUS_CLS.UNASSIGNED,
        selectable: false,
        selected: false,
        tripId: e.trip_id,
      }))

  const categoryFiltered = (
    category === 'total'      ? rows :
    category === 'assigned'   ? rows.filter(r => r.statusLabel === 'Asignado') :
    category === 'unassigned' ? rows.filter(r => r.statusLabel === 'No asignado') :
    category === 'mismatch'   ? rows.filter(r => r.statusLabel === 'Por regularizar') :
    opType === 'TRACTOREO'
      ? rows.filter(r => r.statusLabel === 'Por regularizar' || (r.statusLabel === 'No asignado' && !r.unassignedReasonId))
      : rows
  )
  const filtered = qLower === '' ? categoryFiltered : categoryFiltered.filter(r =>
    r.primary.toLowerCase().includes(qLower)
    || (r.carrierName ?? '').toLowerCase().includes(qLower)
    || (r.secondary ?? '').toLowerCase().includes(qLower),
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const showTable = opType === 'EQUIPO_COMPLETO' || category !== '' || drivers.pending_count > 0 || qLower !== ''

  const totalCount = rows.length
  const assignedCount = rows.filter(r => r.statusLabel === 'Asignado').length
  const unassignedCount = rows.filter(r => r.statusLabel === 'No asignado').length
  const mismatchCount = rows.filter(r => r.statusLabel === 'Por regularizar').length

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Tipo de operación" className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          aria-pressed={opType === 'TRACTOREO'}
          onClick={() => setOpType('TRACTOREO')}
          className={`text-left rounded-xl border p-3 transition-colors ${
            opType === 'TRACTOREO' ? 'border-accent bg-accent/5' : 'border-border bg-white hover:border-gray-300'
          }`}
        >
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Tractoreo</p>
          <p className="text-xs text-text-primary">
            <span className="font-bold">{drivers.assigned_count}</span> asignados / <span className="font-bold">{drivers.unassigned_count}</span> sin asignar
          </p>
          {drivers.mismatch_count > 0 && (
            <p className="text-[11px] text-red-500 mt-0.5">{drivers.mismatch_count} por regularizar</p>
          )}
        </button>
        <button
          type="button"
          aria-pressed={opType === 'EQUIPO_COMPLETO'}
          onClick={() => setOpType('EQUIPO_COMPLETO')}
          className={`text-left rounded-xl border p-3 transition-colors ${
            opType === 'EQUIPO_COMPLETO' ? 'border-accent bg-accent/5' : 'border-border bg-white hover:border-gray-300'
          }`}
        >
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Equipo Completo</p>
          <p className="text-xs text-text-primary">
            <span className="font-bold">{equipoCompletoSummary?.assigned ?? 0}</span> asignados / <span className="font-bold">{equipoCompletoSummary?.unassigned ?? 0}</span> sin asignar
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">{equipoCompletoSummary?.utilization_pct ?? 0}% utilización</p>
        </button>
      </div>

      <AlertStatTiles
        tiles={[
          { id: 'total', label: 'Total', value: totalCount, tone: 'neutral' },
          { id: 'assigned', label: 'Asignados', value: assignedCount, tone: 'success' },
          { id: 'unassigned', label: 'No asignados', value: unassignedCount, tone: 'neutral' },
          ...(opType === 'TRACTOREO' ? [{ id: 'mismatch', label: 'Por regularizar', value: mismatchCount, tone: 'danger' as const }] : []),
        ]}
        active={category}
        onSelect={id => setCategory(prev => (prev === id ? '' : id) as RowCategory | '')}
      />

      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={opType === 'TRACTOREO' ? 'Buscar conductor, empresa o tracto…' : 'Buscar patente, empresa o cliente…'}
          aria-label="Buscar"
          className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
        />
      </div>

      {opType === 'TRACTOREO' && selected.size > 0 && (
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
                <th className="text-left px-3 py-2">{opType === 'TRACTOREO' ? 'Conductor' : 'Patente'}</th>
                <th className="text-left px-3 py-2">Empresa</th>
                <th className="text-left px-3 py-2">{opType === 'TRACTOREO' ? 'Tracto habitual' : 'Cliente'}</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {paged.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-300 italic">Sin resultados en esta categoría</td></tr>
              )}
              {paged.map(r => (
                <tr key={r.key}>
                  <td className="px-3 py-2">
                    {r.selectable && (
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${r.primary}`}
                        checked={r.selected}
                        onChange={() => toggleSelected(r.driverId!)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-text-primary">{r.primary}</td>
                  <td className="px-3 py-2 text-gray-500">{r.carrierName ?? '—'}</td>
                  <td className="px-3 py-2">
                    {opType === 'TRACTOREO' ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">{r.secondary ?? 'Sin tracto reciente'}</span>
                        {r.lastKnownOperationType && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${OPERATION_TYPE_CLS[r.lastKnownOperationType] ?? 'bg-gray-100 text-gray-500 border-transparent'}`}>
                            {r.lastKnownOperationType}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500">{r.secondary ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${r.statusCls}`}>
                      {r.statusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {opType === 'TRACTOREO' && r.statusLabel === 'No asignado' && (
                      <div className="space-y-1">
                        <select
                          value={r.unassignedReasonId ?? ''}
                          disabled={savingReason === r.driverId}
                          onChange={e => handleSetReason(r.driverId!, e.target.value)}
                          className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                        >
                          <option value="">— Sin especificar —</option>
                          {unassignedReasons.map(reason => (
                            <option key={reason.id} value={reason.id}>{reason.label}</option>
                          ))}
                        </select>
                        {!r.unassignedReasonId && r.driverPendingDocsCritical && r.suggestedReasonId && (
                          <button
                            type="button"
                            onClick={() => handleSetReason(r.driverId!, r.suggestedReasonId!)}
                            className="block text-[10px] text-amber-600 hover:text-amber-800 hover:underline"
                          >
                            Sugerido: {unassignedReasons.find(reason => reason.id === r.suggestedReasonId)?.label ?? 'Documentación vencida'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onCreateManualTrip(r.driverId!, r.primary)}
                          className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                        >
                          <FilePlus2 size={10} /> Crear viaje manual
                        </button>
                      </div>
                    )}
                    {opType === 'TRACTOREO' && r.statusLabel === 'Por regularizar' && (
                      r.tripId ? (
                        <button
                          type="button"
                          onClick={() => onSelectTrip(r.tripId!)}
                          className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                        >
                          <AlertTriangle size={11} /> Ver viaje
                        </button>
                      ) : (
                        <a
                          href={r.carrierId ? `/dashboard/carriers/${r.carrierId}` : '/dashboard/carriers'}
                          className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                        >
                          <AlertTriangle size={11} /> Revisar en Empresas
                        </a>
                      )
                    )}
                    {opType === 'EQUIPO_COMPLETO' && r.statusLabel === 'Asignado' && r.tripId && (
                      <button
                        type="button"
                        onClick={() => onSelectTrip(r.tripId!)}
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
      )}

      {showTable && filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <span className="text-xs text-gray-400">Página {currentPage} de {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
