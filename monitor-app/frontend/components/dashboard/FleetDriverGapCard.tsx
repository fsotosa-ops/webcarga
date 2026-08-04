'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'

/** Inconsistencias de dotación tracto/conductor por empresa (Tarea 9, plan
 *  3.2, minuta 2026-08-03) — indicador estructural de solo lectura, se
 *  resuelve por gestión externa (operaciones contacta al transportista),
 *  no por una acción del sistema. Se recalcula en vivo cada vez que se
 *  monta (sin snapshot diario, mismo patrón que Centro de Flota) y
 *  desaparece solo cuando el directorio cambia — sin botón de "resolver". */
export function FleetDriverGapCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['fleet-driver-gap'],
    queryFn: () => carriersApi.fleetDriverGap(),
  })

  if (isLoading || !data || data.rows.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        <p className="text-xs font-bold text-text-primary">
          {data.rows.length} empresa{data.rows.length > 1 ? 's' : ''} con desbalance de dotación
        </p>
      </div>
      <div className="divide-y divide-border/60">
        {data.rows.map(r => (
          <div key={r.carrier_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-xs font-medium text-text-primary truncate">{r.business_name}</span>
            <span className="text-[11px] text-gray-500 shrink-0">
              {r.gap > 0
                ? `Faltan ${r.gap} conductor${r.gap > 1 ? 'es' : ''}`
                : `${Math.abs(r.gap)} conductor${Math.abs(r.gap) > 1 ? 'es' : ''} de más`}
              {' · '}{r.n_tractos} tracto{r.n_tractos !== 1 ? 's' : ''} / {r.n_conductores} conductor{r.n_conductores !== 1 ? 'es' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
