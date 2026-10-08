import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { solicitables: vi.fn(), solicitar: vi.fn() },
}))
import { complianceApi } from '@/lib/api/compliance'
import { SolicitarDocumento } from './SolicitarDocumento'

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SolicitarDocumento entityType="DRIVER" entityId="d1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(complianceApi.solicitables).mockReset().mockResolvedValue([
    { id: 'r-altura', name: 'Examen ocupacional Altura Física', requirement_code: 'ALTURA' },
  ])
  vi.mocked(complianceApi.solicitar).mockReset().mockResolvedValue({ id: 'cr1', status: 'MISSING' })
})

describe('SolicitarDocumento', () => {
  it('pide un documento a pedido a este sujeto', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /solicitar documento/i }))
    fireEvent.change(await screen.findByLabelText('Documento a solicitar'), { target: { value: 'r-altura' } })
    fireEvent.click(screen.getByRole('button', { name: /^solicitar$/i }))

    await waitFor(() => expect(complianceApi.solicitar).toHaveBeenCalledWith({
      requirement_id: 'r-altura', entity_type: 'DRIVER', entity_id: 'd1',
    }))
  })

  it('sin documentos a pedido lo dice, en vez de un desplegable vacío', async () => {
    vi.mocked(complianceApi.solicitables).mockResolvedValue([])
    montar()
    fireEvent.click(screen.getByRole('button', { name: /solicitar documento/i }))
    expect(await screen.findByText(/no hay documentos a pedido/i)).toBeInTheDocument()
  })
})
