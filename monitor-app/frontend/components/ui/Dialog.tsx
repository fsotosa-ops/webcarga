'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLayer } from '@/lib/ui/layers'

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

/** El comportamiento de toda ventana de la app, una vez: fondo, Escape, el foco al
 *  abrir y de vuelta al cerrar, Tab encerrado, capas (solo la de arriba atiende el
 *  teclado) y, sin fondo, el clic afuera. El marco (dónde va, qué tamaño) lo pone
 *  quien lo usa: `PanelLateral` le agrega encabezado y pie; la ficha de un conductor
 *  y el detalle del viaje llenan el marco entero. Antes había doce copias de esto.
 *
 *  ESCALA DE Z-INDEX declarada, no valores inventados: la barra del teléfono 30, fondo
 *  40, ventana 50 (los paneles flotantes, `Popover`, también 50). Una ventana que se abre
 *  sobre otra va después en el documento y queda encima. */
export function Dialog({
  label, describedBy, onClose, modal = true, dismissible = true, className, children,
}: {
  /** El nombre accesible. */
  label: string | undefined
  describedBy?: string
  onClose: () => void
  /** `true`: fondo oscuro y la página de atrás no existe. `false`: una vista rápida
   *  que deja usar la pantalla de atrás; un clic afuera la cierra. */
  modal?: boolean
  /** `false` mientras algo viaja: ni Escape ni el fondo la cierran, para no cerrar
   *  creyendo que se canceló. */
  dismissible?: boolean
  className: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const isTop = useLayer()
  // Quién tenía el foco al abrir, leído en el PRIMER render: para cuando corren los
  // efectos, un campo de adentro con `autoFocus` ya se lo quedó.
  const [anterior] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null))

  // DOS efectos, no uno: tomar el foco ocurre UNA VEZ, al abrir; escuchar
  // Escape necesita el `onClose` de ahora. Con los dos juntos, y como los
  // llamadores pasan una flecha en linea, cualquier re-render del padre —un
  // refetch de react-query, apretar un chip, ordenar— rearmaba el efecto
  // entero y le sacaba el cursor a quien estaba escribiendo en el panel.
  useEffect(() => {
    // Un campo de adentro con `autoFocus` ya tomó el foco (el nombre de un grupo): se
    // respeta. Si no, lo toma la ventana.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus()
    // Devolver el foco a donde estaba: sin esto, cerrar deja a quien navega
    // con teclado al principio del documento.
    return () => { anterior?.focus() }
  }, [anterior])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape' && isTop() && dismissible) onClose() }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [onClose, isTop, dismissible])

  // Sin fondo no hay nada que reciba el clic de afuera: se escucha en el documento.
  useEffect(() => {
    if (modal) return
    const alClic = (e: MouseEvent) => {
      const target = e.target as Element
      // Un botón que abre otro panel no cierra éste al presionar: sin esto, el panel
      // desaparecía entre el mousedown y el click y la fila parpadeaba (revisión final).
      if (target.closest?.('[data-panel-trigger]')) return
      if (isScrollbarClick(e, target)) return
      if (panel.current && !panel.current.contains(target)) onClose()
    }
    document.addEventListener('mousedown', alClic)
    return () => document.removeEventListener('mousedown', alClic)
  }, [modal, onClose])

  // Solo el diálogo modal atrapa el Tab. La vista rápida (`modal={false}`) deja
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
    if (!modal || e.key !== 'Tab' || !panel.current) return
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
    // `contents`: un contenedor sin caja. Sin él, fondo y ventana eran hijos del padre y
    // heredaban su espaciado (`space-y-*` da margin-bottom), y un `fixed inset-0` con
    // margen mide menos que la pantalla (Crear usuario en dev, 17/10).
    <div className="contents">
      {modal && (
        <div data-testid="panel-overlay" className="fixed inset-0 z-40 bg-black/50 animate-backdrop-in"
             onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      )}
      <div
        ref={panel}
        role="dialog"
        aria-modal={modal ? 'true' : undefined}
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={atraparTab}
        className={`fixed z-50 focus-visible:outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
