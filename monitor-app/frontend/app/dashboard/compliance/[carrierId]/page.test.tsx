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
    status: 'MISSING', expiration_date: null, tiene_archivo: false,
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

  // Ronda de arreglo: la ficha anunciaba "Aprobado (manual)" sobre un
  // documento vencido hace un año, mientras el filtro que lo contenía decía
  // "Falta" y el embudo lo contaba en "Hay que renovar". Son 9 registros
  // reales. La fila y el filtro tienen que leer `urgencia`, que es la única
  // fuente de esa verdad y ya viene en cada fila.
  it('un vencido se anuncia vencido, aunque su status diga "Aprobado (manual)"', async () => {
    montar([fila({
      id: 'p1', document_name: 'Certificado de Vigencia', status: 'APPROVED_MANUAL',
      expiration_date: '2025-08-12', urgencia: 'VENCIDO', tiene_archivo: true,
    })])

    expect(await screen.findByText('Certificado de Vigencia')).toBeInTheDocument()
    expect(screen.getByText(/^vencido hace \d+ días?$/)).toBeInTheDocument()
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })

  // El mismo defecto al revés: un vencido TIENE archivo —venció porque
  // alguien lo subió— y la ficha, que existe para hacer visible lo cargado,
  // lo mandaba al renglón de carga y escondía el archivo.
  it('un vencido con archivo se puede ver, además de reemplazar', async () => {
    montar([fila({ id: 'p1', status: 'EXPIRED', urgencia: 'VENCIDO', tiene_archivo: true })])

    expect(await screen.findByRole('button', { name: 'Ver' })).toBeInTheDocument()
    expect(screen.getByTestId('archivo-p1')).toBeInTheDocument()
  })

  it('lo que falta y no tiene archivo no ofrece verlo', async () => {
    montar([fila({ id: 'p1', status: 'MISSING', urgencia: 'FALTA', tiene_archivo: false })])

    expect(await screen.findByTestId('archivo-p1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver' })).not.toBeInTheDocument()
  })

  // El "por vencer" caía en la fila de documento cargado con el badge de su
  // status ("Aprobado"), o sea la misma contradicción que el vencido: el
  // filtro decía "Por vencer" y el renglón decía "Aprobado".
  it('un por vencer dice cuándo vence, no "Aprobado"', async () => {
    const enDiezDias = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
    montar([fila({
      id: 'p1', status: 'APPROVED_MANUAL', expiration_date: enDiezDias,
      urgencia: 'POR_VENCER', tiene_archivo: true,
    })])

    expect(await screen.findByText(/^vence en \d+ días?$/)).toBeInTheDocument()
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })

  // "Falló" es uno de los cuatro estados obligatorios de pantalla, y su regla
  // es que no puede parecer que no pasó nada. Antes: el modal sólo se montaba
  // con `file_url`, así que si la consulta fallaba el spinner se apagaba y no
  // ocurría nada — y volver a tocar "Ver" con el mismo id no cambiaba estado,
  // así que el botón quedaba muerto hasta recargar la página.
  it('si "Ver" falla, lo dice en el renglón y deja reintentar', async () => {
    vi.mocked(complianceApi.get).mockRejectedValue(new Error('sesión vencida'))
    montar([fila({ id: 'p1', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA', tiene_archivo: true })])

    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo abrir/i)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(complianceApi.get).toHaveBeenCalledTimes(2))
  })

  // El otro camino al mismo lugar: un registro en revisión o rechazado puede
  // no tener archivo, y ofrecía "Ver" igual.
  it('un registro sin archivo que abrir lo dice, en vez de no hacer nada', async () => {
    vi.mocked(complianceApi.get).mockResolvedValue({ file_url: null } as never)
    montar([fila({ id: 'p1', status: 'PENDING_REVIEW', urgencia: 'AL_DIA', tiene_archivo: true })])

    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no tiene un archivo/i)
  })

  it('sin documentos dice por dónde empezar, no una tabla vacía', async () => {
    // Es el caso de 32 de las 34 empresas activas.
    montar([])
    expect(await screen.findByText(/nadie cargó documentos/i)).toBeInTheDocument()
  })

  // "La preselección de empresa no es comodidad: es precisión" — el motor
  // acota el universo a las entidades de esa empresa (~2 conductores y ~3
  // vehículos contra 87 y 124). El enlace pelado dejaba esa capacidad sin
  // puerta, que es palabra por palabra la crítica que la spec le hacía al
  // estado anterior.
  it('el puente a la Bandeja llega con la empresa ya elegida', async () => {
    montar([fila()])
    const enlace = await screen.findByRole('link', { name: /bandeja/i })
    expect(enlace).toHaveAttribute('href', '/dashboard/compliance/inbox?empresa=c1')
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
