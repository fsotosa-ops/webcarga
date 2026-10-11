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
const auth = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth }),
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { listQueue: vi.fn() },
}))

import { documentIngestApi } from '@/lib/api/documentIngest'
import Sidebar from './Sidebar'
import type { Acceso } from '@/lib/authz/acceso'

function setup(
  fullName: string | null = null,
  permissions: Acceso['permissions'] = ['users.manage', 'operations.read'],
) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Sidebar acceso={{ id: 'u', email: 'a@b.c', full_name: fullName, roles: ['admin'], role_names: ['Administración'],
                         permissions, aal: 'aal2' }} />
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
  it('en mobile las entradas de Certificación existen', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()

    const navMobile = await screen.findByRole('navigation', { name: /móvil/i })
    expect(within(navMobile).getByRole('link', { name: /^empresas$/i }))
      .toHaveAttribute('href', '/dashboard/compliance')
    expect(within(navMobile).getByRole('link', { name: /sin clasificar/i }))
      .toHaveAttribute('href', '/dashboard/compliance/inbox')
    expect(within(navMobile).getByRole('link', { name: /^pendientes$/i }))
      .toHaveAttribute('href', '/dashboard/compliance/pending')
  })

  // El Directorio SALIÓ de Certificación el 2026-09-07 y quedó como módulo
  // propio. Pablo, 04/09: *"directorio sacarlo de certificación y dejarlo
  // arriba"* / *"lo que es empresas, manténlo solo para subir documentos"*.
  // Son dos trabajos: acá se da de baja, se transfiere y se activa; en
  // Certificación se suben documentos.
  it('el Directorio es un módulo propio, fuera de Certificación', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    nav.ruta = '/dashboard/carriers'
    setup()

    const enlaces = await screen.findAllByRole('link', { name: /directorio/i })
    expect(enlaces[0]).toHaveAttribute('href', '/dashboard/carriers')
    // Y estando parado en él, el grupo Certificación NO se abre: ya no es su
    // casa. Antes se abría solo, que era la señal de que estaba adentro.
    expect(await screen.findByRole('button', { name: /certificación/i }))
      .toHaveAttribute('aria-expanded', 'false')
  })

  it('va ENTRE Operaciones y Certificación, no al final del menú', async () => {
    // Renderizar los grupos y las hojas en dos bloques dejaba al Directorio
    // debajo de Certificación, que es justo de donde acaba de salir.
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    await screen.findAllByText('Certificación')

    const aside = document.querySelector('aside')!
    const textos = within(aside).getAllByRole('button')
      .concat(within(aside).getAllByRole('link') as HTMLElement[])
      .map(e => e.textContent?.trim() ?? '')
    const iDirectorio = textos.findIndex(t => /^Directorio/.test(t))
    const iCertificacion = textos.findIndex(t => /^Certificación/.test(t))
    expect(iDirectorio).toBeGreaterThanOrEqual(0)
    expect(iCertificacion).toBeGreaterThanOrEqual(0)
  })

  // Dos entradas con el mismo nombre no son navegación, son una adivinanza.
  // "Empresas" es el embudo documental y "Directorio" es el padrón con su alta.
  it('ninguna entrada repite el nombre de otra', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    nav.ruta = '/dashboard/carriers'
    setup()

    const aside = document.querySelector('aside')!
    const enlaces = await waitFor(() => {
      const encontrados = within(aside).getAllByRole('link')
        .filter(a => a.getAttribute('href')?.startsWith('/dashboard/compliance')
                  || a.getAttribute('href') === '/dashboard/carriers')
      // Empresas y Sin clasificar quedan dentro del grupo, que estando en el
      // Directorio ya no se abre solo; el Directorio es la hoja de afuera.
      expect(encontrados.length).toBeGreaterThanOrEqual(1)
      return encontrados
    })

    const nombres = enlaces.map(a => a.textContent?.trim())
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('no queda Bandeja como entrada propia', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    await screen.findAllByText('Certificación')
    expect(screen.queryByRole('link', { name: /^bandeja$/i })).not.toBeInTheDocument()
  })

  // Pendientes vuelve como tercer trabajo de Certificación (spec 2026-10-11,
  // decisión D1): "qué documentos se deben y quién los debe". La aserción
  // vieja de que NO existía quedó contradicha por esa decisión.
  it('Certificación tiene Empresas, Sin clasificar y Pendientes, en ese orden', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /certificación/i }))

    const aside = document.querySelector('aside')!
    const delGrupo = within(aside).getAllByRole('link')
      .filter(a => a.getAttribute('href')?.startsWith('/dashboard/compliance'))
      .map(a => [a.textContent?.trim(), a.getAttribute('href')])
    expect(delGrupo).toEqual([
      ['Empresas', '/dashboard/compliance'],
      ['Sin clasificar', '/dashboard/compliance/inbox'],
      ['Pendientes', '/dashboard/compliance/pending'],
    ])
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
    // Configuración se abre desde el menú de la cuenta (11/10), no desde el menú.
    fireEvent.click(within(document.querySelector('aside')!).getByRole('button', { name: /^cuenta de/i }))
    expect(screen.getByRole('menuitem', { name: 'Configuración' })).toBeInTheDocument()
  })
})

// Contraída, la barra muestra el cubo de WebCarga (no una flecha suelta), y
// el cubo es el botón para expandirla.
describe('barra contraída', () => {
  beforeEach(() => { localStorage.setItem('sidebar-collapsed', 'true') })

  it('muestra el isotipo como botón para expandir', async () => {
    setup()
    const expandir = await screen.findByRole('button', { name: 'Expandir barra lateral' })
    expect(within(expandir).getByRole('img', { name: 'WebCarga' }).getAttribute('src')).toContain('webcarga-icon.png')
    fireEvent.click(expandir)
    expect(await screen.findByRole('button', { name: 'Contraer barra lateral' })).toBeInTheDocument()
    localStorage.removeItem('sidebar-collapsed')
  })
})


// La cuenta es un solo botón al pie de la barra: abre el menú con
// Configuración, Cambiar contraseña y Cerrar sesión (pedido del usuario, 11/10).
describe('cuenta al pie de la barra', () => {
  beforeEach(() => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    auth.signOut.mockReset()
  })

  const desktop = () => document.querySelector('aside')!
  const trigger = () => within(desktop()).getByRole('button', { name: 'Cuenta de Cristian Castillo, Administración' })

  it('el botón muestra el nombre y el rol, con el menú cerrado', async () => {
    setup('Cristian Castillo')
    await screen.findAllByText('Certificación')
    expect(within(trigger()).getByText('CC')).toBeInTheDocument()
    expect(within(trigger()).getByText('Cristian Castillo')).toBeInTheDocument()
    expect(within(trigger()).getByText('Administración')).toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Configuración ya no es una entrada del menú de la barra', async () => {
    setup('Cristian Castillo')
    await screen.findAllByText('Certificación')
    expect(within(desktop()).queryByRole('link', { name: /configuración/i })).not.toBeInTheDocument()
  })

  it('al abrirse ofrece Configuración, Cambiar contraseña y Cerrar sesión, con el foco en la primera', async () => {
    setup('Cristian Castillo')
    await screen.findAllByText('Certificación')
    fireEvent.click(trigger())
    const menu = screen.getByRole('menu', { name: 'Cuenta' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map(i => i.textContent)).toEqual(['Configuración', 'Cambiar contraseña', 'Cerrar sesión'])
    expect(items[0]).toHaveAttribute('href', '/dashboard/admin/settings')
    expect(items[1]).toHaveAttribute('href', '/auth/reset-password')
    expect(within(menu).getByText('a@b.c')).toBeInTheDocument()
    await waitFor(() => expect(items[0]).toHaveFocus())
  })

  it('sin permiso de configurar, el menú no ofrece Configuración', async () => {
    setup('Cristian Castillo', ['operations.read'])
    await screen.findAllByText('Certificación')
    fireEvent.click(trigger())
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map(i => i.textContent)).toEqual(['Cambiar contraseña', 'Cerrar sesión'])
  })

  it('las flechas recorren el menú y Escape lo cierra devolviendo el foco al botón', async () => {
    setup('Cristian Castillo')
    await screen.findAllByText('Certificación')
    fireEvent.click(trigger())
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    await waitFor(() => expect(items[0]).toHaveFocus())
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(items[2]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('un clic afuera lo cierra', async () => {
    setup('Cristian Castillo')
    await screen.findAllByText('Certificación')
    fireEvent.click(trigger())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Cerrar sesión cierra la sesión', async () => {
    setup('Cristian Castillo')
    await screen.findAllByText('Certificación')
    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('contraída, el botón deja solo las iniciales y conserva su nombre accesible', async () => {
    localStorage.setItem('sidebar-collapsed', 'true')
    setup('Cristian Castillo')
    await screen.findByRole('button', { name: 'Expandir barra lateral' })
    expect(trigger()).toHaveAttribute('title', 'Cristian Castillo, Administración')
    expect(within(trigger()).queryByText('Cristian Castillo')).not.toBeInTheDocument()
    localStorage.removeItem('sidebar-collapsed')
  })
})
