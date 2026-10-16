import type { ReactNode } from 'react'
import { SettingsIndex } from './SettingsIndex'
import { BuscadorConfig } from './BuscadorConfig'

/** Configuración: el índice a la izquierda y la sección al lado (Parte 1). En el
 *  teléfono el índice es la portada (`/settings`) y cada sección vuelve a él. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="flex items-start gap-6">
        <aside className="sticky top-0 hidden w-60 shrink-0 space-y-4 md:block">
          <BuscadorConfig />
          <SettingsIndex />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
