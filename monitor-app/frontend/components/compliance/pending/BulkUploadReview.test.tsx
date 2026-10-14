import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PendingComplianceRow, PendingMatchFile, PendingSummaryRow } from '@/lib/types'

const subir = vi.fn()
vi.mock('@/hooks/useSubirDocumento', () => ({ useSubirDocumento: () => subir }))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: { matchPendingFiles: vi.fn(), listPending: vi.fn() } }))
import { complianceApi } from '@/lib/api/compliance'
import { BulkUploadReview } from './BulkUploadReview'

const VIGENCIA = { validity_months: null, frequency_months: 1, cutoff_day: 18, period_offset_months: 1,
  warning_days: 10, grace_days: 0 }
const F30: PendingSummaryRow = { key: 'req', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: VIGENCIA, overdue: 2, expiring: 0, missing: 0 }
const LICENCIA: PendingSummaryRow = { ...F30, key: 'req-lic', label: 'Licencia', requirement_code: 'LIC',
  target_entity: 'DRIVER', expiration_policy: 'ISSUE_PLUS_MONTHS',
  vigencia: { ...VIGENCIA, validity_months: 12, frequency_months: null, cutoff_day: null, period_offset_months: null } }

const m = (over: Partial<PendingMatchFile> & { file_name: string }): PendingMatchFile => ({
  status: 'unmatched', record_id: null, subject_label: null, carrier_name: null, reason: null,
  confidence: null, candidates: [], ...over })
const ANDES = m({ file_name: 'andes.pdf', status: 'ambiguous', candidates: [
  { record_id: 'r2', subject_label: 'Transportes Andes Ltda', carrier_name: 'Transportes Andes Ltda', confidence: 0.82 },
  { record_id: 'r3', subject_label: 'Andes Cargo SpA', carrier_name: 'Andes Cargo SpA', confidence: 0.81 }] })
const SCAN = m({ file_name: 'scan_0042.pdf' })
const CORDILLERA = m({ file_name: 'cordillera.pdf', status: 'matched', record_id: 'r1',
  subject_label: 'Transportes Cordillera SpA', carrier_name: 'Transportes Cordillera SpA', reason: 'rut', confidence: 1 })
const NORTE = m({ file_name: 'norte.pdf', status: 'matched', record_id: 'r4',
  subject_label: 'Logística Norte SpA', carrier_name: 'Logística Norte SpA', reason: 'name', confidence: 0.94 })
const PATENTE = m({ file_name: 'ABCD12.pdf', status: 'matched', record_id: 'r5',
  subject_label: 'ABCD12', carrier_name: 'Fletes Sur SpA', reason: 'plate', confidence: 1 })

/** Quienes deben el documento: el universo del buscador. */
const debe = (id: string, carrier_name: string, subject_name: string | null = null) =>
  ({ id, carrier_name, subject_name }) as PendingComplianceRow
const DEUDORES = [debe('r1', 'Transportes Cordillera SpA'), debe('r2', 'Transportes Andes Ltda'),
  debe('r3', 'Andes Cargo SpA'), debe('r4', 'Logística Norte SpA'), debe('r6', 'Fletes del Pacífico SpA')]

const archivo = (n: string) => new File(['x'], n, { type: 'application/pdf' })

async function montar(requirement: PendingSummaryRow, files: PendingMatchFile[]) {
  vi.mocked(complianceApi.matchPendingFiles).mockResolvedValue({ files })
  vi.mocked(complianceApi.listPending).mockResolvedValue({ total: DEUDORES.length, rows: DEUDORES })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><BulkUploadReview requirement={requirement} /></QueryClientProvider>)
  fireEvent.change(screen.getByLabelText(`Elegir varios ${requirement.label}`),
    { target: { files: files.map(f => archivo(f.file_name)) } })
  await screen.findByRole('region', { name: 'Carga en lote' })
}
const grupo = (nombre: RegExp) => {
  const h = screen.getByRole('heading', { level: 3, name: nombre })
  return within(h.closest('[data-group]') as HTMLElement)
}
const guardar = () => screen.getByRole('button', { name: /^Guardar/ })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-11T15:00:00Z'))
  subir.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('BulkUploadReview', () => {
  it('antes de soltar, invita a arrastrar sin hablar en primera persona; al elegir, solo manda los nombres', async () => {
    const qc = new QueryClient()
    const { unmount } = render(<QueryClientProvider client={qc}><BulkUploadReview requirement={F30} /></QueryClientProvider>)
    expect(screen.getByText('Arrastra varios F30-1 aquí para ver a quién corresponde cada uno antes de guardar.')).toBeInTheDocument()
    unmount()
    await montar(F30, [CORDILLERA])
    expect(complianceApi.matchPendingFiles).toHaveBeenCalledWith('req', ['cordillera.pdf'])
    expect(subir).not.toHaveBeenCalled()
  })

  it('pone primero lo que hay que elegir y dice por qué se asignó lo demás', async () => {
    await montar(F30, [CORDILLERA, NORTE, PATENTE, SCAN, ANDES])
    const grupos = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(grupos[0]).toMatch(/^Por elegir/)
    expect(grupos[1]).toMatch(/^Sin asignar/)
    expect(grupos[2]).toMatch(/^Asignados/)
    expect(grupo(/^Por elegir/).getByText('andes.pdf')).toBeInTheDocument()
    expect(grupo(/^Sin asignar/).getByText('scan_0042.pdf')).toBeInTheDocument()
    const asignados = grupo(/^Asignados/)
    expect(asignados.getByText('por RUT')).toBeInTheDocument()
    expect(asignados.getByText('por nombre · 94 %')).toBeInTheDocument()
    expect(asignados.getByText('por patente')).toBeInTheDocument()
    expect(screen.getByText('5 archivos de F30-1')).toBeInTheDocument()
    expect(screen.getByText('3 asignados')).toBeInTheDocument()
    expect(screen.getByText('1 por elegir')).toBeInTheDocument()
    expect(screen.getByText('1 sin asignar')).toBeInTheDocument()
    expect(guardar()).toHaveTextContent('Guardar los 3 listos')
  })

  it('Elegir entre candidatos lo asigna y lo deja listo', async () => {
    await montar(F30, [ANDES])
    expect(guardar()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('A quién va andes.pdf'), { target: { value: 'r2' } })
    expect(grupo(/^Asignados/).getByText('Transportes Andes Ltda')).toBeInTheDocument()
    expect(guardar()).toHaveTextContent('Guardar 1 listo')
    fireEvent.click(guardar())
    await waitFor(() => expect(subir).toHaveBeenCalledWith('r2', expect.any(File), { period_start: '2026-09-01' }))
  })

  it('Cambiar abre el buscador entre quienes deben el documento', async () => {
    await montar(F30, [CORDILLERA])
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a quién va cordillera.pdf' }))
    const buscar = await screen.findByLabelText('Buscar a quién va cordillera.pdf')
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'pending', requirementCode: 'F30_1' }))
    fireEvent.change(buscar, { target: { value: 'pacifico' } })
    expect(screen.queryByRole('button', { name: /Andes Cargo/ })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Fletes del Pacífico SpA/ }))
    expect(grupo(/^Asignados/).getByText('Fletes del Pacífico SpA')).toBeInTheDocument()
    expect(screen.queryByText('por RUT')).not.toBeInTheDocument()
    fireEvent.click(guardar())
    await waitFor(() => expect(subir).toHaveBeenCalledWith('r6', expect.any(File), expect.anything()))
  })

  it('Sin asignar se resuelve buscando a mano', async () => {
    await montar(F30, [SCAN])
    fireEvent.click(screen.getByRole('button', { name: 'Elegir a quién va scan_0042.pdf' }))
    fireEvent.change(await screen.findByLabelText('Buscar a quién va scan_0042.pdf'), { target: { value: 'norte' } })
    fireEvent.click(await screen.findByRole('button', { name: /Logística Norte SpA/ }))
    expect(screen.queryByRole('heading', { level: 3, name: /^Sin asignar/ })).not.toBeInTheDocument()
    expect(grupo(/^Asignados/).getByText('scan_0042.pdf')).toBeInTheDocument()
    expect(guardar()).toHaveTextContent('Guardar 1 listo')
  })

  it('Sin asignar se puede quitar: no se sube y se ofrece enviarlo a Sin clasificar', async () => {
    await montar(F30, [SCAN, CORDILLERA])
    expect(grupo(/^Sin asignar/).getByRole('button', { name: 'Enviar scan_0042.pdf a Sin clasificar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar scan_0042.pdf' }))
    expect(screen.queryByText('scan_0042.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('1 archivo de F30-1')).toBeInTheDocument()
    fireEvent.click(guardar())
    await waitFor(() => expect(subir).toHaveBeenCalledTimes(1))
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), expect.anything())
  })

  it('dos archivos al mismo registro quedan los dos en Por elegir y no se guardan', async () => {
    await montar(F30, [CORDILLERA, m({ ...CORDILLERA, file_name: 'cordillera-2.pdf' })])
    const porElegir = grupo(/^Por elegir/)
    expect(porElegir.getByText('cordillera.pdf')).toBeInTheDocument()
    expect(porElegir.getByText('cordillera-2.pdf')).toBeInTheDocument()
    expect(porElegir.getAllByText(/otro archivo del lote va al mismo/)).toHaveLength(2)
    expect(guardar()).toBeDisabled()
  })

  it('en un choque RUT contra nombre, el de RUT queda y el otro ofrece elegir entre todos los que lo deben', async () => {
    const porNombre = m({ file_name: 'cordillera spa.pdf', status: 'ambiguous', collision: 'outranked',
      collision_subject_label: 'Transportes Cordillera SpA', candidates: [
        { record_id: 'r1', subject_label: 'Transportes Cordillera SpA', carrier_name: 'Transportes Cordillera SpA', confidence: 0.72 }] })
    await montar(F30, [CORDILLERA, porNombre])
    expect(grupo(/^Asignados/).getByText('cordillera.pdf')).toBeInTheDocument()
    const porElegir = grupo(/^Por elegir/)
    expect(porElegir.getByText('Otro archivo ya va a Transportes Cordillera SpA')).toBeInTheDocument()
    expect(screen.queryByText(/hay más de una empresa posible/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('A quién va cordillera spa.pdf')).not.toBeInTheDocument()
    expect(guardar()).toHaveTextContent('Guardar 1 listo')
    fireEvent.click(porElegir.getByRole('button', { name: 'Elegir a quién va cordillera spa.pdf' }))
    await screen.findByLabelText('Buscar a quién va cordillera spa.pdf')
    expect(await screen.findByRole('button', { name: /Fletes del Pacífico SpA/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Logística Norte SpA/ })).toBeInTheDocument()
  })

  it('el período del lote se propone y se puede cambiar; viaja con cada archivo', async () => {
    await montar(F30, [CORDILLERA])
    const periodo = screen.getByLabelText('Período para todo el lote') as HTMLInputElement
    expect(periodo.value).toBe('2026-09')
    fireEvent.change(periodo, { target: { value: '2026-07' } })
    fireEvent.click(guardar())
    await waitFor(() => expect(subir).toHaveBeenCalledWith('r1', expect.any(File), { period_start: '2026-07-01' }))
  })

  it('con fecha por fila, solo está listo lo que tiene su fecha', async () => {
    await montar(LICENCIA, [
      m({ ...CORDILLERA, file_name: 'rojas.pdf', record_id: 'r1' }),
      m({ ...CORDILLERA, file_name: 'soto.pdf', record_id: 'r2' }),
    ])
    expect(screen.queryByLabelText('Período para todo el lote')).not.toBeInTheDocument()
    expect(guardar()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Emitido el · rojas.pdf'), { target: { value: '2026-05-21' } })
    expect(guardar()).toHaveTextContent('Guardar 1 listo')
    fireEvent.change(screen.getByLabelText('Emitido el · soto.pdf'), { target: { value: '2026-06-02' } })
    expect(guardar()).toHaveTextContent('Guardar los 2 listos')
  })

  it('un error queda en su fila, lo demás se guarda, y reintentar no repite lo guardado', async () => {
    await montar(F30, [CORDILLERA, NORTE, SCAN])
    subir.mockImplementation(async (id: string) => { if (id === 'r4') throw new Error('El archivo pesa más de 7 MB') })
    fireEvent.click(guardar())
    expect(await screen.findByText('No se guardó: El archivo pesa más de 7 MB')).toBeInTheDocument()
    expect(screen.getByText('1 guardado')).toBeInTheDocument()
    expect(screen.getByText('1 con error')).toBeInTheDocument()
    expect(screen.getByText('1 por resolver')).toBeInTheDocument()
    expect(screen.getAllByText('Guardado')).toHaveLength(1)
    // El archivo y su motivo siguen en la fila; se reintenta con el mismo botón.
    expect(screen.getByText('norte.pdf')).toBeInTheDocument()
    subir.mockReset(); subir.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar 1 listo' }))
    await waitFor(() => expect(screen.getByText('2 guardados')).toBeInTheDocument())
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir).toHaveBeenCalledWith('r4', expect.any(File), expect.anything())
  })

  it('mientras guarda dice cuántos lleva', async () => {
    await montar(F30, [CORDILLERA, NORTE])
    let terminar!: () => void
    subir.mockImplementationOnce(() => Promise.resolve())
    subir.mockImplementationOnce(() => new Promise<void>(r => { terminar = r }))
    fireEvent.click(guardar())
    expect(await screen.findByText('Guardando 1 de 2…')).toBeInTheDocument()
    terminar()
    expect(await screen.findByText('2 guardados')).toBeInTheDocument()
  })
})
