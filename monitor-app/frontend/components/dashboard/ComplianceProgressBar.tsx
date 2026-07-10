'use client'

interface Props {
  pct: number | null
  /** Ancho de la barra — 'sm' para celdas de tabla compactas, 'md' para tarjetas */
  size?: 'sm' | 'md'
}

/** Barra de avance 80/20 con % — usada en el listado de Empresas (tarjetas y
 *  tabla) y en el slide-over de resumen. */
export function ComplianceProgressBar({ pct, size = 'sm' }: Props) {
  if (pct == null) return <span className="text-[10px] text-gray-300">—</span>
  const cls = pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'
  const width = size === 'md' ? 'w-full' : 'w-20'
  return (
    <div className={`flex items-center gap-1.5 ${width}`}>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="text-[10px] font-mono text-gray-500 shrink-0 w-8 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}
