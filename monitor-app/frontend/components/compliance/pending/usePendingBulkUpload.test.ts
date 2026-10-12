import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PendingMatchFile, PendingSummaryRow } from '@/lib/types'

const subir = vi.fn()
vi.mock('@/hooks/useSubirDocumento', () => ({ useSubirDocumento: () => subir }))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: { matchPendingFiles: vi.fn() } }))
import { complianceApi } from '@/lib/api/compliance'
import { usePendingBulkUpload } from './usePendingBulkUpload'

const VIGENCIA = { validity_months: null, frequency_months: 1, cutoff_day: 18, period_offset_months: 1,
  warning_days: 10, grace_days: 0 }
const F30: PendingSummaryRow = { key: 'req', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: VIGENCIA, overdue: 2, expiring: 0, missing: 0 }
const LICENCIA: PendingSummaryRow = { ...F30, key: 'req-lic', label: 'Licencia', requirement_code: 'LIC',
  target_entity: 'DRIVER', expiration_policy: 'ISSUE_PLUS_MONTHS',
  vigencia: { ...VIGENCIA, validity_months: 12, frequency_months: null, cutoff_day: null, period_offset_months: null } }

const archivo = (n: string) => new File(['x'], n, { type: 'application/pdf' })
const asignado = (file_name: string, record_id: string): PendingMatchFile => ({
  file_name, status: 'matched', record_id, subject_label: record_id.toUpperCase(), carrier_name: record_id.toUpperCase(),
  reason: 'rut', confidence: 0.95, candidates: [] })
const sinAsignar = (file_name: string): PendingMatchFile => ({
  file_name, status: 'unmatched', record_id: null, subject_label: null, carrier_name: null, reason: null,
  confidence: null, candidates: [] })
const proponer = (...files: PendingMatchFile[]) =>
  vi.mocked(complianceApi.matchPendingFiles).mockResolvedValue({ files })

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

describe('usePendingBulkUpload', () => {
  it('pide la propuesta solo con los nombres y propone el período que hoy se exige', async () => {
    proponer(asignado('a.pdf', 'r1'))
    const { result } = renderHook(() => usePendingBulkUpload(F30))
    await act(() => result.current.receive([archivo('a.pdf')]))
    expect(complianceApi.matchPendingFiles).toHaveBeenCalledWith('req', ['a.pdf'])
    expect(result.current.items[0].recordId).toBe('r1')
    expect(result.current.rows[0].group).toBe('assigned')
    // Mensual con desfase de un mes: en octubre se exige septiembre.
    expect(result.current.batchPeriod).toBe('2026-09')
  })

  it('el período del lote respeta el desfase de la regla (no el "mes anterior" fijo)', async () => {
    proponer(asignado('a.pdf', 'r1'))
    const DOS = { ...F30, vigencia: { ...VIGENCIA, period_offset_months: 2 } }
    const { result } = renderHook(() => usePendingBulkUpload(DOS))
    await act(() => result.current.receive([archivo('a.pdf')]))
    expect(result.current.batchPeriod).toBe('2026-08')
  })

  it('dos archivos al mismo registro pasan los dos a Por elegir, venga del match o de una elección', async () => {
    proponer(asignado('a.pdf', 'r1'), asignado('b.pdf', 'r1'), sinAsignar('c.pdf'))
    const { result } = renderHook(() => usePendingBulkUpload(F30))
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
    const { result } = renderHook(() => usePendingBulkUpload(F30))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('cordillera spa.pdf')]))
    expect(result.current.rows.map(r => r.group)).toEqual(['assigned', 'choose'])
    expect(result.current.rows.map(r => r.collision)).toEqual([null, 'outranked'])
    expect(result.current.rows[1].collisionLabel).toBe('R1')
    expect(result.current.ready).toBe(1)
  })

  it('el archivo que el servidor bajó por un choque dice a quién va el otro', async () => {
    proponer(asignado('a.pdf', 'r1'), { ...sinAsignar('b.pdf'), status: 'ambiguous', collision: 'outranked',
      collision_subject_label: 'R1' })
    const { result } = renderHook(() => usePendingBulkUpload(F30))
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
    const { result } = renderHook(() => usePendingBulkUpload(F30))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf')]))
    act(() => result.current.remove(1))
    expect(result.current.items.map(i => i.file.name)).toEqual(['a.pdf'])
  })

  it('guarda solo los listos, cada uno a su registro, con el período del lote', async () => {
    proponer(asignado('a.pdf', 'r1'), sinAsignar('b.pdf'))
    subir.mockResolvedValue(undefined)
    const { result } = renderHook(() => usePendingBulkUpload(F30))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf')]))
    act(() => result.current.setBatchPeriod('2026-07'))
    await act(() => result.current.save())
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), { period_start: '2026-07-01' })
    expect(result.current.items.map(i => i.status)).toEqual(['saved', 'pending'])
    expect(result.current.result).toEqual({ saved: 1, errors: 0, unresolved: 1 })
  })

  it('con fecha por fila, una fila sin su fecha no está lista; con ella, viaja su fecha', async () => {
    proponer(asignado('rojas.pdf', 'r1'), asignado('soto.pdf', 'r2'))
    subir.mockResolvedValue(undefined)
    const { result } = renderHook(() => usePendingBulkUpload(LICENCIA))
    await act(() => result.current.receive([archivo('rojas.pdf'), archivo('soto.pdf')]))
    expect(result.current.needs).toBe('emision')
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
    const { result } = renderHook(() => usePendingBulkUpload(F30))
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
    const { result } = renderHook(() => usePendingBulkUpload(F30))
    await act(() => result.current.receive([archivo('a.pdf'), archivo('c.pdf')]))
    await act(() => result.current.save())
    expect(result.current.items.map(i => i.status)).toEqual(['error', 'saved'])
    expect(result.current.items[0].error).toBe('El archivo pesa más de 7 MB')
    expect(result.current.result).toEqual({ saved: 1, errors: 1, unresolved: 0 })
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
    const { result } = renderHook(() => usePendingBulkUpload(F30))
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
