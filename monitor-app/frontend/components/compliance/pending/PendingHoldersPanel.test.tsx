import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PendingHoldersPanel } from './PendingHoldersPanel'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import type { PendingComplianceRow, PendingSummaryRow } from '@/lib/types'
import { hoyEnChile } from '@/lib/utils/datetime'

vi.mock('@/lib/api/compliance', () => ({ complianceApi: { listPending: vi.fn(), uploadFile: vi.fn() } }))
import { complianceApi } from '@/lib/api/compliance'

const F30: PendingSummaryRow = { key: 'req-f30', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: null, overdue: 1, expiring: 4, missing: 21 }

function fila(over: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Cordillera SpA', carrier_tax_id: '76222222-1',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA', entity_type: 'CARRIER',
    entity_id: 'c1', subject_name: null, requirement_id: 'req-f30', requirement_code: 'F30_1', document_name: 'F30-1',
    status: 'APPROVED_MANUAL', expiration_date: null, tiene_archivo: true, urgencia: 'VENCIDO',
    document_state: 'OVERDUE', expiration_policy: 'CALENDAR_PERIOD', vence_el: '2026-09-18', ...over,
  } as PendingComplianceRow
}

function montar(props: Partial<Parameters<typeof PendingHoldersPanel>[0]> = {}, qc = nuevoQc()) {
  render(
    <QueryClientProvider client={qc}>
      <PendingHoldersPanel groupBy="requirement" selected={F30} state="overdue" onStateChange={vi.fn()} canUpload {...props} />
    </QueryClientProvider>,
  )
  return qc
}
/** Hoy en Chile ± n días, como lo cuenta la pantalla: con la fecha UTC, entre
 *  las 21:00 y medianoche de Chile ya es "mañana" y el test daba 11 días. */
function diasDesdeHoyEnChile(n: number): string {
  const d = new Date(`${hoyEnChile()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const nuevoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

/** Un documento que no pide dato: elegir el archivo lo sube de una. */
const SIN_DATO = { expiration_policy: 'NONE' as const }

beforeEach(() => vi.clearAllMocks())

describe('PendingHoldersPanel', () => {
  it('lista quién debe el documento, con su empresa y el estado en palabras', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    montar()
    expect(await screen.findByText('Transportes Cordillera SpA')).toBeInTheDocument()
    expect(screen.getByText('Venció el 18/09')).toBeInTheDocument()
    expect(screen.getByText('Subir')).toBeInTheDocument()
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'overdue', requirementCode: 'F30_1' }))
  })

  it('cada fila dice su estado y su acción (spec §5.2)', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 4, rows: [
      fila({ id: 'a', subject_name: 'Rojas Pérez, Andrés', due_on: '2026-09-29' }),
      fila({ id: 'b', subject_name: 'Díaz Lagos, Pedro', missing_validity_data: true }),
      fila({ id: 'c', subject_name: 'Soto Muñoz, Carla', document_state: 'EXPIRING', urgencia: 'POR_VENCER',
             due_on: diasDesdeHoyEnChile(10) }),
      fila({ id: 'd', subject_name: 'Vera Castro, Miguel', document_state: 'MISSING', urgencia: 'FALTA', tiene_archivo: false,
             entered_on: diasDesdeHoyEnChile(-10) }),
    ] })
    montar({ state: 'all' })
    const enFila = async (id: string) => within(await screen.findByTestId(`renglon-${id}`))
    expect((await enFila('a')).getByText('Venció el 29/09')).toBeInTheDocument()
    expect((await enFila('a')).getByText('Subir')).toBeInTheDocument()
    expect((await enFila('b')).getByText('Falta indicar el período')).toBeInTheDocument()
    expect((await enFila('b')).getByText('Completar')).toBeInTheDocument()
    expect((await enFila('c')).getByText(/^Vence en 10 días · \d\d\/\d\d$/)).toBeInTheDocument()
    expect((await enFila('c')).getByText('Subir la nueva')).toBeInTheDocument()
    expect((await enFila('b')).getByText('El archivo está cargado; sin la fecha no vale')).toBeInTheDocument()
    expect((await enFila('d')).getByText('Falta')).toBeInTheDocument()
    expect((await enFila('d')).getByText('Ingresó hace 10 días')).toBeInTheDocument()
    expect((await enFila('d')).getByText('Subir')).toBeInTheDocument()
    // Quien debe y de qué empresa.
    expect((await enFila('a')).getByText('Rojas Pérez, Andrés')).toBeInTheDocument()
    expect((await enFila('a')).getByText(/Transportes Cordillera SpA/)).toBeInTheDocument()
  })

  it('las columnas dicen qué es cada cosa: Empresa/Estado, o Conductor/Empresa/Estado', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    montar()
    await screen.findByText('Transportes Cordillera SpA')
    expect(screen.getByText('Empresa')).toBeInTheDocument()
    expect(screen.getByText('Estado', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('Conductor')).not.toBeInTheDocument()
  })

  it('para un documento de conductor, la columna Conductor va antes que Empresa', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [
      fila({ entity_type: 'DRIVER', category: 'CHOFER', subject_name: 'Rojas Pérez, Andrés' })] })
    montar({ selected: { ...F30, label: 'Licencia de Conducir', target_entity: 'DRIVER' } })
    await screen.findByText('Rojas Pérez, Andrés')
    const conductor = screen.getByText('Conductor'), empresa = screen.getByText('Empresa')
    expect(conductor.compareDocumentPosition(empresa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('el encabezado dice el período que se exige y cuándo vence, si la regla lo define', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    montar({ selected: { ...F30,
      vigencia: { frequency_months: 1, cutoff_day: 18, period_offset_months: 1, warning_days: 5 } as never } })
    expect(screen.getByText(/^Mensual · tope día 18 · período [a-z]+ · vence el 18\/\d\d$/)).toBeInTheDocument()
  })

  it('"Todos" pide los tres estados pendientes, nunca los documentos al día', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    montar({ state: 'all' })
    await screen.findByText('Transportes Cordillera SpA')
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'pending' }))
    expect(complianceApi.listPending).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'all' }))
  })

  it('los filtros llevan sus cifras y avisan el cambio', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    const onStateChange = vi.fn()
    montar({ onStateChange })
    const filtros = screen.getByRole('group', { name: 'Estado' })
    expect(within(filtros).getByRole('button', { name: /Vencidos\s*1/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(filtros).getByRole('button', { name: /Faltan\s*21/ }))
    expect(onStateChange).toHaveBeenCalledWith('missing')
  })

  it('con el filtro vacío dice qué hay en los otros y enlaza', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    const onStateChange = vi.fn()
    montar({ selected: { ...F30, overdue: 0 }, onStateChange })
    expect(await screen.findByText('No hay F30-1 vencidos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '4 por vencer' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '21 que faltan' }))
    expect(onStateChange).toHaveBeenCalledWith('missing')
  })

  it('si no se pudo cargar lo dice y ofrece reintentar', async () => {
    vi.mocked(complianceApi.listPending).mockRejectedValue(new Error('500'))
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar lo pendiente.')
    expect(screen.queryByText(/No hay F30-1/)).not.toBeInTheDocument()
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Transportes Cordillera SpA')).toBeInTheDocument()
  })

  it('mientras carga no muestra cifras ni filas', () => {
    vi.mocked(complianceApi.listPending).mockReturnValue(new Promise(() => {}))
    montar()
    expect(screen.getByRole('status', { name: 'Cargando lo pendiente' })).toBeInTheDocument()
    expect(screen.queryByTestId(/^renglon-/)).not.toBeInTheDocument()
  })

  it('sin permiso de subir no ofrece la zona de arrastre ni Subir en la fila', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    montar({ canUpload: false })
    await screen.findByText('Transportes Cordillera SpA')
    expect(screen.getByText('Venció el 18/09')).toBeInTheDocument()
    expect(screen.queryByText(/Arrastra varios/)).not.toBeInTheDocument()
    expect(screen.queryByText('Subir')).not.toBeInTheDocument()
    expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
  })

  it('con permiso de subir sí ofrece las dos (el caso de control)', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    montar({ canUpload: true })
    await screen.findByText('Transportes Cordillera SpA')
    expect(screen.getByText(/Arrastra varios F30-1/)).toBeInTheDocument()
    expect(screen.getByText('Subir')).toBeInTheDocument()
    expect(screen.getByTestId('archivo-p1')).toBeInTheDocument()
  })

  it('subir en la fila: la fila sale, se refresca todo lo de Certificación y avisa cuántos quedan', async () => {
    vi.mocked(complianceApi.listPending)
      .mockResolvedValueOnce({ total: 2, rows: [fila(SIN_DATO), fila({ ...SIN_DATO, id: 'p2', carrier_name: 'Transportes Andes Ltda' })] })
      .mockResolvedValue({ total: 1, rows: [fila({ ...SIN_DATO, id: 'p2', carrier_name: 'Transportes Andes Ltda' })] })
    vi.mocked(complianceApi.uploadFile).mockResolvedValue({ status: 'APPROVED_MANUAL' } as never)
    const qc = nuevoQc()
    // El resumen tal como vuelve del servidor después de guardar. 5, no 9−1:
    // así el aviso prueba que lee el resumen y no resta a mano.
    qc.setQueryData(clavesCertificacion.resumenPendientes('requirement'), { rows: [{ ...F30, overdue: 5 }] })
    const invalidar = vi.spyOn(qc, 'invalidateQueries')
    montar({ selected: { ...F30, overdue: 9 } }, qc)

    await screen.findByText('Transportes Cordillera SpA')
    fireEvent.change(screen.getByTestId('archivo-p1'), {
      target: { files: [new File(['x'], 'f30.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(complianceApi.uploadFile).toHaveBeenCalledWith('p1', expect.any(File), undefined))
    await waitFor(() => expect(screen.queryByTestId('renglon-p1')).not.toBeInTheDocument())
    expect(screen.getByTestId('renglon-p2')).toBeInTheDocument()
    for (const raiz of [['compliance-pending'], ['compliance-pending-summary'], ['compliance-summary'], ['entity-summary']]) {
      expect(invalidar).toHaveBeenCalledWith({ queryKey: raiz })
    }
    expect(screen.getByRole('status')).toHaveTextContent('F30-1 de Transportes Cordillera SpA guardado · quedan 5 vencidos')
    // Sólo informa: no ofrece un deshacer que no existe.
    expect(screen.queryByRole('button', { name: /deshacer/i })).not.toBeInTheDocument()
  })

  it('si una subida falla, el error queda en su fila y las demás siguen', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 2, rows: [
      fila(SIN_DATO), fila({ ...SIN_DATO, id: 'p2', carrier_name: 'Transportes Andes Ltda' }),
    ] })
    vi.mocked(complianceApi.uploadFile).mockRejectedValue(new Error('El archivo pesa más de 7 MB'))
    montar()
    await screen.findByText('Transportes Cordillera SpA')
    fireEvent.change(screen.getByTestId('archivo-p1'), {
      target: { files: [new File(['x'], 'f30.pdf', { type: 'application/pdf' })] } })

    const fallida = await screen.findByTestId('renglon-p1')
    expect(await within(fallida).findByRole('alert')).toHaveTextContent('El archivo pesa más de 7 MB')
    const otra = screen.getByTestId('renglon-p2')
    expect(within(otra).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(otra).getByText('Subir')).toBeInTheDocument()
    expect(screen.queryByText(/guardado/)).not.toBeInTheDocument()
  })

  it('por empresa agrupa en la empresa, los conductores y los equipos', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 3, rows: [
      fila({ id: 'e1', document_name: 'Licencia de Conducir', entity_type: 'DRIVER', category: 'CHOFER', subject_name: 'Rojas Pérez, Andrés' }),
      fila({ id: 'e2', document_name: 'Revisión Técnica', entity_type: 'ASSET', category: 'EQUIPO', subject_name: 'ABCD12' }),
      fila({ id: 'e3' }),
    ] })
    const empresa: PendingSummaryRow = { ...F30, key: 'c1', label: 'Transportes Cordillera SpA',
      requirement_code: null, target_entity: null, expiration_policy: null }
    montar({ groupBy: 'carrier', selected: empresa })

    const secciones = await screen.findAllByRole('heading', { level: 3 })
    expect(secciones.map(h => h.textContent)).toEqual(['La empresa', 'Conductores', 'Equipos'])
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ carrierId: 'c1', requirementCode: undefined }))
    expect(within(screen.getByRole('region', { name: 'Conductores' })).getByTestId('renglon-e1')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Equipos' })).getByTestId('renglon-e2')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'La empresa' })).getByTestId('renglon-e3')).toBeInTheDocument()
    // Por empresa no se ofrece el lote: el lote es de UN documento.
    expect(screen.queryByText(/Arrastra varios/)).not.toBeInTheDocument()
  })
})
