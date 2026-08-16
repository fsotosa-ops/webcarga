'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** La cascara de un panel de detalle. La familia ya existe
 *  (TransporterSlideOver, CarrierDrawer, VehicleDetailPanel) y repite estas
 *  mismas cuatro cosas: fondo, Escape, foco y capas.
 *
 *  ESCALA DE Z-INDEX declarada, no valores inventados: fondo 40, panel 50 —
 *  los mismos que ya usa TransporterSlideOver. Un `z-[9999]` suelto convierte
 *  el apilado en algo que se descubre a los golpes. */
export function PanelLateral({
  titulo, onCerrar, pie, children,
}: {
  titulo:   ReactNode
  onCerrar: () => void
  pie:      ReactNode
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const anterior = useRef<HTMLElement | null>(null)

  // DOS efectos, no uno: tomar el foco ocurre UNA VEZ, al abrir; escuchar
  // Escape necesita el `onCerrar` de ahora. Con los dos juntos, y como los
  // llamadores pasan una flecha en linea, cualquier re-render del padre —un
  // refetch de react-query, apretar un chip, ordenar— rearmaba el efecto
  // entero y le sacaba el cursor a quien estaba escribiendo en el panel.
  useEffect(() => {
    anterior.current = document.activeElement as HTMLElement | null
    panel.current?.focus()
    // Devolver el foco a donde estaba: sin esto, cerrar deja a quien navega
    // con teclado al principio del documento.
    return () => { anterior.current?.focus() }
  }, [])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  // `aria-modal="true"` es una PROMESA: le dice al lector de pantalla que el
  // resto de la pagina no existe mientras esto esta abierto. Sin atrapar el
  // Tab, la promesa es falsa — tres tabulaciones y quien navega con teclado
  // esta escribiendo en la tabla de atras, que el lector ya declaro ausente,
  // sin ninguna senal de haberse ido.
  //
  // Se calcula en cada Tab y no una sola vez al abrir: el contenido del panel
  // cambia mientras esta abierto (la paleta de color aparece al abrirla, el
  // boton Guardar solo existe con cambios sin guardar), asi que una lista
  // capturada al montar se queda vieja.
  function atraparTab(e: React.KeyboardEvent) {
    if (e.key !== 'Tab' || !panel.current) return
    const focoables = panel.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focoables.length) return
    const primero = focoables[0]
    const ultimo = focoables[focoables.length - 1]
    const activo = document.activeElement
    // El propio panel tiene tabIndex -1 y recibe el foco al abrir: desde ahi,
    // Tab hacia atras tiene que ir al ultimo del panel, no salirse.
    if (e.shiftKey && (activo === primero || activo === panel.current)) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && activo === ultimo) {
      e.preventDefault()
      primero.focus()
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onCerrar} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof titulo === 'string' ? titulo : undefined}
        tabIndex={-1}
        onKeyDown={atraparTab}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-xl
                   flex flex-col focus-visible:outline-none"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <div className="font-mulish font-bold text-sm text-text-primary min-w-0 truncate">{titulo}</div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="ml-auto shrink-0 text-gray-400 hover:text-gray-600
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {pie && <div className="px-4 py-3 border-t border-border bg-gray-50/60">{pie}</div>}
      </div>
    </>
  )
}
