import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// La ruta activa se mueve por test. Dejo de fijarla en '/dashboard/carriers'
// porque desde el 2026-08-27 ESA ruta pertenece al grupo Certificación —el
// Directorio volvió al menú— y entonces el grupo se abre solo, y el clic que
// estos tests hacen para abrirlo lo CERRABA. Dos de ellos seguían en verde
// leyendo los enlaces del nav mobile, o sea probando otra cosa.
const nav = vi.hoisted(() => ({ ruta: '/dashboard/insurance' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.ruta,
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
  nav.ruta = '/dashboard/insurance'
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
    // El grupo arranca plegado (la ruta activa del mock está fuera del grupo,
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

  // El bottom nav mobile no tiene el concepto de grupo desplegable: aplana
  // NAV_GROUPS a mano (ver comentario junto a MOBILE_NAV_ITEMS). Sin este
  // test, volver a listar Monitor "a mano" en vez de aplanar los grupos deja
  // a Certificacion afuera del mobile EN SILENCIO — nada se pone rojo.
  it('en mobile las dos entradas de Certificación existen', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()

    const navMobile = await screen.findByRole('navigation', { name: /móvil/i })
    expect(within(navMobile).getByRole('link', { name: /^empresas$/i }))
      .toHaveAttribute('href', '/dashboard/compliance')
    expect(within(navMobile).getByRole('link', { name: /sin clasificar/i }))
      .toHaveAttribute('href', '/dashboard/compliance/inbox')
  })

  // El Directorio volvió al menú el 2026-08-27 (bug crítico #3 de la minuta
  // del 25/08): era la ÚNICA pantalla donde se da de alta un conductor o un
  // vehículo dentro de una empresa, y el rediseño del 19/08 la había dejado
  // sin entrada. Es también el destino de los enlaces de escape del pre-cierre.
  it('el Directorio tiene entrada propia y pertenece a Certificación', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    nav.ruta = '/dashboard/carriers'
    setup()

    // Estando parado en el Directorio, el grupo se abre solo: es donde estoy.
    const enlaces = await screen.findAllByRole('link', { name: /directorio/i })
    expect(enlaces[0]).toHaveAttribute('href', '/dashboard/carriers')
    expect(await screen.findByRole('button', { name: /certificación/i }))
      .toHaveAttribute('aria-expanded', 'true')
  })

  // Dos entradas con el mismo nombre en el mismo grupo no son navegación, son
  // una adivinanza. "Empresas" es el embudo de certificación y "Directorio" es
  // el padrón con su alta: son dos trabajos, y por eso se llaman distinto.
  it('ninguna entrada de Certificación repite el nombre de otra', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    nav.ruta = '/dashboard/carriers'
    setup()

    const aside = document.querySelector('aside')!
    const enlaces = await waitFor(() => {
      const encontrados = within(aside).getAllByRole('link')
        .filter(a => a.getAttribute('href')?.startsWith('/dashboard/compliance')
                  || a.getAttribute('href') === '/dashboard/carriers')
      expect(encontrados).toHaveLength(3)
      return encontrados
    })

    const nombres = enlaces.map(a => a.textContent?.trim())
    expect(new Set(nombres).size).toBe(nombres.length)
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
