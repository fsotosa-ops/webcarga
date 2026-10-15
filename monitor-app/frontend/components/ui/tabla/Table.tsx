import type { ReactNode } from 'react'

/** El contenedor de una lista de documentos o de entidades, sacado de Pendientes
 *  (kit de la Entrega 1 de fichas, 15/10): borde, esquinas, una barra de
 *  encabezado en texto normal y, si hace falta, secciones con título. Las filas
 *  son flex (p. ej. `RenglonPendiente`), así que esto no es un `<table>`; las
 *  tablas de verdad usan `CABECERA`, que se ve igual. */
export function Table({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {header}
      {children}
    </div>
  )
}

/** La barra de encabezado. Decorativa para el lector de pantalla (cada fila ya
 *  dice lo suyo), y oculta en el teléfono, donde las filas se apilan. */
export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true"
         className="hidden items-center gap-3 border-b border-border bg-bg-main px-3 py-1.5 text-etiqueta font-semibold text-informativo md:flex">
      {children}
    </div>
  )
}

export function TableSection({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="border-b border-border bg-bg-main px-3 py-1.5 text-etiqueta font-semibold text-informativo">
        {title}
      </h3>
      {children}
    </section>
  )
}
