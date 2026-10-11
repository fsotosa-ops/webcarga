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

  it('matchPendingFiles manda solo los nombres', async () => {
    await complianceApi.matchPendingFiles('req-1', ['a.pdf'])
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/compliance-records/pending/match', {
      method: 'POST', body: JSON.stringify({ requirement_id: 'req-1', file_names: ['a.pdf'] }),
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
