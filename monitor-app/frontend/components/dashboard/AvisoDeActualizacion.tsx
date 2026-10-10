import { AlertTriangle, Info, RefreshCw } from 'lucide-react'

/** Cuánto puede tardar el ejecutor antes de que "Actualizando…" sea una mentira
 *  (corre cada minuto; spec 2026-10-10, §3.5). */
const ATRASO_MS = 5 * 60_000

export type Frescura = 'al_dia' | 'actualizando' | 'atrasado' | 'sin_cierre'

export function estadoDeFrescura(pendienteDesde: string | null, calculadoA: string | null, ahora: Date): Frescura {
  // Sin líneas ni cambios por entrar: un día anterior a la puesta en marcha del
  // cálculo en segundo plano (spec 2026-10-10, §3.4).
  if (!pendienteDesde) return calculadoA ? 'al_dia' : 'sin_cierre'
  return ahora.getTime() - new Date(pendienteDesde).getTime() > ATRASO_MS ? 'atrasado' : 'actualizando'
}

const HORA = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })

type Props = { pendienteDesde: string | null; calculadoA: string | null; ahora?: Date }

/** El Cierre se calcula en segundo plano: este aviso dice si lo que se ve tiene
 *  cambios por entrar. Una sola pieza con la variante como dato, no dos avisos. */
export function AvisoDeActualizacion({ pendienteDesde, calculadoA, ahora = new Date() }: Props) {
  const estado = estadoDeFrescura(pendienteDesde, calculadoA, ahora)
  if (estado === 'al_dia') return null

  if (estado === 'sin_cierre') {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-border bg-gray-50 px-4 py-3">
        <Info size={14} aria-hidden className="text-gray-500 shrink-0" />
        <p className="text-dato text-text-primary">Este día no tiene cierre calculado.</p>
      </div>
    )
  }

  if (estado === 'actualizando') {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-espera/20 bg-espera/5 px-4 py-3">
        <RefreshCw size={14} aria-hidden className="text-espera shrink-0 motion-safe:animate-spin" />
        <p className="text-dato text-text-primary">Actualizando con los últimos cambios…</p>
      </div>
    )
  }
  return (
    <div role="alert" className="flex items-center gap-2 rounded-xl border border-status-incidente/20 bg-status-incidente/5 px-4 py-3">
      <AlertTriangle size={14} aria-hidden className="text-status-incidente shrink-0" />
      <p className="text-dato text-text-primary">
        No se pudo actualizar desde {HORA.format(new Date(pendienteDesde!))}. Lo que ves puede no incluir los últimos cambios.
      </p>
    </div>
  )
}
