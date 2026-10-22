import type { ReactNode } from 'react'

/** La tarjeta de contenido de una pantalla: la misma que envuelve la Flota del día
 *  (`bg-white rounded-2xl border shadow-sm`). Configuración la usa en todas sus
 *  secciones (spec 2026-10-22 §3.4). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-white p-4 shadow-sm md:p-5 ${className}`.trim()}>
      {children}
    </div>
  )
}
