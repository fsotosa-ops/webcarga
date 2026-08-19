import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const replace = vi.fn()
const push = vi.fn()
let params = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace, push }),
  // La fila abierta vive en la URL, asi que el hook necesita saber donde esta.
  usePathname: () => '/dashboard/compliance',
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listStatus: vi.fn(),
    listPending: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    listRequirements: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    previewUrl: vi.fn(), upload: vi.fn(), remove: vi.fn(),
    classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
// El panel de alta se simula: lo que se prueba acá no es el formulario, es a
// donde lleva la pagina DESPUES de crear.
vi.mock('@/components/dashboard/NewCarrierPanel', () => ({
  NewCarrierPanel: ({ open, onCreated }: {
    open: boolean
    onCreated: (c: { id: string; business_name: string }) => void
  }) => open ? (
    <button data-testid="crear-empresa-ok"
            onClick={() => onCreated({ id: 'c-nueva', business_name: 'Empresa Nueva Spa' })}>
      simular alta
    </button>
  ) : null,
}))

import { complianceApi } from '@/lib/api/compliance'
import type { CertificationStatusRow } from '@/lib/types'
import CertificationPage from './page'

const FILA = {
  entity_id: 'c1', entity_name: 'Test Empresa Webcarga',
  carrier_id: 'c1', carrier_name: 'Test Empresa Webcarga', operational_status: 'ACTIVE',
  total_count: 12, satisfied_count: 9, pending_count: 3, pending_mandatory: 1,
  unclassified_count: 3,
  // Agrupando por empresa la lista es el embudo, y el embudo ubica cada fila
  // por su etapa: sin `funnel_group` la fila no pertenece a ningun grupo y no
  // se dibuja en ninguna parte.
  expired_count: 0, management_types: ['TRACTOREO'], trips_30d: 0,
  funnel_group: 'en_proceso',
} satisfies CertificationStatusRow

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CertificationPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  params = new URLSearchParams()
  vi.mocked(complianceApi.listStatus).mockResolvedValue({
    total_pending: 3, total_unclassified: 3, rows: [FILA],
  })
})

// El módulo dejó de ser tres listas hermanas (Pendientes, Bandeja, Empresas):
// es UNA lista de empresas con dos maneras de mirarla.
describe('Certificación — una lista, dos vistas', () => {
  it('abre en la vista por empresa, que responde cómo va cada una', async () => {
    setup()
    expect(await screen.findByText('Test Empresa Webcarga')).toBeInTheDocument()
    expect(screen.getByText('9 de 12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Empresa' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('muestra en la misma fila lo que falta y lo que llegó sin clasificar', async () => {
    setup()
    // El embudo dejo de ser una tabla: la fila es el contenedor con role=button
    // que se abre hacia abajo. La intencion del test no cambia — las dos
    // mitades del trabajo tienen que estar juntas, porque tenerlas en dos
    // listas hermanas obligaba a cruzarlas de memoria.
    const fila = (await screen.findByText('Test Empresa Webcarga')).closest('[role="button"]')!
    expect(fila).toHaveTextContent('9 de 12')
    expect(within(fila as HTMLElement).getByTestId('espera-c1')).toHaveTextContent('3')
  })

  // "la vista viaja en la URL, así volver del detalle no pierde el lugar"
  // vivía acá, tocando el botón "Sin clasificar": ese botón dejó de existir
  // en el conmutador (Task 5), así que el test se elimina sin reemplazo — el
  // test de abajo ("un enlace guardado…") cubre lo que le queda de vigente,
  // que es el redirect.

  // La bandeja dejó de ser una vista de este conmutador (Task 5): tiene ruta
  // propia. Un enlace guardado con `?vista=documentos` —el que existía antes
  // de este cambio— no puede quedar apuntando a una pantalla vacía, así que
  // se reenvía a la ruta nueva. `replace` y no `push`: llegar por un enlace
  // guardado no es un paso de navegación que el botón atrás deba reponer.
  it('un enlace guardado a ?vista=documentos lleva a la Bandeja, no a una pantalla vacía', async () => {
    params = new URLSearchParams('vista=documentos')
    setup()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/compliance/inbox'))
  })

  // Spec §4: las cuatro opciones miran los mismos pendientes agrupados
  // distinto. La bandeja NO es una quinta: son archivos que todavia no
  // pertenecen a nada, asi que vive detras de su propio boton.
  it('el conmutador agrupa de cuatro maneras, y por requisito es una de ellas', async () => {
    setup()
    await screen.findByText('Test Empresa Webcarga')

    const agrupador = screen.getByRole('group', { name: /agrupar por/i })
    const opciones = within(agrupador).getAllByRole('button').map(b => b.textContent)
    expect(opciones).toEqual(['Empresa', 'Conductor', 'Vehículo', 'Requisito'])
  })

  // La bandeja ya no vive en esta pantalla (Task 5): no hay boton propio que
  // buscar aca, tiene ruta y entrada de sidebar propias. El contador que este
  // test verificaba paso a Sidebar.test.tsx ("el contador de la Bandeja vive
  // en su entrada, no en el grupo" y "sin archivos esperando no dibuja un
  // cero").
  it('la bandeja no esta entre las agrupaciones', async () => {
    setup()
    await screen.findByText('Test Empresa Webcarga')

    const agrupador = screen.getByRole('group', { name: /agrupar por/i })
    expect(within(agrupador).queryByText(/sin clasificar/i)).not.toBeInTheDocument()
  })

  it('agrupa por requisito', async () => {
    params = new URLSearchParams('vista=requisitos')
    setup()
    await waitFor(() => {
      expect(complianceApi.listStatus).toHaveBeenCalledWith(
        expect.objectContaining({ group: 'requirement' }),
      )
    })
  })

  it('busca empresas sin recargar la vista', async () => {
    setup()
    await screen.findByText('Test Empresa Webcarga')
    fireEvent.change(screen.getByPlaceholderText(/buscar empresa/i), { target: { value: 'quilquen' } })

    await waitFor(() => {
      expect(complianceApi.listStatus).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'quilquen', group: 'carrier' }),
      )
    }, { timeout: 2000 })
  })

  it('agrupa por conductor y muestra la empresa de cada uno', async () => {
    params = new URLSearchParams('vista=conductores')
    vi.mocked(complianceApi.listStatus).mockResolvedValue({
      total_pending: 3, total_unclassified: 0,
      rows: [{ ...FILA, entity_id: 'd1', entity_name: 'Juan Pérez',
               carrier_id: 'c9', carrier_name: 'Transportes Sur Spa' }],
    })
    setup()

    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    // La empresa se muestra y se puede abrir, pero DENTRO de Certificacion:
    // antes era un enlace a /dashboard/carriers y eso sacaba del modulo.
    expect(screen.getByRole('button', { name: 'Transportes Sur Spa' })).toBeInTheDocument()
    expect(complianceApi.listStatus).toHaveBeenCalledWith(
      expect.objectContaining({ group: 'driver' }),
    )
  })

  it('agrupa por vehículo', async () => {
    params = new URLSearchParams('vista=vehiculos')
    setup()
    await waitFor(() => {
      expect(complianceApi.listStatus).toHaveBeenCalledWith(
        expect.objectContaining({ group: 'asset' }),
      )
    })
  })

  // "no pide el estado cuando estás en la cola" vivía acá: con `?vista=
  // documentos` esta pantalla ya no dibuja la cola, la redirige (test de
  // arriba). Que la Bandeja no pida el estado por empresa se verifica ahora
  // donde vive la Bandeja: app/dashboard/compliance/inbox/page.test.tsx
  // ("no pide el estado de certificación por empresa").

  // El `?? 0` pintaba un "0 documentos por cubrir" en cifra grande mientras la
  // consulta estaba en vuelo, y despues saltaba a 2.360: durante ese segundo la
  // pantalla afirmaba con seguridad algo falso. Se ve en produccion.
  it('no muestra un total mientras la consulta está en vuelo', async () => {
    // La promesa nunca resuelve: congela el instante de carga.
    vi.mocked(complianceApi.listStatus).mockReturnValue(new Promise(() => {}))
    setup()

    expect(await screen.findByText(/Cargando…/)).toBeInTheDocument()
    expect(screen.queryByText('documentos por cubrir')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})


// El cuarto y ultimo punto de fuga al Empresas legacy. Crear una empresa desde
// Certificacion y aterrizar en otro modulo obligaba a rehacer el filtro para
// volver a la cola de trabajo — justo lo que el modulo vino a evitar.
describe('CertificationPage — crear una empresa no saca del modulo', () => {
  it('abre la empresa nueva DENTRO de Certificacion', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /Nueva empresa/i }))
    fireEvent.click(await screen.findByTestId('crear-empresa-ok'))

    await waitFor(() => expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/dashboard/compliance?abierta=c-nueva'),
    ))
  })

  it('no navega al modulo de Empresas', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /Nueva empresa/i }))
    fireEvent.click(await screen.findByTestId('crear-empresa-ok'))

    await waitFor(() => expect(push).toHaveBeenCalled())
    for (const llamada of push.mock.calls) {
      expect(String(llamada[0])).not.toContain('/dashboard/carriers')
    }
  })
})
