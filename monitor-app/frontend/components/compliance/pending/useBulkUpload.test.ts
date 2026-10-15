import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PendingMatchFile, PendingSummaryRow } from '@/lib/types'

const subir = vi.fn()
vi.mock('@/hooks/useSubirDocumento', () => ({ useSubirDocumento: () => subir }))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: { matchUploadFiles: vi.fn() } }))
vi.mock('@/lib/api/documentIngest', () => ({ documentIngestApi: { upload: vi.fn().mockResolvedValue({ items: [], errors: [], duplicates: [] }) } }))
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useBulkUpload } from './useBulkUpload'

const VIGENCIA = { validity_months: null, frequency_months: 1, cutoff_day: 18, period_offset_months: 1,
  warning_days: 10, grace_days: 0 }
const F30: PendingSummaryRow = { key: 'req', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: VIGENCIA, overdue: 2, expiring: 0, missing: 0 }
const LICENCIA: PendingSummaryRow = { ...F30, key: 'req-lic', label: 'Licencia', requirement_code: 'LIC',
  target_entity: 'DRIVER', expiration_policy: 'ISSUE_PLUS_MONTHS',
  vigencia: { ...VIGENCIA, validity_months: 12, frequency_months: null, cutoff_day: null, period_offset_months: null } }

const archivo = (n: string) => new File(['x'], n, { type: 'application/pdf' })
const asignado = (file_name: string, record_id: string): PendingMatchFile => ({
  file_name, status: 'matched', record_id, requirement_id: 'req', subject_label: record_id.toUpperCase(), carrier_name: record_id.toUpperCase(),
  reason: 'rut', confidence: 0.95, candidates: [] })
const sinAsignar = (file_name: string): PendingMatchFile => ({
  file_name, status: 'unmatched', record_id: null, requirement_id: null, subject_label: null, carrier_name: null, reason: null,
  confidence: null, candidates: [] })
const proponer = (...files: PendingMatchFile[]) =>
  vi.mocked(complianceApi.matchUploadFiles).mockResolvedValue({ files, requirements: {} })

/** Una subida que termina cuando el test dice. */
function diferida() {
  let resolver!: () => void
  const promesa = new Promise<void>(r => { resolver = r })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-11T15:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('useBulkUpload (con el tipo fijado: Pendientes)', () => {
  it('pide la propuesta solo con los nombres y propone el período que hoy se exige', async () => {
    proponer(asignado('a.pdf', 'r1'))
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf')]))
    expect(complianceApi.matchUploadFiles).toHaveBeenCalledWith(['a.pdf'], { requirementId: 'req', carrierId: undefined })
    expect(result.current.items[0].recordId).toBe('r1')
    expect(result.current.rows[0].group).toBe('assigned')
    // Mensual con desfase de un mes: en octubre se exige septiembre.
    expect(result.current.periods.req).toBe('2026-09')
  })

  it('el período del lote respeta el desfase de la regla (no el "mes anterior" fijo)', async () => {
    proponer(asignado('a.pdf', 'r1'))
    const DOS = { ...F30, vigencia: { ...VIGENCIA, period_offset_months: 2 } }
    const { result } = renderHook(() => useBulkUpload({ requirement: DOS }))
    await act(() => result.current.receive([archivo('a.pdf')]))
    expect(result.current.periods.req).toBe('2026-08')
  })

  it('dos archivos al mismo registro pasan los dos a Por elegir, venga del match o de una elección', async () => {
    proponer(asignado('a.pdf', 'r1'), asignado('b.pdf', 'r1'), sinAsignar('c.pdf'))
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf'), archivo('c.pdf')]))
    expect(result.current.rows.map(r => r.group)).toEqual(['choose', 'choose', 'unassigned'])
    expect(result.current.rows[0].collision).toBe('tie')
    expect(result.current.ready).toBe(0)

    // Cambiar uno deshace el choque: los dos vuelven a Asignados.
    act(() => result.current.choose(1, 'r2', { label: 'R2', carrier: 'R2' }))
    expect(result.current.rows.map(r => r.group)).toEqual(['assigned', 'assigned', 'unassigned'])
    expect(result.current.ready).toBe(2)

    // Una elección a mano que choca con otro también los manda a Por elegir.
    act(() => result.current.choose(2, 'r1', { label: 'R1', carrier: 'R1' }))
    expect(result.current.rows.map(r => r.group)).toEqual(['choose', 'assigned', 'choose'])
    expect(result.current.ready).toBe(1)
  })

  it('en un choque, el de RUT queda asignado y solo baja el de nombre (misma regla que el servidor)', async () => {
    const porNombre: PendingMatchFile = { ...asignado('cordillera spa.pdf', 'r1'), reason: 'name', confidence: 0.72 }
    proponer(asignado('a.pdf', 'r1'), porNombre)
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('cordillera spa.pdf')]))
    expect(result.current.rows.map(r => r.group)).toEqual(['assigned', 'choose'])
    expect(result.current.rows.map(r => r.collision)).toEqual([null, 'outranked'])
    expect(result.current.rows[1].collisionLabel).toBe('R1')
    expect(result.current.ready).toBe(1)
  })

  it('el archivo que el servidor bajó por un choque dice a quién va el otro', async () => {
    proponer(asignado('a.pdf', 'r1'), { ...sinAsignar('b.pdf'), status: 'ambiguous', collision: 'outranked',
      collision_subject_label: 'R1' })
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf')]))
    expect(result.current.rows.map(r => r.group)).toEqual(['assigned', 'choose'])
    expect(result.current.rows[1]).toMatchObject({ collision: 'outranked', collisionLabel: 'R1' })
    // Elegir a quién va lo saca del choque.
    act(() => result.current.choose(1, 'r2', { label: 'R2', carrier: 'R2' }))
    expect(result.current.rows[1]).toMatchObject({ group: 'assigned', collision: null })
  })

  it('quitar un archivo lo saca del lote y no se sube', async () => {
    proponer(asignado('a.pdf', 'r1'), sinAsignar('b.pdf'))
    subir.mockResolvedValue(undefined)
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf')]))
    act(() => result.current.remove(1))
    expect(result.current.items.map(i => i.file.name)).toEqual(['a.pdf'])
  })

  it('guarda los listos en su registro y lo que no se resolvió va a Por asignar con su tipo (D5)', async () => {
    proponer(asignado('a.pdf', 'r1'), sinAsignar('b.pdf'))
    subir.mockResolvedValue(undefined)
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf')]))
    act(() => result.current.setPeriod('req', '2026-07'))
    expect(result.current.toStage).toBe(1)
    await act(() => result.current.save())
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), { period_start: '2026-07-01' })
    expect(documentIngestApi.upload).toHaveBeenCalledWith(undefined, [expect.any(File)], { code: 'F30_1', target: 'CARRIER' })
    expect(result.current.items.map(i => i.status)).toEqual(['saved', 'staged'])
    expect(result.current.result).toEqual({ saved: 1, staged: 1, errors: 0, unresolved: 0 })
  })

  it('con fecha por fila, una fila sin su fecha no está lista; con ella, viaja su fecha', async () => {
    proponer(asignado('rojas.pdf', 'r1'), asignado('soto.pdf', 'r2'))
    subir.mockResolvedValue(undefined)
    const { result } = renderHook(() => useBulkUpload({ requirement: LICENCIA }))
    await act(() => result.current.receive([archivo('rojas.pdf'), archivo('soto.pdf')]))
    expect(result.current.ready).toBe(0)
    act(() => result.current.setRowDate(0, '2026-05-21'))
    expect(result.current.rows.map(r => r.ready)).toEqual([true, false])
    await act(() => result.current.save())
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), { issue_date: '2026-05-21' })
  })

  it('sube de a tres a la vez y cuenta el avance', async () => {
    proponer(...['a', 'b', 'c', 'd', 'e'].map(n => asignado(`${n}.pdf`, `r-${n}`)))
    const subidas = new Map<string, ReturnType<typeof diferida>>()
    subir.mockImplementation((id: string) => { const d = diferida(); subidas.set(id, d); return d.promesa })
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive(['a', 'b', 'c', 'd', 'e'].map(n => archivo(`${n}.pdf`))))

    let guardando!: Promise<void>
    act(() => { guardando = result.current.save() })
    await waitFor(() => expect(subir).toHaveBeenCalledTimes(3))
    expect(result.current.saving).toBe(true)
    expect(result.current.progress).toEqual({ done: 0, total: 5 })

    await act(async () => { subidas.get('r-a')!.resolver() })
    await waitFor(() => expect(subir).toHaveBeenCalledTimes(4))
    expect(result.current.progress).toEqual({ done: 1, total: 5 })

    await act(async () => { for (const d of subidas.values()) d.resolver() })
    await waitFor(() => expect(subir).toHaveBeenCalledTimes(5))
    await act(async () => { for (const d of subidas.values()) d.resolver(); await guardando })
    expect(result.current.saving).toBe(false)
    expect(result.current.items.every(i => i.status === 'saved')).toBe(true)
  })

  it('una fila que falla conserva su motivo, las demás siguen, y reintentar no repite lo guardado', async () => {
    proponer(asignado('a.pdf', 'r1'), asignado('c.pdf', 'r3'))
    subir.mockImplementation(async (id: string) => { if (id === 'r1') throw new Error('El archivo pesa más de 7 MB') })
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('c.pdf')]))
    await act(() => result.current.save())
    expect(result.current.items.map(i => i.status)).toEqual(['error', 'saved'])
    expect(result.current.items[0].error).toBe('El archivo pesa más de 7 MB')
    expect(result.current.result).toEqual({ saved: 1, staged: 0, errors: 1, unresolved: 0 })
    expect(result.current.ready).toBe(1)

    subir.mockReset(); subir.mockResolvedValue(undefined)
    await act(() => result.current.save())
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), expect.anything())
    expect(result.current.items.map(i => i.status)).toEqual(['saved', 'saved'])
  })

  it('avisa antes de cerrar la pestaña solo mientras guarda', async () => {
    proponer(asignado('a.pdf', 'r1'))
    const d = diferida()
    subir.mockReturnValue(d.promesa)
    const add = vi.spyOn(window, 'addEventListener')
    const rem = vi.spyOn(window, 'removeEventListener')
    const { result } = renderHook(() => useBulkUpload({ requirement: F30 }))
    await act(() => result.current.receive([archivo('a.pdf')]))
    expect(add.mock.calls.some(([t]) => t === 'beforeunload')).toBe(false)

    let guardando!: Promise<void>
    act(() => { guardando = result.current.save() })
    await waitFor(() => expect(subir).toHaveBeenCalled())
    const llamada = add.mock.calls.find(([t]) => t === 'beforeunload')
    expect(llamada).toBeDefined()
    const evento = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(evento)
    expect(evento.defaultPrevented).toBe(true)
    expect(rem.mock.calls.some(([t]) => t === 'beforeunload')).toBe(false)

    await act(async () => { d.resolver(); await guardando })
    expect(rem).toHaveBeenCalledWith('beforeunload', llamada![1])
    const despues = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(despues)
    expect(despues.defaultPrevented).toBe(false)
    add.mockRestore(); rem.mockRestore()
  })
})

describe('useBulkUpload sin contexto (Por asignar) y con empresa (su ficha) — D4', () => {
  const REQS = {
    'req-f30': { label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER' as const,
                 expiration_policy: 'CALENDAR_PERIOD' as const, vigencia: VIGENCIA },
    'req-lic': { label: 'Licencia', requirement_code: 'LIC', target_entity: 'DRIVER' as const,
                 expiration_policy: 'ISSUE_PLUS_MONTHS' as const,
                 vigencia: { ...VIGENCIA, validity_months: 12, frequency_months: null, cutoff_day: null, period_offset_months: null } },
  }

  it('cada fila trae su tipo y su regla; el período es por tipo; la empresa viaja como contexto', async () => {
    vi.mocked(complianceApi.matchUploadFiles).mockResolvedValue({
      requirements: REQS,
      files: [
        { ...asignado('f30.pdf', 'r1'), requirement_id: 'req-f30' },
        { ...sinAsignar('lic.pdf'), status: 'ambiguous', candidates: [
          { record_id: 'r7', requirement_id: 'req-lic', subject_label: 'Rojas', carrier_name: 'Sur', confidence: 0.9 },
          { record_id: 'r8', requirement_id: 'req-lic', subject_label: 'Soto', carrier_name: 'Sur', confidence: 0.88 },
        ] },
      ],
    })
    subir.mockResolvedValue(undefined)
    const { result } = renderHook(() => useBulkUpload({ carrierId: 'c-sur' }))
    await act(() => result.current.receive([archivo('f30.pdf'), archivo('lic.pdf')]))
    expect(complianceApi.matchUploadFiles).toHaveBeenCalledWith(['f30.pdf', 'lic.pdf'], { requirementId: undefined, carrierId: 'c-sur' })
    expect(result.current.rows.map(r => r.rule?.label ?? null)).toEqual(['F30-1', null])
    expect(result.current.periodTypes).toEqual(['req-f30'])
    expect(result.current.periods['req-f30']).toBe('2026-09')

    // Elegir un candidato trae su tipo: la fila pasa a pedir su fecha de emisión.
    act(() => result.current.choose(1, 'r7', { label: 'Rojas', carrier: 'Sur', requirementId: 'req-lic' }))
    expect(result.current.rows[1]).toMatchObject({ group: 'assigned', ready: false })
    expect(result.current.rows[1].rule?.label).toBe('Licencia')
    act(() => result.current.setRowDate(1, '2026-05-21'))
    await act(() => result.current.save())
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), { period_start: '2026-09-01' })
    expect(subir).toHaveBeenCalledWith('r7', expect.any(File), { issue_date: '2026-05-21' })
  })
})

describe('useBulkUpload — lo que va a Por asignar', () => {
  it('va en lotes de 50, encadenados: el backend no acepta más por subida', async () => {
    const nombres = Array.from({ length: 120 }, (_, i) => `f${i}.pdf`)
    vi.mocked(complianceApi.matchUploadFiles).mockResolvedValue({ requirements: {}, files: nombres.map(sinAsignar) })
    const { result } = renderHook(() => useBulkUpload({}))
    await act(() => result.current.receive(nombres.map(archivo)))
    await act(() => result.current.save())
    expect(vi.mocked(documentIngestApi.upload).mock.calls.map(c => c[1].length)).toEqual([50, 50, 20])
    expect(result.current.result?.staged).toBe(120)
  })

  it('un archivo que la bandeja no aceptó queda con su motivo, no como "En Por asignar"', async () => {
    vi.mocked(complianceApi.matchUploadFiles).mockResolvedValue({ requirements: {}, files: [sinAsignar('a.pdf'), sinAsignar('b.pdf')] })
    vi.mocked(documentIngestApi.upload).mockResolvedValueOnce({
      batch_id: 'b', items: [], errors: [{ file_name: 'b.pdf', error: 'Tipo de archivo no permitido' }], duplicates: [],
    })
    const { result } = renderHook(() => useBulkUpload({}))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf')]))
    await act(() => result.current.save())
    expect(result.current.items.map(i => i.status)).toEqual(['staged', 'error'])
    expect(result.current.items[1].error).toBe('Tipo de archivo no permitido')
    expect(result.current.result?.staged).toBe(1)
  })
})
