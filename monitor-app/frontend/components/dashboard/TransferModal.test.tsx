import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { TransferModal } from './TransferModal'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: {
    list: vi.fn().mockResolvedValue({
      data: [{ id: 'c2', business_name: 'Otra Empresa', tax_id: '2-2' }],
    }),
  },
}))

function montar(overrides: Partial<{
  onClose: () => void
  onTransfer: (toCarrierId: string) => Promise<void>
}> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TransferModal
        open
        title="Transferir a Juan Pérez"
        currentCarrierId="c1"
        onClose={overrides.onClose ?? vi.fn()}
        onTransfer={overrides.onTransfer ?? vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  )
}

async function elegirEmpresaDestino() {
  fireEvent.change(screen.getByPlaceholderText(/empresa destino/i), { target: { value: 'Otra' } })
  fireEvent.click(await screen.findByText('Otra Empresa'))
}

describe('TransferModal', () => {
  // Hallazgo 3 de la revision final: la garantia que ConfirmarBaja tiene
  // desde la ronda anterior —que nada cierre mientras el pedido viaja— no
  // habia cruzado a este otro dialogo del mismo menu. Al desmontarse a mitad
  // de un request, el catch que hace setErr escribe sobre un componente
  // muerto y el mensaje (por ejemplo, el 409 de una asignacion protegida)
  // nunca se ve.
  it('mientras viaja, el clic en el fondo no cierra', async () => {
    let resolver: () => void = () => {}
    const onTransfer = vi.fn(() => new Promise<void>(r => { resolver = r }))
    const onClose = vi.fn()
    const { container } = montar({ onTransfer, onClose })

    await elegirEmpresaDestino()
    fireEvent.click(screen.getByRole('button', { name: /confirmar transferencia/i }))

    const fondo = container.querySelector('.absolute.inset-0') as Element
    fireEvent.click(fondo)
    expect(onClose).not.toHaveBeenCalled()

    resolver()
    await waitFor(() => expect(onTransfer).toHaveBeenCalledTimes(1))
  })

  it('mientras viaja, la X no cierra', async () => {
    let resolver: () => void = () => {}
    const onTransfer = vi.fn(() => new Promise<void>(r => { resolver = r }))
    const onClose = vi.fn()
    montar({ onTransfer, onClose })

    await elegirEmpresaDestino()
    fireEvent.click(screen.getByRole('button', { name: /confirmar transferencia/i }))

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).not.toHaveBeenCalled()

    resolver()
    await waitFor(() => expect(onTransfer).toHaveBeenCalledTimes(1))
  })

  it('terminado el request, cerrar sí funciona', async () => {
    const onClose = vi.fn()
    montar({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
