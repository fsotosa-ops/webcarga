import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/users', () => ({
  usersApi: { list: vi.fn(), patch: vi.fn() },
}))
vi.mock('@/lib/api/access', () => ({
  accessApi: { roles: vi.fn(), permissions: vi.fn() },
}))
vi.mock('@/lib/api/config', () => ({ changesApi: { list: vi.fn().mockResolvedValue([]) } }))

import { usersApi } from '@/lib/api/users'
import { accessApi } from '@/lib/api/access'
import { UsuariosTab } from './usuarios-tab'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import type { Acceso } from '@/lib/authz/acceso'

const ANA: Acceso = {
  id: 'u1', email: 'ana@webcarga.cl', full_name: 'Ana', roles: ['admin'], role_names: ['Administración'],
  permissions: ['users.manage'], aal: 'aal2',
}
const mostrar = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PermisosProvider acceso={ANA}><UsuariosTab /></PermisosProvider>
  </QueryClientProvider>)

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

  // Spec 2026-10-22: la tabla del kit; las pestañas pasan a filtros de columna.
  it('las pestañas pasan a filtro de Estado del kit', async () => {
    mostrar()
    await screen.findByRole('columnheader', { name: /Persona/ })
    expect(screen.queryByRole('group', { name: 'Filtrar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Agregar filtro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtrar por Estado' })).toBeInTheDocument()
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
  })

  it('tras desactivar, la fila dice Inactivo sin recargar', async () => {
    const activo = { ...PROFILES[1], active: true }
    vi.mocked(usersApi.list)
      .mockResolvedValueOnce([PROFILES[0], activo] as never)
      .mockResolvedValue([PROFILES[0], { ...activo, active: false }] as never)
    vi.mocked(usersApi.patch).mockResolvedValue({} as never)
    mostrar()
    const fila = (await screen.findByText('Beto')).closest('tr')!
    expect(within(fila).getByText('Activo')).toBeInTheDocument()
    fireEvent.click(within(fila).getByRole('button', { name: 'Acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Desactivar acceso/ }))
    await waitFor(() => expect(within(screen.getByText('Beto').closest('tr')!).getByText('Inactivo')).toBeInTheDocument())
    expect(usersApi.patch).toHaveBeenCalledWith('u2', { active: false })
  })

  it('los encabezados de la tabla no van en mayúsculas', async () => {
    mostrar()
    const encabezado = await screen.findByRole('columnheader', { name: /Persona/ })
    expect(encabezado).not.toHaveClass('uppercase')
  })

  // El título de página lo pone la sección; este componente no lo repite.
  it('ya no repite el titulo de pagina', async () => {
    mostrar()
    await screen.findByRole('columnheader', { name: /Persona/ })
    expect(screen.queryByText('Gestión de Usuarios')).not.toBeInTheDocument()
  })
})
