'use client'

import { ChevronRight } from 'lucide-react'

export type Miga = {
  label: string
  /** Sin `onIr` es donde estás parado: no se puede volver a sí mismo. */
  onIr?: () => void
}

interface Props {
  migas:      Miga[]
  titulo:     string
  subtitulo?: string
  cubiertos:  number
  total:      number
  acciones?:  React.ReactNode
}

/** La cabecera del panel, igual en los tres niveles: dónde estás, quién es y
 *  cuánto le falta.
 *
 *  Las migas son botones, no enlaces: bajar o subir de nivel **cambia el
 *  panel, no la página**. */
export function ZoomHeader({ migas, titulo, subtitulo, cubiertos, total, acciones }: Props) {
  const pct = total > 0 ? Math.round((cubiertos / total) * 100) : 0
  const alDia = total > 0 && cubiertos === total

  return (
    <div className="space-y-2">
      {migas.length > 0 && (
        <nav aria-label="Migas de pan" className="flex items-center gap-1 flex-wrap text-[11px]">
          {migas.map((m, i) => (
            <span key={`${m.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={11} className="text-gray-400" aria-hidden="true" />}
              {m.onIr ? (
                <button
                  type="button"
                  onClick={m.onIr}
                  className="text-accent hover:underline cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40 rounded"
                >
                  {m.label}
                </button>
              ) : (
                <span className="text-gray-500" aria-current="page">{m.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-mulish font-bold text-lg text-text-primary truncate">{titulo}</h2>
          {subtitulo && <p className="text-[11px] text-gray-500">{subtitulo}</p>}
        </div>

        {/* Con cero requisitos se omite la barra: un 0% inventado dice menos
            que no decir nada. */}
        {total > 0 ? (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden">
              <span
                className={`block h-full rounded-full ${alDia ? 'bg-emerald-500' : 'bg-accent'}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-[11px] text-gray-600 tabular-nums whitespace-nowrap">
              {cubiertos} de {total}
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-gray-500">Sin requisitos definidos</span>
        )}

        {acciones && <div className="ml-auto flex items-center gap-2">{acciones}</div>}
      </div>
    </div>
  )
}
