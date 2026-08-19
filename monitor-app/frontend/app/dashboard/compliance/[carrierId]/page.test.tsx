import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import FichaEmpresaPage from './page'
import type { Carrier, PendingComplianceRow } from '@/lib/types'

vi.mock('next/navigation', () => ({ useParams: vi.fn() }))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn(),
    get: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue({ status: 'APPROVED_MANUAL' }),
  },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { get: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: vi.fn(() => true) }))

import { useParams } from 'next/navigation'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import { useCanEdit } from '@/hooks/useCanEdit'

const CARRIER: Carrier = {
  id: 'c1', tax_id: '1-9', country_code: 'CL', business_name: 'Transportes Demo Spa',
  operational_status: 'ACTIVE', management_types: null,
  legacy_admin_id: null, erp_id: null, is_manual_override: false,
  overridden_by: null, overridden_at: null, created_at: null, updated_at: null,
  contacts: [], compliance_records: [],
}

function fila(over: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Demo Spa', carrier_tax_id: '1-9',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_id: 'r1', requirement_code: 'F30', document_name: 'F30',
    status: 'MISSING', expiration_date: null,
    urgencia: 'FALTA', expiration_policy: 'NONE',
    ...over,
  } as PendingComplianceRow
}

/** Arma el QueryClientProvider y mockea `complianceApi.listPending`, mismo
 *  patrón que `CarrierDrawer.test.tsx`.
 *
 *  Ronda de arreglo 1: la página pide `estado='todos'` UNA sola vez —ya no
 *  cuatro variantes por bucket— y filtra en el cliente sobre `urgencia`. Por
 *  eso `montar()` mockea un solo `mockResolvedValue`, no cuatro. */
function montar(rows: PendingComplianceRow[], total = rows.length) {
  vi.mocked(useParams).mockReturnValue({ carrierId: 'c1' })
  vi.mocked(carriersApi.get).mockResolvedValue(CARRIER)
  vi.mocked(complianceApi.listPending).mockResolvedValue({ total, rows })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FichaEmpresaPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('FichaEmpresaPage', () => {
  it('muestra la empresa, sus conductores y sus vehículos juntos', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'CARRIER', subject_name: null }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
      fila({ id: 'p3', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' }),
    ])
    expect(await screen.findByText('De la empresa')).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('HKXW55')).toBeInTheDocument()
  })

  it('empieza mostrando TODO, no sólo lo que falta', async () => {
    // Es la razon de ser de la pantalla: los 23 documentos cargados de la
    // unica empresa con documentacion no aparecian en ningun lado del modulo.
    montar([fila()])
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'todos' }),
    ))
    // La llamada sola no alcanza: es la UNICA que la pagina hace, siempre con
    // estado:'todos', sin importar el filtro activo — filtrar es trabajo del
    // cliente desde la ronda de arreglo 1. Lo que prueba que arranca
    // mostrando TODO es el filtro activo, no la llamada.
    await screen.findByText('De la empresa')
    expect(screen.getByRole('button', { name: /^Todo/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('cambiar el filtro cambia lo que se ve, sin volver a pedir nada', async () => {
    // Ronda de arreglo 1: una sola consulta (estado='todos'); el filtro
    // reparte lo que ya llegó usando `urgencia`, no dispara una consulta
    // nueva por click.
    montar([
      fila({ id: 'p1', document_name: 'Certificado al día', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA' }),
      fila({ id: 'p2', document_name: 'Rol SII', status: 'MISSING', urgencia: 'FALTA' }),
    ])
    await screen.findByText('Certificado al día')
    expect(screen.getByText('Rol SII')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Al día/i }))

    expect(screen.getByText('Certificado al día')).toBeInTheDocument()
    expect(screen.queryByText('Rol SII')).not.toBeInTheDocument()
    expect(complianceApi.listPending).toHaveBeenCalledTimes(1)
  })

  it('un documento cargado se puede ver; uno que falta se puede cargar', async () => {
    montar([
      fila({ id: 'p1', status: 'APPROVED_MANUAL', document_name: 'Certificado de Vigencia', urgencia: 'AL_DIA' }),
      fila({ id: 'p2', status: 'MISSING', document_name: 'Rol SII' }),
    ])
    expect(await screen.findByRole('button', { name: /ver/i })).toBeInTheDocument()
    expect(screen.getByTestId('archivo-p2')).toBeInTheDocument()
  })

  it('sin documentos dice por dónde empezar, no una tabla vacía', async () => {
    // Es el caso de 32 de las 34 empresas activas.
    montar([])
    expect(await screen.findByText(/nadie cargó documentos/i)).toBeInTheDocument()
  })

  it('un lector ve todo y no puede cargar nada', async () => {
    vi.mocked(useCanEdit).mockReturnValue(false)
    montar([fila({ id: 'p1', status: 'MISSING' })])
    expect(await screen.findByText('De la empresa')).toBeInTheDocument()
    expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
  })

  it('si la lista vino truncada, sólo la cifra de "todos" se muestra', async () => {
    // rows.length (2) < total (500): contar sobre lo que llego para las
    // otras tres cifras mentiria — son una muestra, no el universo.
    montar([fila({ id: 'p1' }), fila({ id: 'p2', requirement_id: 'r2' })], 500)
    await screen.findByText('De la empresa')
    expect(screen.getByText('requisitos')).toBeInTheDocument()
    expect(screen.queryByText('al día')).not.toBeInTheDocument()
    expect(screen.queryByText('faltan')).not.toBeInTheDocument()
    expect(screen.queryByText('por vencer')).not.toBeInTheDocument()
  })

  it('sin flota conocida, el chip de tipo de operación lo dice en vez de desaparecer', async () => {
    montar([])
    expect(await screen.findByText('Tipo de operación sin determinar')).toBeInTheDocument()
  })
})
