'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { PanelLateral } from './PanelLateral'
import { Button } from './Button'

/** Confirmar algo que escribe (dar de baja, eliminar, reactivar, corregir un RUT), con
 *  las reglas que aprendió `ConfirmarBaja` y que las demás copias no tenían:
 *  - el foco empieza en Cancelar (un Enter por reflejo no confirma), salvo que un campo
 *    de adentro lo pida con `autoFocus`;
 *  - mientras viaja no se confirma dos veces y nada la cierra (cerrar haría creer que
 *    se canceló);
 *  - si falla, dice por qué y queda abierta para reintentar (cerrar haría creer que
 *    ocurrió); si sale bien, se cierra. */
export function ConfirmDialog({
  title, description, confirmLabel, tone = 'primary', confirmDisabled = false, errorFallback,
  onConfirm, onClose, wide = false, children,
}: {
  title: string
  description?: ReactNode
  confirmLabel: string
  /** `danger`: no se deshace o saca algo de la operación. */
  tone?: 'primary' | 'danger'
  /** Falta lo que la acción necesita (un motivo, un dato que todavía carga). */
  confirmDisabled?: boolean
  /** El mensaje cuando el error no trae uno propio. */
  errorFallback: string
  onConfirm: () => Promise<void>
  onClose: () => void
  /** Lo que se revisa antes de confirmar es una lista larga. */
  wide?: boolean
  children?: ReactNode
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Corre después de que `Dialog` tomó el foco: si quedó en la ventana misma (ningún
  // campo lo pidió), pasa a Cancelar.
  useEffect(() => {
    const activo = document.activeElement
    if (activo?.getAttribute('role') === 'dialog') cancelRef.current?.focus()
  }, [])

  async function confirm() {
    setSending(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : errorFallback)
      setSending(false)
    }
  }

  return (
    <PanelLateral
      placement="center"
      ancho={wide ? 'amplio' : 'normal'}
      titulo={title}
      description={description}
      onCerrar={onClose}
      dismissible={!sending}
      pie={
        <div className="flex items-center justify-end gap-2">
          <Button ref={cancelRef} onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button variant={tone} onClick={confirm} disabled={sending || confirmDisabled}>
            {sending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-lectura text-text-primary">
        {children}
        {error && (
          <p role="alert" className="rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">
            {error}
          </p>
        )}
      </div>
    </PanelLateral>
  )
}
