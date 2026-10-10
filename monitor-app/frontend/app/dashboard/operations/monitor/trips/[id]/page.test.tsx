import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TripDetailStandalonePage from './page'

const push = vi.fn()
let consulta = ''
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 't1' }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(consulta),
}))
vi.mock('@/lib/api/trips', () => ({ tripsApi: { get: vi.fn().mockResolvedValue({ id: 't1' }) } }))
vi.mock('@/lib/api/tripsMeta', () => ({ fetchTripsMeta: vi.fn().mockResolvedValue(null) }))
// El detalle tiene su propia suite; acá solo importa a dónde lleva cerrarlo.
vi.mock('@/components/dashboard/TripDetailView', () => ({
  TripDetailView: ({ onDismiss }: { onDismiss: () => void }) => <button onClick={onDismiss}>Cerrar detalle</button>,
}))

function abrir() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><TripDetailStandalonePage /></QueryClientProvider>)
}

beforeEach(() => { push.mockReset() })

describe('cerrar el detalle de un viaje', () => {
  it('abierto desde el Cierre, vuelve al Cierre con su fecha y su pestaña', async () => {
    consulta = 'next=%2Fdashboard%2Foperations%2Fclosures%3Ffecha%3D2026-08-04%26tab%3Dflota'
    abrir()
    fireEvent.click(await screen.findByText('Cerrar detalle'))
    expect(push).toHaveBeenCalledWith('/dashboard/operations/closures?fecha=2026-08-04&tab=flota')
  })
  it('abierto sin origen, vuelve al Monitor como siempre', async () => {
    consulta = ''
    abrir()
    fireEvent.click(await screen.findByText('Cerrar detalle'))
    expect(push).toHaveBeenCalledWith('/dashboard/operations/monitor')
  })
  it('un origen que no es de la app se ignora', async () => {
    consulta = 'next=https%3A%2F%2Fotro-sitio.cl'
    abrir()
    fireEvent.click(await screen.findByText('Cerrar detalle'))
    expect(push).toHaveBeenCalledWith('/dashboard/operations/monitor')
  })
})
