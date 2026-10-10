import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Orígenes escribe con PATCH /locations, que exige commercial.edit (revisión
// final RBAC, hallazgo 3): sin ese permiso la lista se ve sin acciones.
const permisos = vi.hoisted(() => ({ dados: null as Set<string> | null }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => permisos.dados === null || permisos.dados.has(p),
}))
vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn(), patch: vi.fn() },
  shippersApi: { list: vi.fn() },
}))

import { OrigenesTab } from './origenes'
import { locationsApi, shippersApi } from '@/lib/api/locations'

const CD = { id: 'l1', name: 'CD Lo Aguirre', entity_id: 's1', is_origin: true }

describe('OrigenesTab', () => {
  beforeEach(() => {
    permisos.dados = null
    vi.mocked(locationsApi.list).mockResolvedValue({ data: [CD] } as never)
    vi.mocked(shippersApi.list).mockResolvedValue([{ id: 's1', name: 'Generador' }] as never)
  })

  it('con commercial.edit ofrece quitar y agregar', async () => {
    render(<OrigenesTab />)
    expect(await screen.findByRole('button', { name: /Quitar/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agregar un centro de distribución/ })).toBeInTheDocument()
  })

  it('sin commercial.edit la lista se ve sin acciones', async () => {
    permisos.dados = new Set(['operations.configure'])
    render(<OrigenesTab />)
    expect(await screen.findByText('CD Lo Aguirre')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Agregar un centro/ })).not.toBeInTheDocument()
  })
})
