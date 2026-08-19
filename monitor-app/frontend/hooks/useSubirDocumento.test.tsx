import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { useSubirDocumento } from './useSubirDocumento'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { uploadFile: vi.fn().mockResolvedValue({ status: 'APPROVED_MANUAL' }) },
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { uploadAndClassify: vi.fn() },
}))

function envoltorio(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const archivo = () => new File(['x'], 'licencia.pdf', { type: 'application/pdf' })

describe('useSubirDocumento', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sube por el camino directo, nunca por el de la pila', async () => {
    const client = new QueryClient()
    const { result } = renderHook(() => useSubirDocumento(), { wrapper: envoltorio(client) })

    await act(() => result.current('rec-1', archivo(), '2027-01-31'))

    expect(complianceApi.uploadFile).toHaveBeenCalledWith('rec-1', expect.any(File), '2027-01-31')
    // Lo critico: la otra puerta sube ANTES de clasificar, asi que un rechazo
    // deja el archivo varado en la bandeja. Ese es el defecto que este hook
    // existe para que no vuelva.
    expect(documentIngestApi.uploadAndClassify).not.toHaveBeenCalled()
  })

  it('invalida la certificacion cuando la subida sale bien', async () => {
    const client = new QueryClient()
    const invalidar = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSubirDocumento(), { wrapper: envoltorio(client) })

    await act(() => result.current('rec-1', archivo()))

    await waitFor(() => expect(invalidar).toHaveBeenCalled())
  })

  it('propaga el error y NO invalida: nada cambio', async () => {
    vi.mocked(complianceApi.uploadFile).mockRejectedValueOnce(new Error('El archivo supera 7 MB'))
    const client = new QueryClient()
    const invalidar = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useSubirDocumento(), { wrapper: envoltorio(client) })

    await expect(act(() => result.current('rec-1', archivo()))).rejects.toThrow(/7 MB/)
    expect(invalidar).not.toHaveBeenCalled()
  })
})
