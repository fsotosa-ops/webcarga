interface Props {
  ok:    number
  total: number
}

/** Anillo de progreso (conic-gradient CSS — sin librería de gráficos).
 *  Verde si está 100% completo, ámbar en caso contrario. */
export function CompletionRing({ ok, total }: Props) {
  const pct = total > 0 ? Math.round((ok / total) * 100) : 0
  const complete = total > 0 && ok === total
  const color = complete ? '#22c55e' : '#f59e0b'
  const gradient = `conic-gradient(${color} 0% ${pct}%, #e5e7eb ${pct}% 100%)`

  return (
    <div
      role="img"
      aria-label={`${ok} de ${total} documentos al día`}
      className="relative w-14 h-14 shrink-0 rounded-full"
      style={{ background: gradient }}
    >
      <div className="absolute inset-[4px] bg-white rounded-full flex items-center justify-center">
        <span className="text-xs font-bold text-text-primary tabular-nums">{pct}%</span>
      </div>
    </div>
  )
}
