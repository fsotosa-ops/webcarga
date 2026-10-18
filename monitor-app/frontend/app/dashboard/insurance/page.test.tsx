import { describe, it, expect, vi } from 'vitest'

const redirect = vi.fn()
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))
vi.mock('@/components/insurance/CarrierInsuranceOverview', () => ({ CarrierInsuranceOverview: () => null }))

import InsurancePage from './page'

describe('Seguros (la página)', () => {
  it('un enlace viejo de Pólizas redirige a Pólizas con su filtro', async () => {
    await InsurancePage({ searchParams: Promise.resolve({ state: 'EXPIRED', page: '2' }) })
    expect(redirect).toHaveBeenCalledWith('/dashboard/insurance/policies?state=EXPIRED&page=2')
  })

  it('un enlace de hoy (?q=RUT) muestra Empresas, sin redirigir', async () => {
    redirect.mockClear()
    expect(await InsurancePage({ searchParams: Promise.resolve({ q: '77104928-1' }) })).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
