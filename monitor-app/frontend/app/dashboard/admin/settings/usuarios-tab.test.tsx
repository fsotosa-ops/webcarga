import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/users', () => ({
  usersApi: { list: vi.fn(), patch: vi.fn() },
}))
vi.mock('@/lib/api/access', () => ({
  accessApi: { roles: vi.fn(), permissions: vi.fn() },
}))

import { usersApi } from '@/lib/api/users'
import { accessApi } from '@/lib/api/access'
import { UsuariosTab } from './usuarios-tab'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import type { Acceso } from '@/lib/authz/acceso'

const ANA: Acceso = {
  id: 'u1', email: 'ana@webcarga.cl', full_name: 'Ana', roles: ['admin'], role_names: ['Administración'],
  permissions: ['users.manage'], aal: 'aal2',
}
const mostrar = () => render(<PermisosProvider acceso={ANA}><UsuariosTab /></PermisosProvider>)

const PROFILES = [
  { id: 'u1', full_name: 'Ana',  email: 'ana@webcarga.cl',  roles: ['admin'],  active: true,  created_at: '2026-01-01T00:00:00Z' },
  { id: 'u2', full_name: 'Beto', email: 'beto@webcarga.cl', roles: ['reader'], active: false, created_at: '2026-01-02T00:00:00Z' },
]
const ROLES = [
  { id: 'r1', code: 'reader', name: 'Lectura',        description: '', is_system: true, grants_all: false, permissions: ['operations.read'], assigned: 1 },
  { id: 'r2', code: 'admin',  name: 'Administración', description: '', is_system: true, grants_all: false, permissions: ['users.manage'],    assigned: 1 },
]

describe('UsuariosTab', () => {
  beforeEach(() => {
    vi.mocked(usersApi.list).mockResolvedValue(PROFILES as never)
    vi.mocked(accessApi.roles).mockResolvedValue(ROLES as never)
    vi.mocked(accessApi.permissions).mockResolvedValue([])
  })

  // Es la mudanza de app/dashboard/admin/usuarios/page.tsx: mismos numeros,
  // mismo listado -- solo cambia de donde se piden los datos.
  it('pide los usuarios y los roles al cargar', async () => {
    mostrar()
    await waitFor(() => expect(usersApi.list).toHaveBeenCalled())
    expect(accessApi.roles).toHaveBeenCalled()
    expect(accessApi.permissions).toHaveBeenCalled()
  })

  // Configuración, Parte 1: sin tarjetas de cifras; el total vive en el filtro.
  it('los filtros son un control segmentado con sus conteos, sin tarjetas de cifras', async () => {
    mostrar()
    const filtros = await screen.findByRole('group', { name: 'Filtrar' })
    expect(within(filtros).getByRole('button', { name: /Todos/ })).toHaveTextContent('2')
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
  })

  it('los encabezados de la tabla no van en mayúsculas', async () => {
    mostrar()
    const encabezado = await screen.findByRole('columnheader', { name: 'Persona' })
    expect(encabezado).not.toHaveClass('uppercase')
  })

  // El título de página lo pone la sección; este componente no lo repite.
  it('ya no repite el titulo de pagina', async () => {
    mostrar()
    await screen.findByRole('group', { name: 'Filtrar' })
    expect(screen.queryByText('Gestión de Usuarios')).not.toBeInTheDocument()
  })
})
