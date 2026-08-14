import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from './client'
import { documentIngestApi } from './documentIngest'

beforeEach(() => {
  vi.mocked(apiFetch).mockReset().mockResolvedValue({ total: 0, rows: [] } as never)
})

describe('documentIngestApi.listQueue', () => {
  it('arma el query string solo con lo que viene', async () => {
    await documentIngestApi.listQueue({ carrierId: 'c1', limit: 50 })
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/document-ingest/items?carrier_id=c1&limit=50')
  })

  it('sin parámetros pide la cola completa', async () => {
    await documentIngestApi.listQueue()
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/document-ingest/items')
  })

  it('manda offset 0 explícito, que no es lo mismo que omitirlo', async () => {
    await documentIngestApi.listQueue({ offset: 0 })
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/document-ingest/items?offset=0')
  })
})

describe('documentIngestApi.previewUrl', () => {
  it('firma un solo archivo', async () => {
    await documentIngestApi.previewUrl('i1')
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/document-ingest/items/i1/preview-url')
  })
})
