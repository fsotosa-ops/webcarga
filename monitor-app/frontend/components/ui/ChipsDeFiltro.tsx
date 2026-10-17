'use client'

import { ToggleChip } from './ToggleChip'

export interface Chip { id: string; etiqueta: string; n?: number }

/** La barra de chips de filtro, como la del Monitor (Colun / Iansa / Sodimac).
 *
 *  `aria-pressed` y no `aria-selected`: son interruptores, no pestanas — y un
 *  lector de pantalla los anuncia distinto. Volver a apretar el activo lo apaga,
 *  porque si no la unica forma de quitar el filtro es recargar. */
export function ChipsDeFiltro({
  opciones, activo, onElegir,
}: {
  opciones: Chip[]
  activo:   string | null
  onElegir: (id: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opciones.map(({ id, etiqueta, n }) => {
        const encendido = id === activo
        return (
          <ToggleChip key={id} pressed={encendido} onClick={() => onElegir(encendido ? null : id)}>
            {etiqueta}
            {n !== undefined && <span className="ml-1.5 tabular-nums">{n}</span>}
          </ToggleChip>
        )
      })}
    </div>
  )
}
