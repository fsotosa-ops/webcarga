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

  // Misma formula que el boton vecino de descartar: convivian "Mover 3 a otra
  // empresa" y "Descartar los 3".
  it('anuncia cuántos documentos va a mover, con la misma fórmula que descartar', () => {
    setup()
    expect(screen.getByRole('button', { name: /mover los 2 a otra empresa/i })).toBeInTheDocument()
  })

  it('con un solo archivo concuerda en singular', () => {
    setup(['i1'])
    expect(screen.getByRole('button', { name: /mover 1 archivo a otra empresa/i })).toBeInTheDocument()
  })

  it('mueve la selección a la empresa elegida', async () => {
    const onMoved = setup()
    fireEvent.click(screen.getByRole('button', { name: /mover los 2 a otra empresa/i }))
    fireEvent.change(await screen.findByPlaceholderText(/buscar empresa/i), {
      target: { value: 'Otra' },
    })
    fireEvent.click(await screen.findByText('Otra Empresa'))

    await waitFor(() => {
      expect(documentIngestApi.moveItems).toHaveBeenCalledWith(['i1', 'i2'], 'c2')
      // Avisa cuántos movió: el aviso lo escribe el Workbench.
      expect(onMoved).toHaveBeenCalledWith(2)
    })
  })

  // El refresco lo hace el Workbench, con la MISMA lista de claves que usan
  // subir, clasificar, descartar y deshacer. Acá vivía un conjunto propio de
  // dos claves — cinco mutaciones con cinco conjuntos distintos es justo el
  // patrón que dejaba el contador del sidebar contradiciendo a la lista.
  it('delega el refresco en vez de tener su propio conjunto de claves', async () => {
    const spy = vi.fn()
    const onMoved = setup()
    lastClient.invalidateQueries = spy

    fireEvent.click(screen.getByRole('button', { name: /mover los 2 a otra empresa/i }))
    fireEvent.change(await screen.findByPlaceholderText(/buscar empresa/i), {
      target: { value: 'Otra' },
    })
    fireEvent.click(await screen.findByText('Otra Empresa'))

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(spy).not.toHaveBeenCalled()
  })
})
