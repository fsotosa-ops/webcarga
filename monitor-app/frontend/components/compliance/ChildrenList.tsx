'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Truck, User } from 'lucide-react'

export type Hijo = {
  id:        string
  nombre:    string
  tipo:      'DRIVER' | 'ASSET'
  cubiertos: number
  total:     number
}

interface Props {
  titulo:     string
  filas:      Hijo[]
  porPagina?: number
  onAbrir:    (tipo: 'DRIVER' | 'ASSET', id: string) => void
}

/** Lo que una entidad tiene adentro — la flota de una empresa.
 *
 *  Cada fila es un botón, no un enlace: abrir uno **cambia el panel, no la
 *  página**. Se pagina porque una empresa con veinte o más estiraría el panel
 *  sin límite. */
export function ChildrenList({ titulo, filas, porPagina = 20, onAbrir }: Props) {
  const [pagina, setPagina] = useState(0)

  const paginas = Math.max(1, Math.ceil(filas.length / porPagina))
  const actual = Math.min(pagina, paginas - 1)
  const visibles = filas.slice(actual * porPagina, (actual + 1) * porPagina)

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          {titulo} {filas.length > 0 && <span className="tabular-nums">({filas.length})</span>}
        </h3>

        {paginas > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Página anterior"
              disabled={actual === 0}
              onClick={() => setPagina(p => Math.max(p - 1, 0))}
              className="p-0.5 rounded text-gray-500 hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="text-[10px] text-gray-500 tabular-nums">
              {actual + 1} de {paginas}
            </span>
            <button
              type="button"
              aria-label="Página siguiente"
              disabled={actual >= paginas - 1}
              onClick={() => setPagina(p => Math.min(p + 1, paginas - 1))}
              className="p-0.5 rounded text-gray-500 hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>

      {!filas.length ? (
        <p className="text-[11px] text-gray-500 py-2">Todavía no tiene conductores ni vehículos.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-y border-gray-100">
          {visibles.map(f => {
            const Icono = f.tipo === 'DRIVER' ? User : Truck
            const pct = f.total > 0 ? Math.round((f.cubiertos / f.total) * 100) : 0
            const alDia = f.total > 0 && f.cubiertos === f.total

            return (
              <li key={`${f.tipo}-${f.id}`}>
                <button
                  type="button"
                  onClick={() => onAbrir(f.tipo, f.id)}
                  className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-gray-50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40 rounded"
                >
                  <Icono size={12} className="text-gray-500 shrink-0" />
                  <span className="text-[11px] text-slate-800 truncate flex-1 min-w-0">{f.nombre}</span>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {f.tipo === 'DRIVER' ? 'conductor' : 'vehículo'}
                  </span>
                  <span className="h-1.5 w-16 rounded-full bg-gray-200 overflow-hidden shrink-0">
                    <span
                      className={`block h-full rounded-full ${alDia ? 'bg-emerald-500' : 'bg-accent'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="text-[10px] text-gray-600 tabular-nums shrink-0 w-14 text-right">
                    {f.cubiertos} de {f.total}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
