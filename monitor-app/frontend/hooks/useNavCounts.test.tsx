import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PermissionCode } from '@/lib/authz/permisos.generated'

const listQueue = vi.fn()
const listOpen = vi.fn()
const listInstallments = vi.fn()
vi.mock('@/lib/api/documentIngest', () => ({ documentIngestApi: { listQueue: (...a: unknown[]) => listQueue(...a) } }))
vi.mock('@/lib/api/certificationRequests', () => ({ certificationRequestsApi: { listOpen: (...a: unknown[]) => listOpen(...a) } }))
vi.mock('@/lib/api/insurance', () => ({ insuranceApi: { listInstallments: (...a: unknown[]) => listInstallments(...a) } }))

import { useNavCounts } from './useNavCounts'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useNavCounts', () => {
  beforeEach(() => {
    listQueue.mockResolvedValue({ total: 12 })
    listOpen.mockResolvedValue({ total: 0 })
    listInstallments.mockResolvedValue({ facets: { OVERDUE: 3 } })
  })

  it('sin documents.review no pide ni cuenta Por asignar ni Pendientes', async () => {
    const { result } = renderHook(() => useNavCounts([]), { wrapper })
    await waitFor(() => expect(result.current.installments).toBe(3))
    expect(listQueue).not.toHaveBeenCalled()
    expect(listOpen).not.toHaveBeenCalled()
    expect('inbox' in result.current).toBe(false)
  })

  it('mientras la consulta viaja, la cifra no existe (no se dibuja un cero que miente)', () => {
    listInstallments.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useNavCounts([]), { wrapper })
    expect('installments' in result.current).toBe(false)
  })

  it('con el dato, el número, incluido el cero', async () => {
    const { result } = renderHook(() => useNavCounts(['documents.review'] as PermissionCode[]), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ inbox: 12, requests: 0, installments: 3 }))
  })
})
