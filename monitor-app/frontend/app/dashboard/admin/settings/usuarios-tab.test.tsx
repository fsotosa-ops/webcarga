import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/users', () => ({
  usersApi: { list: vi.fn(), patch: vi.fn() },
}))
vi.mock('@/lib/api/roles', () => ({
  fetchRoles: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  }),
}))

import { usersApi } from '@/lib/api/users'
import { fetchRoles } from '@/lib/api/roles'
import { UsuariosTab } from './usuarios-tab'

const PROFILES = [
  { id: 'u1', full_name: 'Ana',  email: 'ana@webcarga.cl',  role: 'admin',  active: true,  created_at: '2026-01-01T00:00:00Z' },
  { id: 'u2', full_name: 'Beto', email: 'beto@webcarga.cl', role: 'viewer', active: false, created_at: '2026-01-02T00:00:00Z' },
]
const ROLES = [
  { id: 'viewer', label: 'Viewer', description: 'Solo lectura', level: 0 },
  { id: 'admin',  label: 'Admin',  description: 'Administra',   level: 3 },
]

describe('UsuariosTab', () => {
  beforeEach(() => {
    vi.mocked(usersApi.list).mockResolvedValue(PROFILES as never)
    vi.mocked(fetchRoles).mockResolvedValue(ROLES as never)
  })

  // Es la mudanza de app/dashboard/admin/usuarios/page.tsx: mismos numeros,
  // mismo listado -- solo cambia de donde se piden los datos.
  it('pide los usuarios y los roles al cargar', async () => {
    render(<UsuariosTab />)
    await waitFor(() => expect(usersApi.list).toHaveBeenCalled())
    expect(fetchRoles).toHaveBeenCalled()
  })

  it('muestra el total de usuarios calculado de la lista', async () => {
    render(<UsuariosTab />)
    const etiqueta = await screen.findByText('Usuarios')
    expect(etiqueta.previousElementSibling).toHaveTextContent('2')
  })

  // El titulo de pagina ("Gestión de Usuarios") ahora lo pone la pagina del
  // dominio -- este componente ya no es una pagina completa, es una seccion.
  it('ya no repite el titulo de pagina', async () => {
    render(<UsuariosTab />)
    await screen.findByText('Usuarios')
    expect(screen.queryByText('Gestión de Usuarios')).not.toBeInTheDocument()
  })
})
