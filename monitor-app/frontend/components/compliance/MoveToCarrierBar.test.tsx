import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MoveToCarrierBar } from './MoveToCarrierBar'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { moveItems: vi.fn() },
}))
// carriersApi.list devuelve { data }, no { rows } — con la clave equivocada el
// picker no lista nada y el test pasaría a verde por la razón incorrecta.
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [
    { id: 'c2', business_name: 'Otra Empresa', tax_id: '76000000-0' },
  ] }) },
}))
import { documentIngestApi } from '@/lib/api/documentIngest'

let lastClient: QueryClient

function setup(targetIds = ['i1', 'i2'], onMoved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  lastClient = qc
  render(
    <QueryClientProvider client={qc}>
      <MoveToCarrierBar targetIds={targetIds} currentCarrierId="c1" onMoved={onMoved} />
    </QueryClientProvider>,
  )
  return onMoved
}

beforeEach(() => {
  vi.mocked(documentIngestApi.moveItems).mockReset().mockResolvedValue({ moved: 2 })
})

describe('MoveToCarrierBar', () => {
  it('no aparece si no hay nada seleccionado', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MoveToCarrierBar targetIds={[]} currentCarrierId="c1" onMoved={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('anuncia cuántos documentos va a mover', () => {
    setup()
    expect(screen.getByRole('button', { name: /mover 2 a otra empresa/i })).toBeInTheDocument()
  })

  it('mueve la selección a la empresa elegida', async () => {
    const onMoved = setup()
    fireEvent.click(screen.getByRole('button', { name: /mover 2 a otra empresa/i }))
    fireEvent.change(await screen.findByPlaceholderText(/buscar empresa/i), {
      target: { value: 'Otra' },
    })
    fireEvent.click(await screen.findByText('Otra Empresa'))

    await waitFor(() => {
      expect(documentIngestApi.moveItems).toHaveBeenCalledWith(['i1', 'i2'], 'c2')
      expect(onMoved).toHaveBeenCalled()
    })
  })

  // BUG REAL encontrado en el click-through del 2026-08-14: invalidaba
  // ['ingest-tray', …], clave que dejó de existir al renombrarse la cola a
  // ['ingest-queue', …]. El backend movía bien, pero la lista quedaba stale y
  // el grupo de origen seguía mostrando los documentos ya movidos.
  it('refresca la cola después de mover, no solo el origen', async () => {
    const spy = vi.fn()
    setup()
    lastClient.invalidateQueries = spy

    fireEvent.click(screen.getByRole('button', { name: /mover 2 a otra empresa/i }))
    fireEvent.change(await screen.findByPlaceholderText(/buscar empresa/i), {
      target: { value: 'Otra' },
    })
    fireEvent.click(await screen.findByText('Otra Empresa'))

    await waitFor(() => {
      const claves = spy.mock.calls.map(c => JSON.stringify(c[0].queryKey))
      expect(claves).toContain('["ingest-queue"]')
      expect(claves).toContain('["ingest-queue-count"]')
    })
  })
})
