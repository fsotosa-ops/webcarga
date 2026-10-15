'use client'

import { useId, useState, type ReactNode } from 'react'

export type DetailRow = { label: string; value: ReactNode }

/** El Resumen de una ficha: UN bloque de detalles en solo lectura, con "Editar"
 *  (Entrega 1 de fichas, 15/10). "Editar" cambia el bloque por su formulario en
 *  el mismo lugar. El formulario se monta cada vez que se abre, así su borrador
 *  sale de los datos de ese momento: la clase de bug del borrador sin
 *  resincronizar ya apareció cuatro veces en este frontend. */
export function DetailsBlock({ rows, canEdit, renderForm, footer }: {
  rows: DetailRow[]
  canEdit: boolean
  /** El formulario; recibe cómo cerrarse (al guardar o al cancelar). */
  renderForm?: (close: () => void) => ReactNode
  /** Lo que va debajo, separado por una línea (la actividad). */
  footer?: ReactNode
}) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  return (
    <section aria-labelledby={id} className="max-w-2xl rounded-2xl border border-border bg-white p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 id={id} className="text-lectura font-bold text-text-primary">Detalles</h2>
        {canEdit && renderForm && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-dato font-medium text-accion hover:underline">
            Editar
          </button>
        )}
      </div>
      {editing && renderForm ? renderForm(() => setEditing(false)) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-dato sm:grid-cols-[150px_1fr]">
          {rows.map(r => (
            <div key={r.label} className="contents">
              <dt className="text-informativo">{r.label}</dt>
              <dd className="min-w-0 text-text-primary">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {footer && <div className="mt-4 border-t border-border pt-3">{footer}</div>}
    </section>
  )
}
