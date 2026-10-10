import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { AjustePosterior } from '@/lib/types'
import { urlDelViaje } from '@/lib/navegacion/viaje'

interface Props {
  /** `cierre.ajustes` de GET /daily-closures. */
  ajustes: AjustePosterior[]
  /** La URL del Cierre, para que "Ver viaje" vuelva acá. */
  volverA: string
}

/**
 * Lo que cambió en un día firmado, viaje por viaje (spec 2026-10-10 §4).
 *
 * El día NO se reabre: la firma es una copia inmutable de lo que existía al firmar.
 * Lo que cambió después es un ajuste posterior al cierre, nunca "reabierto": esa
 * palabra mentiría sobre lo que pasó. El encabezado sigue diciendo "Cerrado"; esto va
 * al lado, no lo reemplaza.
 *
 * Reemplaza al aviso que restaba totales (viajes de hoy − firmados): un viaje que
 * entraba y otro que salía daban 0. Cada fila lleva al detalle del viaje, que abre
 * también los anulados.
 */
export function AjustesPosterioresAlCierre({ ajustes, volverA }: Props) {
  if (ajustes.length === 0) return null

  return (
    <section className="rounded-xl border border-espera/20 bg-espera/5 px-4 py-3" aria-label="Ajustes posteriores al cierre">
      <p className="flex items-center gap-2 text-dato font-semibold text-text-primary">
        <AlertTriangle size={14} className="text-espera shrink-0" />
        {ajustes.length === 1 ? '1 ajuste posterior al cierre' : `${ajustes.length} ajustes posteriores al cierre`}
      </p>
      <ul className="mt-2 divide-y divide-espera/10">
        {ajustes.map(a => (
          <li key={a.trip_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-dato text-text-primary">
            <span className="font-identificador tabular-nums">{a.source_system_trip_id ?? '—'}</span>
            {a.client_name && <span className="text-text-secondary">{a.client_name}</span>}
            <span className="text-etiqueta font-semibold uppercase tracking-wide text-text-secondary">
              {a.tipo === 'agregado' ? 'Agregado' : a.voided_at ? 'Anulado' : 'Ya no está en el día'}
            </span>
            {a.voided_at && (
              <span className="text-text-secondary">
                {a.voided_by_name ?? 'Alguien'} · {new Date(a.voided_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                {a.void_reason && <> · Motivo: {a.void_reason}</>}
              </span>
            )}
            <Link href={urlDelViaje(a.trip_id, volverA)} className="ml-auto text-etiqueta font-semibold text-accent hover:underline">
              Ver viaje
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
