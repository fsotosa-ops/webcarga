'use client'

import { useId, useState, type ReactNode } from 'react'

interface Props {
  title:        string
  defaultOpen?: boolean
  children:     ReactNode
}

/** Una sección que se puede ocultar. El título va en minúscula y gris, como `Section`
 *  (spec del sistema visual §3.1), y el botón dice lo que hace — "Ocultar" o
 *  "Mostrar" — en vez de una flecha suelta junto a una etiqueta en mayúsculas de
 *  10 px (pasada visual del detalle del viaje, 11/10). */
export function AccordionSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const headingId = useId()
  const action = open ? 'Ocultar' : 'Mostrar'

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex items-center gap-2">
        <h3 id={headingId} className="text-dato font-semibold text-informativo">{title}</h3>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={`${action} ${title}`}
          className="ml-auto rounded text-dato font-semibold text-accion hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {action}
        </button>
      </div>
      {open && children}
    </section>
  )
}
