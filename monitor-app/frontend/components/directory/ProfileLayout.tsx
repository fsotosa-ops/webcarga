import { useId, type ReactNode } from 'react'

/** La forma de las tres fichas a ancho real (maqueta del 15/10): la sección que
 *  se trabaja al centro, a todo el ancho, y un panel fijo de 340 px al costado
 *  con los datos del registro (Detalles, Actividad, Contactos). Es el patrón de
 *  Salesforce, HubSpot, Attio o Linear. Los dos bordes superiores quedan
 *  alineados: las pestañas, si las hay, van arriba de la grilla y no dentro de
 *  una columna. En el teléfono el panel va primero y la sección debajo. */
export function ProfileLayout({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="order-2 min-w-0 lg:order-1">{children}</div>
      <aside className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">{aside}</aside>
    </div>
  )
}

/** Un bloque del panel lateral: título y contenido, con el mismo borde que Detalles. */
export function AsidePanel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-border bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={id} className="text-lectura font-bold text-text-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
