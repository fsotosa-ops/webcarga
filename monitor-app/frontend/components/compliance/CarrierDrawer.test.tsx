import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CarrierDrawer } from './CarrierDrawer'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue({ status: 'APPROVED_MANUAL' }),
  },
}))
// Se simula aunque el cajón ya no lo monte: si alguien lo volviera a montar,
// el test que lo prohíbe tiene que fallar por la razón correcta y no por un
// import roto.
vi.mock('./TriageWorkbench', () => ({
  TriageWorkbench: ({ carrierId }: { carrierId?: string }) =>
    <div data-testid="workbench">bandeja de {carrierId}</div>,
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { complianceApi } from '@/lib/api/compliance'

function pendiente(over: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Charlotte', carrier_tax_id: '1-9',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_id: 'r1', requirement_code: 'F30', document_name: 'F30',
    status: 'MISSING', expiration_date: null, tiene_archivo: false,
    urgencia: 'FALTA', expiration_policy: 'NONE',
    ...over,
  } as PendingComplianceRow
}

function setup(rows: PendingComplianceRow[] = [pendiente()], total = rows.length) {
  vi.mocked(complianceApi.listPending).mockResolvedValue({ total, rows })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CarrierDrawer carrierId="c1" carrierName="Transportes Charlotte Spa" />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('CarrierDrawer', () => {
  it('NO monta la bandeja adentro: el casillero no compite con una zona de arrastre', async () => {
    setup()
    await screen.findByText(/lo que falta/i)
    // Las dos superficies recibían archivos y hacían cosas distintas — la
    // grande mandaba a la bandeja sin clasificar, la chica clasificaba al
    // requisito — y no se distinguían.
    expect(screen.queryByTestId('workbench')).not.toBeInTheDocument()
  })

  it('la bandeja sigue existiendo, como destino y no como zona encima', async () => {
    setup()
    const enlace = await screen.findByRole('link', { name: /bandeja/i })
    // La Bandeja tiene ruta propia (Task 5): un enlace interno que pasara por
    // el redirect de `?vista=documentos` seria deuda desde el dia uno.
    expect(enlace).toHaveAttribute('href', '/dashboard/compliance/inbox')
  })

  it('pide solo los pendientes de esa empresa', async () => {
    setup()
    await waitFor(() =>
      expect(complianceApi.listPending).toHaveBeenCalledWith(
        expect.objectContaining({ carrierId: 'c1' }),
      ))
  })

  it('nombra cuantos documentos faltan', async () => {
    setup([pendiente({ id: 'p1' }), pendiente({ id: 'p2', requirement_id: 'r2' })])
    // Se espera el CONTEO, no el encabezado: el encabezado existe desde el
    // primer render —cuando la consulta todavia no resolvio— y esperarlo a el
    // deja pasar el test antes de que lleguen los datos.
    expect(await screen.findByText(/2 documentos/)).toBeInTheDocument()
  })

  // Spec §7: en la interfaz nunca aparecen las palabras "hueco" ni "slot".
  it('nunca dice hueco ni slot', async () => {
    setup()
    await screen.findByText(/lo que falta/i)
    expect(document.body.textContent).not.toMatch(/hueco|slot/i)
  })

  it('agrupa lo que falta por sujeto', async () => {
    setup([
      pendiente({ id: 'p1', category: 'EMPRESA', entity_type: 'CARRIER', subject_name: null }),
      pendiente({ id: 'p2', category: 'CHOFER', entity_type: 'DRIVER',
                  entity_id: 'd1', subject_name: 'Juan Pérez', document_name: 'Licencia' }),
      pendiente({ id: 'p3', category: 'EQUIPO', entity_type: 'ASSET',
                  entity_id: 'a1', subject_name: 'ABCD12', document_name: 'Revisión Técnica' }),
    ])

    expect(await screen.findByText('De la empresa')).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
  })

  it('sube por el camino directo, no por el de la pila', async () => {
    setup([pendiente({ id: 'p1', expiration_policy: 'NONE' })])
    // Los sujetos arrancan plegados para que el cajon quepa en la pantalla.
    fireEvent.click(await screen.findByText('De la empresa'))

    fireEvent.change(screen.getByTestId('archivo-p1'), {
      target: { files: [new File(['x'], 'f30.pdf', { type: 'application/pdf' })] },
    })

    await waitFor(() => expect(complianceApi.uploadFile).toHaveBeenCalledWith(
      'p1', expect.any(File), undefined,
    ))
    // La otra puerta —subir primero, clasificar despues— ya no existe en el
    // cliente: se borro al quedarse sin llamadores.
  })

  it('con la fecha obligatoria no sube nada hasta tenerla', async () => {
    setup([pendiente({ id: 'p1', expiration_policy: 'REQUIRED' })])
    fireEvent.click(await screen.findByText('De la empresa'))

    fireEvent.change(screen.getByTestId('archivo-p1'), {
      target: { files: [new File(['x'], 'f30.pdf', { type: 'application/pdf' })] },
    })

    expect(await screen.findByLabelText(/vence el/i)).toBeInTheDocument()
    expect(complianceApi.uploadFile).not.toHaveBeenCalled()
  })

  // MEDIDO EN STAGING (2026-08-15): con los sujetos abiertos, el cajon de
  // Transportes Charlotte media 3.159px — 9 sujetos, 91 lineas de requisito —
  // contra 633px de lista visible. Cinco pantallas. Eso contradice la razon de
  // ser del cajon: "no achica nada y nunca saca al usuario de donde estaba".
  // Para volver a la lista habia que subir cinco pantallas, peor que el panel
  // lateral que se revirtio. El mockup ya lo preveia: muestra unos pocos
  // requisitos y pliega el resto.
  it('los sujetos arrancan plegados: el cajon tiene que caber en la pantalla', async () => {
    setup([
      pendiente({ id: 'p2', category: 'CHOFER', entity_type: 'DRIVER',
                  entity_id: 'd1', subject_name: 'Juan Pérez', document_name: 'Licencia' }),
    ])
    await screen.findByText('Juan Pérez')

    expect(screen.queryByText('Licencia')).not.toBeInTheDocument()
    // Pero el encabezado ya dice cuanto le falta, asi que se puede decidir
    // sin desplegar.
    expect(screen.getByText(/faltan 1$/)).toBeInTheDocument()
  })

  it('un sujeto se despliega al tocarlo', async () => {
    setup([
      pendiente({ id: 'p2', category: 'CHOFER', entity_type: 'DRIVER',
                  entity_id: 'd1', subject_name: 'Juan Pérez', document_name: 'Licencia' }),
    ])
    await screen.findByText('Juan Pérez')

    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(screen.getByText('Licencia')).toBeInTheDocument()
  })

  it('sin pendientes lo celebra en vez de mostrar una lista vacia', async () => {
    setup([])
    expect(await screen.findByText(/no le falta ningún documento/i)).toBeInTheDocument()
  })

  // El motivo sale de `urgencia` y no de `status`: los 9 registros vencidos
  // por fecha del módulo están en APPROVED_MANUAL, así que leer el status los
  // dejaba indistinguibles de un faltante. El SQL manda las dos cosas y sólo
  // una es la respuesta a "¿por qué está pendiente?".
  it('un vencido se distingue de un faltante, aunque su status no diga EXPIRED', async () => {
    setup([pendiente({
      status: 'APPROVED_MANUAL', expiration_date: '2026-01-01',
      urgencia: 'VENCIDO', tiene_archivo: true,
    })])
    fireEvent.click(await screen.findByText('De la empresa'))
    expect(screen.getByText(/^vencido hace \d+ días?$/)).toBeInTheDocument()
  })

  // El cajón sólo sabe de lo que FALTA: mirar el archivo cargado es trabajo
  // de la ficha, que es la pantalla que lo muestra entero. Sin `onVer` el
  // renglón no promete una vista previa que acá nadie abriría.
  it('el cajón no ofrece ver el archivo: para eso está la ficha', async () => {
    setup([pendiente({ status: 'EXPIRED', urgencia: 'VENCIDO', tiene_archivo: true })])
    fireEvent.click(await screen.findByText('De la empresa'))
    expect(screen.queryByRole('button', { name: 'Ver' })).not.toBeInTheDocument()
  })
})

describe('CarrierDrawer sin permiso de edición', () => {
  it('un lector no ve el boton de subir', async () => {
    vi.resetModules()
    vi.doMock('@/hooks/useCanEdit', () => ({ useCanEdit: () => false }))
    const { CarrierDrawer: SoloLectura } = await import('./CarrierDrawer')
    vi.mocked(complianceApi.listPending).mockResolvedValue({
      total: 1, rows: [pendiente()],
    })

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SoloLectura carrierId="c1" carrierName="Charlotte" />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByText('De la empresa'))
    expect(screen.getByText('F30')).toBeInTheDocument()
    expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
  })
})


// El cajón pide 200, que es el tope duro de /pending. Medido en produccion:
// "Inversiones Huemul Spa" tiene 381 pendientes, asi que el cajon mostraba 200
// y afirmaba "200 documentos" — sin error y sin aviso.
describe('CarrierDrawer — la cuenta es la real, no la que se trajo', () => {
  it('cuenta el total del servidor, no el largo de la pagina', async () => {
    setup([pendiente({ id: 'p1' }), pendiente({ id: 'p2' })], 381)
    expect(await screen.findByText(/381 documentos/)).toBeInTheDocument()
  })

  it('avisa que la lista viene cortada', async () => {
    setup([pendiente({ id: 'p1' }), pendiente({ id: 'p2' })], 381)
    expect(await screen.findByText(/se listan los primeros 2/)).toBeInTheDocument()
  })

  it('no avisa nada cuando llego todo', async () => {
    setup([pendiente({ id: 'p1' }), pendiente({ id: 'p2' })])
    expect(await screen.findByText(/2 documentos/)).toBeInTheDocument()
    expect(screen.queryByText(/se listan los primeros/)).not.toBeInTheDocument()
  })
})
