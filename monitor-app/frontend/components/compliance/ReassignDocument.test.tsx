import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReassignDocument } from './ReassignDocument'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), reassign: vi.fn() },
}))
import { complianceApi } from '@/lib/api/compliance'

const PENDIENTE = {
  id: 'rec-2', carrier_id: 'c1', carrier_name: 'ACME', carrier_tax_id: '1-9',
  carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
  entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
  requirement_id: 'req-2', requirement_code: 'PADRON', document_name: 'Padrón',
  status: 'MISSING', expiration_date: null,
}

function setup(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReassignDocument recordId="rec-1" carrierId="c1" onDone={onDone} />
    </QueryClientProvider>,
  )
  return onDone
}

beforeEach(() => {
  vi.mocked(complianceApi.listPending).mockReset()
    .mockResolvedValue({ total: 1, rows: [PENDIENTE] } as never)
  vi.mocked(complianceApi.reassign).mockReset().mockResolvedValue({ ok: true, to_tray: false })
})

describe('ReassignDocument — HU-03', () => {
  it('no ocupa espacio hasta que se necesita', () => {
    setup()
    expect(screen.getByRole('button', { name: /reasignar/i })).toBeInTheDocument()
    expect(screen.queryByText(/a dónde va/i)).not.toBeInTheDocument()
  })

  it('reasigna a otro requisito eligiendo el hueco', async () => {
    const onDone = setup()
    fireEvent.click(screen.getByRole('button', { name: /reasignar/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Padrón/ }))

    await waitFor(() => {
      expect(complianceApi.reassign).toHaveBeenCalledWith('rec-1', {
        target_entity_type: 'ASSET', target_entity_id: 'a1', target_requirement_id: 'req-2',
      })
      expect(onDone).toHaveBeenCalled()
    })
  })

  it('devuelve el documento a la bandeja', async () => {
    const onDone = setup()
    fireEvent.click(screen.getByRole('button', { name: /reasignar/i }))
    fireEvent.click(await screen.findByRole('button', { name: /devolver a sin clasificar/i }))

    await waitFor(() => {
      expect(complianceApi.reassign).toHaveBeenCalledWith('rec-1', { to_tray: true })
      expect(onDone).toHaveBeenCalled()
    })
  })

  // Reasignar un documento a su propio requisito no hace nada: no se ofrece.
  it('no se ofrece a sí mismo como destino', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({
      total: 2, rows: [PENDIENTE, { ...PENDIENTE, id: 'rec-1', document_name: 'El mismo' }],
    } as never)
    setup()
    fireEvent.click(screen.getByRole('button', { name: /reasignar/i }))

    await screen.findByRole('button', { name: /Padrón/ })
    expect(screen.queryByRole('button', { name: /El mismo/ })).not.toBeInTheDocument()
  })

  it('muestra el error del backend sin cerrar el panel', async () => {
    vi.mocked(complianceApi.reassign).mockRejectedValue(
      new Error('la entidad no tiene una empresa activa asignada'),
    )
    setup()
    fireEvent.click(screen.getByRole('button', { name: /reasignar/i }))
    fireEvent.click(await screen.findByRole('button', { name: /devolver a sin clasificar/i }))

    expect(await screen.findByText(/empresa activa asignada/i)).toBeInTheDocument()
    expect(screen.getByText(/a dónde va/i)).toBeInTheDocument()
  })
})
