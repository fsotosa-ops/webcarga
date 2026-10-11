import { useId, type ReactNode } from 'react'

/** Un bloque titulado de un panel o una ficha. El título va en minúscula y gris
 *  (spec del sistema visual §3.1): la etiqueta en mayúsculas es de uso escaso, y
 *  repetida en cada bloque hace que todo pese lo mismo. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="py-4 border-t border-border first:border-t-0">
      <h3 id={id} className="mb-2 text-dato font-semibold text-informativo">{title}</h3>
      {children}
    </section>
  )
}
