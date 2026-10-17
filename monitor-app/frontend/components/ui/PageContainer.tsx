import type { ReactNode } from 'react'

/** El contenedor de una pantalla del panel: el mismo margen y la misma separación entre
 *  bloques en todas, más chico en el teléfono. Cada pantalla escribía el suyo (16/10:
 *  `space-y-3`, `-4` o `-5`, y el Cierre `p-6` también en el teléfono), y por eso los
 *  márgenes no calzaban entre módulos. Lo protege la guarda de `lib/ui/sistema.test.ts`. */
export function PageContainer({ children, scrollable = false, width = 'full', bottomBar = false }: {
  children: ReactNode
  /** La pantalla desplaza su propio contenido dentro de un layout de columna (Monitor, Configuración). */
  scrollable?: boolean
  /** `reading`: una pantalla de lectura se limita al ancho que se lee. */
  width?: 'full' | 'reading'
  /** Deja lugar a una barra fija al pie (la de selección de Pendientes de Certificación). */
  bottomBar?: boolean
}) {
  const clases = [
    'p-4 md:p-6 space-y-4',
    scrollable && 'flex-1 overflow-y-auto',
    width === 'reading' && 'max-w-6xl mx-auto',
    bottomBar && 'pb-24',
  ].filter(Boolean).join(' ')
  return <div className={clases}>{children}</div>
}
