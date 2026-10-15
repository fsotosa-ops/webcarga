import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { redirect } from 'next/navigation'
import CertificationCarrierRedirect from './page'

describe('compliance/[carrierId] (C6)', () => {
  it('redirige a la ficha del Directorio en la pestaña Documentos', async () => {
    await CertificationCarrierRedirect({ params: Promise.resolve({ carrierId: 'c1' }) })
    expect(redirect).toHaveBeenCalledWith('/dashboard/carriers/c1?tab=documentos')
  })
})
