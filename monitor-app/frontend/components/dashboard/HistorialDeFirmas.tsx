import type { FirmaDelDia } from '@/lib/types'

interface Props {
  /** De la más reciente a la más antigua (GET /closures/{fecha}/signatures). */
  firmas: FirmaDelDia[]
}

/** Las veces que se firmó el día (spec 2026-10-10 §3). Con una sola firma no hay
 *  historia que contar: el encabezado ya dice quién y cuándo. */
export function HistorialDeFirmas({ firmas }: Props) {
  if (firmas.length < 2) return null
  return (
    <details className="rounded-xl border border-border bg-white px-4 py-2 text-dato text-text-primary">
      <summary className="cursor-pointer font-semibold">Firmado {firmas.length} veces</summary>
      <ol className="mt-2 space-y-1">
        {firmas.map(f => (
          <li key={f.version} className="flex flex-wrap gap-x-3 text-text-secondary">
            <span className="font-semibold text-text-primary">Versión {f.version}</span>
            <span>{f.signed_by_name ?? '—'}</span>
            <span className="tabular-nums">{new Date(f.signed_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>
            {f.totals.viajes !== undefined && <span className="tabular-nums">{f.totals.viajes} viajes</span>}
          </li>
        ))}
      </ol>
    </details>
  )
}
