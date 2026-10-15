'use client'

import { useLayer } from '@/lib/ui/layers'
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** El clic cayó en una barra de desplazamiento, no en el contenido: la de la
 *  página llega con el `<html>` como destino, y la de una lista con
 *  desplazamiento, fuera del área de contenido de esa lista. Mover la barra
 *  para seguir leyendo no es "hacer clic afuera". */
function isScrollbarClick(e: MouseEvent, target: Element): boolean {
  if (target === document.documentElement) return true
  const scrollable = target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth
  if (!scrollable) return false
  const rect = target.getBoundingClientRect()
  return e.clientX - rect.left >= target.clientLeft + target.clientWidth
      || e.clientY - rect.top >= target.clientTop + target.clientHeight
}

/** La cascara de un panel de detalle. La familia ya existe
 *  (TransporterSlideOver, CarrierDrawer, VehicleDetailPanel) y repite estas
 *  mismas cuatro cosas: fondo, Escape, foco y capas.
 *
 *  ESCALA DE Z-INDEX declarada, no valores inventados: fondo 40, panel 50 —
 *  los mismos que ya usa TransporterSlideOver. Un `z-[9999]` suelto convierte
 *  el apilado en algo que se descubre a los golpes. */
export function PanelLateral({
  titulo, onCerrar, pie, children, overlay = 'dim', label, ancho = 'normal',
}: {
  titulo:   ReactNode
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
}) {
  const panel = useRef<HTMLDivElement>(null)
  const isTop = useLayer()
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
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape' && isTop()) onCerrar() }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [onCerrar, isTop])

  // Sin fondo no hay nada que reciba el clic de afuera: se escucha en el documento.
  useEffect(() => {
    if (overlay !== 'none') return
    const alClic = (e: MouseEvent) => {
      const target = e.target as Element
      // Un botón que abre otro panel no cierra éste al presionar: sin esto, el panel
      // desaparecía entre el mousedown y el click y la fila parpadeaba (revisión final).
      if (target.closest?.('[data-panel-trigger]')) return
      if (isScrollbarClick(e, target)) return
      if (panel.current && !panel.current.contains(target)) onCerrar()
    }
    document.addEventListener('mousedown', alClic)
    return () => document.removeEventListener('mousedown', alClic)
  }, [overlay, onCerrar])

  // Solo el panel modal (`dim`) atrapa el Tab. La vista rápida (`none`) deja
  // usar la pantalla de atrás, así que encerrar ahí el teclado contradice lo
  // que el panel es (revisión final de la vista rápida, 11/10).
  //
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
    if (overlay !== 'dim' || e.key !== 'Tab' || !panel.current) return
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
      {overlay === 'dim' && (
        <div data-testid="panel-overlay" className="fixed inset-0 bg-black/50 z-40" onClick={onCerrar} aria-hidden="true" />
      )}
      <div
        ref={panel}
        role="dialog"
        aria-modal={overlay === 'dim' ? 'true' : undefined}
        aria-label={typeof titulo === 'string' ? titulo : label}
        tabIndex={-1}
        onKeyDown={atraparTab}
        className={`fixed right-0 top-0 z-50 h-full w-full bg-white shadow-xl flex flex-col focus-visible:outline-none ${
          overlay === 'none' ? 'md:w-[420px] md:border-l md:border-border' : ancho === 'amplio' ? 'max-w-4xl' : 'max-w-md'
        }`}
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
