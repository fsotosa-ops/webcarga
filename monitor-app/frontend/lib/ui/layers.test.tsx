import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { DetailShell } from '@/components/dashboard/DetailShell'
import { PanelLateral } from '@/components/ui/PanelLateral'

// Revisión final de la Entrega 1: la vista rápida (PanelLateral) se abre sobre
// el modal de una ficha (DetailShell). Escape tiene que cerrar solo la capa de
// arriba; antes cerraba las dos.
describe('capas: solo la de arriba atiende Escape', () => {
  it('con la vista rápida sobre un modal, Escape cierra solo la vista rápida', () => {
    const cerrarModal = vi.fn()
    const cerrarPanel = vi.fn()
    render(
      <>
        <DetailShell variant="dialog" label="Ficha" onClose={cerrarModal}><div>ficha</div></DetailShell>
        <PanelLateral titulo="Vista rápida" onCerrar={cerrarPanel} overlay="none" pie={null}><div>panel</div></PanelLateral>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cerrarPanel).toHaveBeenCalledTimes(1)
    expect(cerrarModal).not.toHaveBeenCalled()
  })
})
