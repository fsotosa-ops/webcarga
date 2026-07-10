'use client'

interface Props {
  clients: string[]
}

/** Chips compactos de clientes GC de una empresa — usado en el listado de
 *  Empresas (tarjetas/tabla) y en su slide-over de resumen. */
export function ClientChips({ clients }: Props) {
  if (!clients.length) return <span className="text-[10px] text-gray-300">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {clients.map(c => (
        <span key={c} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{c}</span>
      ))}
    </div>
  )
}
