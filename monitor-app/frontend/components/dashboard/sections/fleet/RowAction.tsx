'use client'

import { AlertTriangle, FilePlus2 } from 'lucide-react'
import type { CambiosDeLinea } from '@/lib/api/dailyClosures'
import type { Destino, FleetRow } from '@/lib/cierre/dayFleet'
import type { CategoriaDeLinea, UnassignedReasonMeta } from '@/lib/types'

/** Las categorías de una línea sin carga: las que piden motivo. */
const SIN_CARGA: CategoriaDeLinea[] = ['SIN_RESOLVER', 'TRABAJANDO_SIN_ASIGNACION', 'NO_TRABAJANDO']

/** Lo que se hace con una fila de la Flota del día, según su CATEGORÍA (la del
 *  backend, no la etiqueta que se ve): elegir el motivo de una sin carga (con su
 *  vigencia, el motivo propio del tracto y la sugerencia), revisar una por
 *  regularizar, o ver el viaje de una asignada. Un día firmado no se edita. */
export function RowAction({
  fila, fecha, cerrado, guardando, motivos, onSetReason, onSelectTrip, onCreateManualTrip,
}: {
  fila: FleetRow
  fecha: string
  cerrado: boolean
  guardando: boolean
  motivos: UnassignedReasonMeta[]
  onSetReason: (destino: Destino, cambios: CambiosDeLinea) => void
  onSelectTrip: (tripId: string) => void
  onCreateManualTrip?: (driverId: string, driverName: string) => void
}) {
  const r = fila
  const grupoDeMotivo = (id: string | null | undefined) => motivos.find(m => m.id === id)?.group ?? 'no_trabajando'
  const select = 'rounded-lg border border-border bg-white px-2 py-1 text-etiqueta'

  if (SIN_CARGA.includes(r.categoria)) {
    return (
      <div className="space-y-1">
        <select value={r.unassignedReasonId ?? ''} aria-label={`Motivo de ${r.primary}`} disabled={cerrado || guardando}
          onChange={e => onSetReason(r.destino, { unassigned_reason_id: e.target.value || null })} className={select}>
          <option value="">— Sin especificar —</option>
          {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        {/* El motivo se escribió en el conductor y el tracto lo sigue solo (01/10). */}
        {r.unassignedReasonId && r.reasonFromDriverName && (
          <p className="text-etiqueta text-informativo">Heredado de {r.reasonFromDriverName}</p>
        )}
        {/* El tracto tiene un motivo propio: se edita aparte; vacío vuelve a heredar del conductor (HU-D3). */}
        {r.tractoPropio && (
          <label className="flex items-center gap-1 text-etiqueta text-informativo">
            Tracto
            <select value={r.tractoPropio.reasonId ?? ''} aria-label={`Motivo del tracto ${r.secondary ?? ''}`}
              disabled={cerrado || guardando}
              onChange={e => onSetReason({ tipo: 'ASSET', id: r.tractoPropio!.assetId }, { unassigned_reason_id: e.target.value || null })}
              className="rounded-lg border border-border bg-white px-1.5 py-0.5 text-etiqueta">
              <option value="">— Igual que el conductor —</option>
              {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            {!r.tractoPropio.reasonId && !cerrado && (
              <button type="button" disabled={guardando}
                onClick={() => onSetReason({ tipo: 'ASSET', id: r.tractoPropio!.assetId }, { unassigned_reason_id: null })}
                className="font-semibold text-accion hover:underline">
                Usar el del conductor
              </button>
            )}
          </label>
        )}
        {/* Solo un motivo de "no trabajó" se arrastra a los días siguientes (Vacaciones, Licencia). */}
        {r.unassignedReasonId && grupoDeMotivo(r.unassignedReasonId) === 'no_trabajando' && (
          <label className="flex items-center gap-1 text-etiqueta text-informativo">
            Hasta
            <input type="date" min={fecha} value={r.validUntil ?? ''} aria-label={`Vigencia del motivo de ${r.primary}`}
              disabled={cerrado || guardando}
              onChange={e => onSetReason(r.destino, { valid_until: e.target.value || null })}
              className="rounded-lg border border-border bg-white px-1.5 py-0.5 text-etiqueta" />
          </label>
        )}
        {!cerrado && !r.unassignedReasonId && r.driverPendingDocsCritical && r.suggestedReasonId && (
          <button type="button" onClick={() => onSetReason(r.destino, { unassigned_reason_id: r.suggestedReasonId! })}
            className="block text-etiqueta text-warning hover:underline">
            Sugerido: {motivos.find(m => m.id === r.suggestedReasonId)?.label ?? 'Documentación vencida'}
          </button>
        )}
        {!cerrado && r.driverId && onCreateManualTrip && (
          <button type="button" onClick={() => onCreateManualTrip(r.driverId!, r.primary)}
            className="flex items-center gap-1 text-etiqueta text-accion hover:underline">
            <FilePlus2 size={10} aria-hidden="true" /> Crear viaje manual
          </button>
        )}
      </div>
    )
  }

  if (r.categoria === 'POR_REGULARIZAR') {
    return r.tripId ? (
      <button type="button" onClick={() => onSelectTrip(r.tripId!)}
        className="flex items-center gap-1 text-etiqueta text-status-incidente hover:underline">
        <AlertTriangle size={11} aria-hidden="true" /> Ver viaje
      </button>
    ) : (
      <a href={r.carrierId ? `/dashboard/carriers/${r.carrierId}` : '/dashboard/carriers'}
        className="flex items-center gap-1 text-etiqueta text-status-incidente hover:underline">
        <AlertTriangle size={11} aria-hidden="true" /> Revisar en Directorio
      </a>
    )
  }

  return r.todayTripId ? (
    <button type="button" onClick={() => onSelectTrip(r.todayTripId!)}
      className="text-etiqueta font-semibold text-accion hover:underline">
      Ver viaje
    </button>
  ) : null
}
