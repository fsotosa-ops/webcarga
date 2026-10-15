import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn().mockResolvedValue({}), apiFetchBlob: vi.fn() }))
import { apiFetch } from '@/lib/api/client'
import { complianceApi } from './compliance'
import { clavesCertificacion, RAICES_DE_CERTIFICACION } from '@/lib/queries/certificacion'

beforeEach(() => { vi.mocked(apiFetch).mockClear() })

describe('Pendientes en el cliente de API', () => {
  it('listPending manda state y el documento', async () => {
    await complianceApi.listPending({ state: 'overdue', requirementCode: 'F30_1', limit: 200 })
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/compliance-records/pending?requirement_code=F30_1&state=overdue&limit=200')
  })

  it('pendingSummary pide el resumen agrupado', async () => {
    await complianceApi.pendingSummary('carrier')
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/compliance-records/pending/summary?group_by=carrier')
  })

  it('matchUploadFiles manda los nombres y solo el contexto que haya', async () => {
    await complianceApi.matchUploadFiles(['a.pdf'], { requirementId: 'req-1' })
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/compliance-records/pending/match', {
      method: 'POST', body: JSON.stringify({ file_names: ['a.pdf'], requirement_id: 'req-1' }),
    })
    await complianceApi.matchUploadFiles(['a.pdf'])
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/compliance-records/pending/match', {
      method: 'POST', body: JSON.stringify({ file_names: ['a.pdf'] }),
    })
  })
})

describe('Claves de datos de Pendientes', () => {
  it('la cola cuelga de la raíz de pendientes y el resumen tiene raíz propia invalidable', () => {
    expect(clavesCertificacion.colaPendientes('overdue', 'F30_1', 'c1').slice(0, 1)).toEqual(['compliance-pending'])
    expect(clavesCertificacion.resumenPendientes('carrier')).toEqual(['compliance-pending-summary', 'carrier'])
    expect(RAICES_DE_CERTIFICACION).toContainEqual(['compliance-pending-summary'])
    expect(RAICES_DE_CERTIFICACION).toContainEqual(['entity-summary'])
  })
})
