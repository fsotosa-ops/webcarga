import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/lib/api/tablePreferences', () => ({
  tablePreferencesApi: { get: vi.fn(), save: vi.fn(), reset: vi.fn() },
}))
import { tablePreferencesApi } from '@/lib/api/tablePreferences'
import { useTablePreferences } from './useTablePreferences'

function envoltura() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => { vi.mocked(tablePreferencesApi.get).mockReset(); vi.mocked(tablePreferencesApi.save).mockReset() })

describe('useTablePreferences', () => {
  it('sin preferencia guardada, null (el orden de la tabla)', async () => {
    vi.mocked(tablePreferencesApi.get).mockResolvedValue(null)
    const { result } = renderHook(() => useTablePreferences('closure.fleet'), { wrapper: envoltura() })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.columns).toBeNull()
  })

  it('guardar se ve al instante y va a la API', async () => {
    vi.mocked(tablePreferencesApi.get).mockResolvedValue(null)
    // La API no responde: la preferencia igual se ve (no espera la red).
    vi.mocked(tablePreferencesApi.save).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useTablePreferences('closure.fleet'), { wrapper: envoltura() })
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.save([{ id: 'empresa', hidden: true }]))
    await waitFor(() => expect(result.current.columns).toEqual([{ id: 'empresa', hidden: true }]))
    expect(tablePreferencesApi.save).toHaveBeenCalledWith('closure.fleet', [{ id: 'empresa', hidden: true }])
  })
})
