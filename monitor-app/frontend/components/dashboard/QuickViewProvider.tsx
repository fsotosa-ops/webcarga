'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { EntityQuickView } from './EntityQuickView'
import { useQuickView, type QuickViewTarget } from '@/lib/quickView'
import { usePermiso } from '@/lib/authz/PermisosProvider'

/** Abre la vista rápida; `null` sin `directory.read` o fuera del proveedor
 *  (entonces un nombre es texto, no enlace). */
export const QuickViewContext = createContext<((target: QuickViewTarget) => void) | null>(null)

export function useOpenQuickView() {
  return useContext(QuickViewContext)
}

/** La vista rápida de todo el dashboard, una sola vez (Entrega 1 de fichas,
 *  15/10): cualquier `EntityCell` la abre sin que cada pantalla arme su estado y
 *  dibuje su panel. El Monitor y el Cierre siguen con la suya (el Cierre marca
 *  la fila de origen); las pantallas nuevas usan esta. "Abrir ficha completa"
 *  vuelve a la URL desde la que se abrió. */
export function QuickViewProvider({ children }: { children: ReactNode }) {
  const quickView = useQuickView()
  const [returnTo, setReturnTo] = useState<string | undefined>()
  const canRead = usePermiso('directory.read')
  const canRequestDocuments = usePermiso('certification.request')

  const { open: openTarget, close } = quickView
  // Cambiar de pantalla ("Abrir ficha completa", atrás/adelante) cierra el
  // panel: el proveedor vive en el layout y no se desmonta entre rutas.
  const pathname = usePathname()
  useEffect(() => { close() }, [pathname, close])
  const open = useCallback((target: QuickViewTarget) => {
    setReturnTo(`${window.location.pathname}${window.location.search}`)
    openTarget(target)
  }, [openTarget])

  return (
    <QuickViewContext.Provider value={canRead ? open : null}>
      {children}
      {quickView.current && (
        <EntityQuickView
          key={`${quickView.current.kind}:${quickView.current.id}`}
          target={quickView.current}
          canGoBack={quickView.canGoBack}
          onNavigate={quickView.navigate}
          onBack={quickView.back}
          onClose={quickView.close}
          returnTo={returnTo}
          canRequestDocuments={canRequestDocuments}
        />
      )}
    </QuickViewContext.Provider>
  )
}
