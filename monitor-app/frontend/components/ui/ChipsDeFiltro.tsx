'use client'

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
          <button
            key={id}
            type="button"
            aria-pressed={encendido}
            onClick={() => onElegir(encendido ? null : id)}
            className={`rounded-full border px-2.5 py-1 text-etiqueta transition-colors
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              encendido
                ? 'border-accion text-accion bg-accion/5 font-semibold'
                : 'border-border text-gray-500 hover:text-text-primary'
            }`}
          >
            {etiqueta}
            {n !== undefined && <span className="ml-1.5 tabular-nums">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}
