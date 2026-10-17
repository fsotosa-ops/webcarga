import type { ReactNode } from 'react'
import { SettingsIndex } from './SettingsIndex'
import { BuscadorConfig } from './BuscadorConfig'
import { PageContainer } from '@/components/ui/PageContainer'

/** Configuración: el índice a la izquierda y la sección al lado (Parte 1). En el
 *  teléfono el índice es la portada (`/settings`) y cada sección vuelve a él. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer scrollable>
      <div className="flex items-start gap-6">
        <aside className="sticky top-0 hidden w-60 shrink-0 space-y-4 md:block">
          <BuscadorConfig />
          <SettingsIndex />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageContainer>
  )
}
