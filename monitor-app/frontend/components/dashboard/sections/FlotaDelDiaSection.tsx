'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle, FilePlus2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi } from '@/lib/api/equipmentClosures'
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
 *  y AMBAS vistas comparten la misma estructura y funcionalidad — tiles
 *  clickeables → buscador → tabla con columna Conductor/Empresa/Equipo
 *  habitual/Estado editable/Acción — sin importar el tipo ("tienen que
 *  cumplir el mismo diseño y funcionalidad, independiente del tipo de
 *  operación", feedback explícito 2026-08-04, tras un primer borrador que
 *  dejaba a Equipo Completo sin columna Conductor ni motivo editable).
 *
 *  Tractoreo lee `dailyClosuresApi` (conductor↔empresa, unidad real del
 *  cierre que SÍ bloquea el día si queda con pendientes — HU-03/minuta
 *  2026-08-03). Equipo Completo lee `equipmentClosuresApi` (equipo↔
 *  conductor-habitual — "conductor habitual" es mejor esfuerzo vía
 *  `vehicle_driver_assignments`, tabla con poca cobertura hoy, así que la
 *  columna Conductor puede venir vacía con más frecuencia que en
 *  Tractoreo). Registrar motivo/crear viaje manual por fila ahora funciona
 *  igual en ambas vistas, pero el CIERRE de Equipo Completo (botón
 *  "Confirmar cierre" de la página) sigue sin bloquear ni exigir motivo —
 *  eso es HU-03 Bloque 2 ("pasivo") y no cambia: solo se volvió posible
 *  registrar el dato, no obligatorio. "Sin clasificar" no es una opción
 *  del badge: ya se escala como pendiente (SIN_TIPO_OPERACION) en la
 *  sección Pendientes. */
export function FlotaDelDiaSection({ fecha, unassignedReasons, onSelectTrip, onCreateManualTrip }: Props) {
  const queryClient = useQueryClient()
  const [opType, setOpType] = useState<OperationType>('TRACTOREO')
  const [category, setCategory] = useState<RowCategory | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchReason, setBatchReason] = useState('')
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingReason, setSavingReason] = useState<string | null>(null)

  const driversQuery = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })
  const equipmentQuery = useQuery({
    queryKey: ['equipment-closures', fecha],
    queryFn: () => equipmentClosuresApi.get(fecha),
  })

  useEffect(() => { setCategory(''); setQ(''); setPage(1); setSelected(new Set()) }, [opType])
  useEffect(() => { setPage(1) }, [category, q])

  async function handleSetReason(entityId: string, reasonId: string) {
    setSavingReason(entityId)
    try {
      if (opType === 'TRACTOREO') {
        await dailyClosuresApi.setReason(entityId, fecha, reasonId)
        await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
      } else {
        await equipmentClosuresApi.setReason(entityId, fecha, reasonId)
        await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
      }
    } finally {
      setSavingReason(null)
    }
  }

  function toggleSelected(entityId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(entityId)) next.delete(entityId); else next.add(entityId)
      return next
    })
  }

  async function handleApplyBatch() {
    if (!batchReason || selected.size === 0) return
    setSavingBatch(true)
    try {
      if (opType === 'TRACTOREO') {
        await dailyClosuresApi.setReasonBatch(fecha, Array.from(selected), batchReason)
        await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
      } else {
        await equipmentClosuresApi.setReasonBatch(fecha, Array.from(selected), batchReason)
        await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
      }
      setSelected(new Set()); setBatchReason('')
    } finally {
      setSavingBatch(false)
    }
  }

  if (driversQuery.isLoading || !driversQuery.data || equipmentQuery.isLoading || !equipmentQuery.data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  const drivers = driversQuery.data
  const equipos = equipmentQuery.data.equipos_completos
  const qLower = q.trim().toLowerCase()

  // ── Filas normalizadas a una sola forma, para que la tabla sea 100% la
  // misma estructura y funcionalidad sin importar el tipo de operación. ──
  type Row = {
    key: string
    entityId: string          // driver_id (Tractoreo) o asset_id (Equipo Completo) — selección + motivo
    primary: string           // Conductor (ambos tipos; en Equipo Completo puede ser "mejor esfuerzo")
    secondary: string | null  // Tracto/Equipo habitual (ambos tipos)
    carrierName: string | null
    statusLabel: string
    statusCls: string
    selectable: boolean
    selected: boolean
    driverId?: string | null  // conductor real, solo si se conoce — habilita "Crear viaje manual"
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
        entityId: d.driver_id,
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
    : equipos.equipment.map(e => ({
        key: e.asset_id,
        entityId: e.asset_id,
        primary: e.driver_name ?? 'Sin conductor asignado',
        secondary: e.tractor_plate,
        carrierName: e.carrier_name,
        statusLabel: STATUS_LABEL[e.status],
        statusCls: STATUS_CLS[e.status],
        selectable: e.status === 'UNASSIGNED',
        selected: selected.has(e.asset_id),
        driverId: e.driver_id,
        tripId: e.trip_id,
        carrierId: e.carrier_id,
        unassignedReasonId: e.unassigned_reason_id,
      }))

  const categoryFiltered = (
    category === 'total'      ? rows :
    category === 'assigned'   ? rows.filter(r => r.statusLabel === 'Asignado') :
    category === 'unassigned' ? rows.filter(r => r.statusLabel === 'No asignado') :
    category === 'mismatch'   ? rows.filter(r => r.statusLabel === 'Por regularizar') :
    rows.filter(r => r.statusLabel === 'Por regularizar' || (r.statusLabel === 'No asignado' && !r.unassignedReasonId))
  )
  const filtered = qLower === '' ? categoryFiltered : categoryFiltered.filter(r =>
    r.primary.toLowerCase().includes(qLower)
    || (r.carrierName ?? '').toLowerCase().includes(qLower)
    || (r.secondary ?? '').toLowerCase().includes(qLower),
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const totalCount = rows.length
  const assignedCount = rows.filter(r => r.statusLabel === 'Asignado').length
  const unassignedCount = rows.filter(r => r.statusLabel === 'No asignado').length
  const mismatchCount = rows.filter(r => r.statusLabel === 'Por regularizar').length
  const tractoreoUtilizationPct = drivers.total_drivers
    ? Math.round((drivers.assigned_count / drivers.total_drivers) * 1000) / 10
    : 0

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
          <p className="text-[11px] text-gray-400 mt-0.5">{tractoreoUtilizationPct}% utilización</p>
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
            <span className="font-bold">{equipos.summary.assigned}</span> asignados / <span className="font-bold">{equipos.summary.unassigned}</span> sin asignar
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">{equipos.summary.utilization_pct}% utilización</p>
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
          placeholder={opType === 'TRACTOREO' ? 'Buscar conductor, empresa o tracto…' : 'Buscar conductor, empresa o equipo…'}
          aria-label="Buscar"
          className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
        />
      </div>

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

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th className="text-left px-3 py-2 w-8" />
              <th className="text-left px-3 py-2">Conductor</th>
              <th className="text-left px-3 py-2">Empresa</th>
              <th className="text-left px-3 py-2">{opType === 'TRACTOREO' ? 'Tracto habitual' : 'Equipo habitual'}</th>
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
                      onChange={() => toggleSelected(r.entityId)}
                    />
                  )}
                </td>
                <td className="px-3 py-2 font-medium text-text-primary">{r.primary}</td>
                <td className="px-3 py-2 text-gray-500">{r.carrierName ?? '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">{r.secondary ?? (opType === 'TRACTOREO' ? 'Sin tracto reciente' : '—')}</span>
                    {r.lastKnownOperationType && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${OPERATION_TYPE_CLS[r.lastKnownOperationType] ?? 'bg-gray-100 text-gray-500 border-transparent'}`}>
                        {r.lastKnownOperationType}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${r.statusCls}`}>
                    {r.statusLabel}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.statusLabel === 'No asignado' && (
                    <div className="space-y-1">
                      <select
                        value={r.unassignedReasonId ?? ''}
                        disabled={savingReason === r.entityId}
                        onChange={e => handleSetReason(r.entityId, e.target.value)}
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
                          onClick={() => handleSetReason(r.entityId, r.suggestedReasonId!)}
                          className="block text-[10px] text-amber-600 hover:text-amber-800 hover:underline"
                        >
                          Sugerido: {unassignedReasons.find(reason => reason.id === r.suggestedReasonId)?.label ?? 'Documentación vencida'}
                        </button>
                      )}
                      {r.driverId && (
                        <button
                          type="button"
                          onClick={() => onCreateManualTrip(r.driverId!, r.primary)}
                          className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                        >
                          <FilePlus2 size={10} /> Crear viaje manual
                        </button>
                      )}
                    </div>
                  )}
                  {r.statusLabel === 'Por regularizar' && (
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
                  {r.statusLabel === 'Asignado' && r.tripId && (
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

      {filtered.length > 0 && (
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
