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

describe('documentIngestApi.upload', () => {
  it('sin empresa pega a la puerta global', async () => {
    await documentIngestApi.upload(undefined, [new File(['x'], 'doc1.pdf')])
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/v1/document-ingest/files')
  })

  it('con empresa pega a la puerta de esa empresa', async () => {
    await documentIngestApi.upload('c1', [new File(['x'], 'doc1.pdf')])
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/v1/document-ingest/c1/files')
  })
})

describe('documentIngestApi.undoClassify', () => {
  it('manda los ids del lote que se acaba de aplicar', async () => {
    await documentIngestApi.undoClassify(['a', 'b'])
    const [url, init] = vi.mocked(apiFetch).mock.calls[0]
    expect(url).toBe('/api/v1/document-ingest/items/undo-classify')
    expect(JSON.parse(init!.body as string)).toEqual({ item_ids: ['a', 'b'] })
  })
})
