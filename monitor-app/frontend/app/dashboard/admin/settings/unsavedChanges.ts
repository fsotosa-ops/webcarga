'use client'

import { useEffect } from 'react'

/** Aviso al salir con cambios sin guardar (spec 2026-10-22 §3.1). Next no permite
 *  bloquear una navegación interna: el índice de Configuración pregunta antes de
 *  cambiar de sección, y el navegador, antes de cerrar o recargar la pestaña. */
let hayCambios = false

export const LEAVE_QUESTION = 'Tienes cambios sin guardar. ¿Salir igual?'

export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    hayCambios = dirty
    if (!dirty) return
    const antesDeSalir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', antesDeSalir)
    return () => {
      window.removeEventListener('beforeunload', antesDeSalir)
      hayCambios = false
    }
  }, [dirty])
}

/** Si se puede salir: sin cambios, sí; con cambios, lo que responda la persona. */
export function confirmLeave(): boolean {
  return !hayCambios || window.confirm(LEAVE_QUESTION)
}
