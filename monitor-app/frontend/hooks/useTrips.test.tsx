import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTrips } from './useTrips'
import { tripsApi } from '@/lib/api/trips'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { list: vi.fn() },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useTrips', () => {
  beforeEach(() => {
    vi.mocked(tripsApi.list).mockReset()
  })

  it('fetches trips with the given params', async () => {
    vi.mocked(tripsApi.list).mockResolvedValue({ data: [], count: 0, page: 1, limit: 200 })
    const { result } = renderHook(
      () => useTrips({ fecha: '2026-07-04', view: 'en_curso', limit: 200 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(tripsApi.list).toHaveBeenCalledWith({ fecha: '2026-07-04', view: 'en_curso', limit: 200 })
    expect(result.current.data?.count).toBe(0)
  })

  it('keeps previous data visible while refetching with new params', async () => {
    vi.mocked(tripsApi.list).mockResolvedValueOnce({
      data: [{ id: 't1' } as never], count: 1, page: 1, limit: 200,
    })
    let resolveSecond!: (v: unknown) => void
    vi.mocked(tripsApi.list).mockImplementationOnce(
      () => new Promise(res => { resolveSecond = res }) as never,
    )
    const { result, rerender } = renderHook(
      ({ q }) => useTrips({ view: 'en_curso', q, limit: 200 }),
      { wrapper, initialProps: { q: '' } },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    rerender({ q: 'ABCD' })
    // Mientras carga la nueva query, la data anterior sigue disponible (sin flash)
    expect(result.current.isFetching).toBe(true)
    expect(result.current.data?.count).toBe(1)
    resolveSecond({ data: [], count: 0, page: 1, limit: 200 })
    await waitFor(() => expect(result.current.data?.count).toBe(0))
  })

  it('exposes the error when the request fails', async () => {
    vi.mocked(tripsApi.list).mockRejectedValue(new Error('backend caído'))
    const { result } = renderHook(
      () => useTrips({ view: 'en_curso', limit: 200 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('backend caído')
  })
})
