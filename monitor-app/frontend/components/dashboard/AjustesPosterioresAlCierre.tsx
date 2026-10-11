import Link from 'next/link'
import type { AjustePosterior } from '@/lib/types'
import { urlDelViaje } from '@/lib/navegacion/viaje'
import { fmtDT } from '@/lib/utils/datetime'

interface Props {
  /** `cierre.ajustes` de GET /daily-closures. */
  ajustes: AjustePosterior[]
  /** La URL del Cierre, para que "Ver viaje" vuelva acá. */
  volverA: string
}

/**
 * Lo que cambió en un día firmado, viaje por viaje (spec 2026-10-10 §4), en la
 * pestaña "Viajes" del Cierre (spec motivos de anulación §3).
 *
 * No es un aviso: el día NO se reabre y nada pide acción. La firma es una copia
 * inmutable de lo que existía al firmar; esto es lo que cambió después. Arriba, junto
 * a "Día cerrado", sólo queda el indicador (IndicadorDeAjustes) — el estándar de
 * cierre de período: indicador en el encabezado, detalle en su lugar.
 *
 * Reemplaza al aviso que restaba totales (viajes de hoy − firmados): un viaje que
 * entraba y otro que salía daban 0. Cada fila lleva al detalle del viaje, que abre
 * también los anulados.
 */
export function AjustesPosterioresAlCierre({ ajustes, volverA }: Props) {
  if (ajustes.length === 0) return null

  return (
    <section aria-label="Después de la firma" className="mb-5">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">Después de la firma</h3>
      <p className="text-xs text-text-secondary">Lo que cambió en el día desde que se firmó. La firma no cambia.</p>
      <ul className="mt-2 divide-y divide-border">
        {ajustes.map(a => (
          <li key={a.trip_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-dato text-text-primary">
            <span className="font-identificador tabular-nums">{a.source_system_trip_id ?? '—'}</span>
            {a.client_name && <span className="text-text-secondary">{a.client_name}</span>}
            <span className="text-etiqueta font-semibold uppercase tracking-wide text-text-secondary">
              {a.tipo === 'agregado' ? 'Agregado' : a.voided_at ? 'Anulado' : 'Ya no está en el día'}
            </span>
            {a.voided_at && (
              <span className="text-text-secondary">
                {a.voided_by_name ?? 'Alguien'} · {fmtDT(a.voided_at)}
                {a.void_reason_label && <> · Motivo: {a.void_reason_label}</>}
                {a.void_note && <> · {a.void_note}</>}
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
