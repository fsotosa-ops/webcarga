import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useContext } from 'react'

let pathname = '/dashboard/compliance/pending'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('./EntityQuickView', () => ({ EntityQuickView: ({ target }: { target: { label: string } }) => <div>Panel de {target.label}</div> }))

import { QuickViewContext, QuickViewProvider } from './QuickViewProvider'

function Abrir() {
  const open = useContext(QuickViewContext)
  return <button onClick={() => open?.({ kind: 'driver', id: 'd1', label: 'Vidal' })}>abrir</button>
}

describe('QuickViewProvider', () => {
  // Revisión final de la Entrega 1: "Abrir ficha completa" (o atrás/adelante)
  // cambia de pantalla y el panel quedaba encima de la ficha.
  it('cambiar de pantalla cierra la vista rápida', () => {
    const { rerender } = render(<QuickViewProvider><Abrir /></QuickViewProvider>)
    fireEvent.click(screen.getByText('abrir'))
    expect(screen.getByText('Panel de Vidal')).toBeInTheDocument()
    pathname = '/dashboard/drivers/d1'
    rerender(<QuickViewProvider><Abrir /></QuickViewProvider>)
    expect(screen.queryByText('Panel de Vidal')).not.toBeInTheDocument()
  })
})
