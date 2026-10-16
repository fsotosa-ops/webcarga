import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { Suspense } from 'react'

const reemplazar = vi.fn()
const noEncontrado = vi.fn()
let busqueda = ''
vi.mock('next/navigation', () => ({
  notFound: () => { noEncontrado(); throw new Error('NEXT_NOT_FOUND') },
  useRouter: () => ({ replace: reemplazar }),
  useSearchParams: () => new URLSearchParams(busqueda),
}))
let permisos: string[] = ['operations.configure']
vi.mock('@/lib/authz/PermisosProvider', () => ({ useAcceso: () => ({ permissions: permisos }) }))

import AreaPage from './page'

async function montar(area: string) {
  await act(async () => {
    render(<Suspense fallback={null}><AreaPage params={Promise.resolve({ area })} /></Suspense>)
  })
}

beforeEach(() => { reemplazar.mockClear(); noEncontrado.mockClear(); busqueda = ''; permisos = ['operations.configure'] })

describe('/settings/[area] (P1.7)', () => {
  it('la URL vieja con ?section= y ?estado= va a /[area]/[section]?item=', async () => {
    busqueda = 'section=driver-reasons&estado=x'
    await montar('operations')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/operations/driver-reasons?item=x')
  })

  it('P3.7: el enlace viejo ?section=origins va al Tarifario con Orígenes', async () => {
    busqueda = 'section=origins'
    await montar('operations')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/pricing?origen=1')
  })

  it('?doc= de Condiciones se conserva', async () => {
    permisos = ['certification.configure']
    busqueda = 'section=conditions&doc=MANTENCION_FRIO'
    await montar('certification')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/certification/conditions?doc=MANTENCION_FRIO')
  })

  it('sin sección, va a la primera del área', async () => {
    await montar('operations')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/operations/tms-statuses')
  })

  it('un área inexistente o que la persona no puede ver es un 404', async () => {
    await expect(montar('inventada')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(montar('people')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('una sección inválida en un enlace viejo cae en la primera del área (no en un 404)', async () => {
    busqueda = 'section=inventada&estado=x'
    await montar('operations')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/operations/tms-statuses?item=x')
  })
})

