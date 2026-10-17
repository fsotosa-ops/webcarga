import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PermissionCode } from '@/lib/authz/permisos.generated'

const listQueue = vi.fn()
const listOpen = vi.fn()
const carrierOverview = vi.fn()
vi.mock('@/lib/api/documentIngest', () => ({ documentIngestApi: { listQueue: (...a: unknown[]) => listQueue(...a) } }))
vi.mock('@/lib/api/certificationRequests', () => ({ certificationRequestsApi: { listOpen: (...a: unknown[]) => listOpen(...a) } }))
vi.mock('@/lib/api/insurance', async orig => ({
  ...(await orig<object>()), insuranceApi: { carrierOverview: () => carrierOverview() },
}))

import { useNavCounts } from './useNavCounts'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useNavCounts', () => {
  beforeEach(() => {
    listQueue.mockResolvedValue({ total: 12 })
    listOpen.mockResolvedValue({ total: 0 })
    // No al día = Vencida + Sin póliza + Cuotas vencidas + Sin fechas (el glosario): 1 + 2 + 3 + 4.
    carrierOverview.mockResolvedValue({ data: [], facets: { EXPIRED: 1, NO_POLICY: 2, OVERDUE: 3, NO_DATES: 4, EXPIRING: 5, UP_TO_DATE: 6, total: 21 } })
  })

  it('sin documents.review no pide ni cuenta Por asignar ni Pendientes', async () => {
    const { result } = renderHook(() => useNavCounts([]), { wrapper })
    await waitFor(() => expect(result.current.insurance).toBe(10))
    expect(listQueue).not.toHaveBeenCalled()
    expect(listOpen).not.toHaveBeenCalled()
    expect('inbox' in result.current).toBe(false)
  })

  it('mientras la consulta viaja, la cifra no existe (no se dibuja un cero que miente)', () => {
    carrierOverview.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useNavCounts([]), { wrapper })
    expect('insurance' in result.current).toBe(false)
  })

  it('con el dato, el número, incluido el cero', async () => {
    const { result } = renderHook(() => useNavCounts(['documents.review'] as PermissionCode[]), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ inbox: 12, requests: 0, insurance: 10 }))
  })
})
