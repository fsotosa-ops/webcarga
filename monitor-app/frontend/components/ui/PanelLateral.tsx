'use client'

import { useId, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Dialog } from './Dialog'

/** La ventana con encabezado (título, descripción, cerrar), cuerpo y pie. El
 *  comportamiento —fondo, Escape, foco, Tab y capas— es el de `Dialog`. */
export function PanelLateral({
  titulo, description, onCerrar, pie, children, overlay = 'dim', label, ancho = 'normal', placement = 'side', dismissible = true,
}: {
  titulo:   ReactNode
  /** Una línea bajo el título que dice qué se hace aquí; describe el diálogo. */
  description?: ReactNode
  /** Nombre accesible del panel cuando `titulo` no es un texto. */
  label?:   string
  onCerrar: () => void
  pie:      ReactNode
  children: ReactNode
  /** `dim`: fondo oscuro y modal (editar algo). `none`: una vista rápida que deja
   *  ver y usar la pantalla de atrás, como el peek de Linear; no es modal, y un
   *  clic afuera la cierra. */
  overlay?: 'dim' | 'none'
  /** `amplio`: lo que se revisa es una tabla (la revisión de una carga en lote). */
  ancho?: 'normal' | 'amplio'
  /** `side`: el detalle de algo, pegado a la derecha. `center`: un diálogo que se
   *  termina y se cierra (carga masiva, nuevo viaje, un grupo). */
  placement?: 'side' | 'center'
  /** `false` mientras algo viaja: no se cierra (ver `Dialog`). */
  dismissible?: boolean
}) {
  const descriptionId = useId()
  const centered = placement === 'center'
  const modal = overlay === 'dim'

  return (
    <Dialog
      label={typeof titulo === 'string' ? titulo : label}
      describedBy={description ? descriptionId : undefined}
      onClose={onCerrar}
      modal={modal}
      dismissible={dismissible}
      className={`flex flex-col bg-white shadow-xl ${
        centered
          // `inset-0 m-auto h-fit` centra sin `transform`, que la animación de entrada ya usa.
          ? `inset-0 m-auto h-fit max-h-[90vh] w-[calc(100%-2rem)] rounded-xl animate-modal-in ${ancho === 'amplio' ? 'max-w-4xl' : 'max-w-lg'}`
          : `right-0 top-0 h-full w-full ${
              !modal ? 'md:w-[420px] md:border-l md:border-border' : ancho === 'amplio' ? 'max-w-4xl' : 'max-w-md'}`
      }`}
    >
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="font-mulish font-bold text-sm text-text-primary truncate">{titulo}</div>
          {description && <p id={descriptionId} className="mt-0.5 text-dato text-informativo">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          disabled={!dismissible}
          aria-label="Cerrar"
          className="ml-auto shrink-0 rounded text-informativo hover:text-text-primary disabled:opacity-40
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

      {pie && <div className="px-4 py-3 border-t border-border bg-bg-main">{pie}</div>}
    </Dialog>
  )
}
