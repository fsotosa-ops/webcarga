import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/carriers',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { listQueue: vi.fn() },
}))

import { documentIngestApi } from '@/lib/api/documentIngest'
import Sidebar from './Sidebar'

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Sidebar role="admin" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listQueue).mockReset()
})

// HU-04, revisado en Task 5: Certificación deja de ser una entrada única y
// pasa a ser un grupo con DOS trabajos distintos adentro — Empresas y Sin
// clasificar (ex-Bandeja) —, cada uno con su propia ruta. El contador del
// trabajo pendiente vive en la entrada de "Sin clasificar", no en el grupo.
describe('Sidebar — Certificación se abre en Empresas y Sin clasificar', () => {
  beforeEach(() => {
    vi.mocked(documentIngestApi.listQueue).mockReset()
  })

  it('muestra el contador de trabajo pendiente', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 2000, rows: [] })
    setup()
    expect(await screen.findByText('2000')).toBeInTheDocument()
  })

  it('sin cola pendiente no muestra un cero al pedo', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    expect(await screen.findAllByText('Certificación')).not.toHaveLength(0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('Certificación se abre en Empresas y Sin clasificar', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    // El grupo arranca plegado (la ruta activa del mock es /dashboard/carriers,
    // ajena a Certificación), así que hay que desplegarlo para ver sus dos
    // entradas — igual que haría alguien navegando de verdad.
    fireEvent.click(await screen.findByRole('button', { name: /certificación/i }))

    const empresas = screen.getAllByRole('link', { name: /^empresas$/i })
    expect(empresas[0]).toHaveAttribute('href', '/dashboard/compliance')

    const sinClasificar = screen.getAllByRole('link', { name: /sin clasificar/i })
    expect(sinClasificar[0]).toHaveAttribute('href', '/dashboard/compliance/inbox')
  })

  it('el contador de la Bandeja vive en su entrada, no en el grupo', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 12, rows: [] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /certificación/i }))

    await waitFor(() => {
      const sinClasificar = screen.getAllByRole('link', { name: /sin clasificar/i })[0]
      expect(sinClasificar).toHaveTextContent('12')
    })
  })

  it('sin archivos esperando no dibuja un cero', async () => {
    // Un cero en rojo pediria atencion sobre nada. Es la regla que el boton
    // actual ya cumple y que este cambio no puede perder.
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /certificación/i }))

    const sinClasificar = screen.getAllByRole('link', { name: /sin clasificar/i })[0]
    expect(sinClasificar).not.toHaveTextContent('0')
  })

  it('no quedan Bandeja ni Pendientes como entradas propias', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    await screen.findAllByText('Certificación')
    expect(screen.queryByRole('link', { name: /^bandeja$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^pendientes$/i })).not.toBeInTheDocument()
  })
})

// Usuarios se mudo a Configuracion > Personas y accesos (Task 6): ya no es
// una entrada propia del menu, Configuracion queda como unica puerta a
// Administracion.
describe('Sidebar — Usuarios se mudo a Configuracion', () => {
  it('Usuarios ya no es una entrada propia del menu', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    await screen.findAllByText('Certificación')
    expect(screen.queryByRole('link', { name: /usuarios/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /configuración/i })).toBeInTheDocument()
  })
})
