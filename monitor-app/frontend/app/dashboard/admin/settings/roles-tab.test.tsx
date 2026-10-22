import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RolesTab, codigoDeRol } from './roles-tab'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import { accessApi } from '@/lib/api/access'
import { changesApi } from '@/lib/api/config'
import { ApiError } from '@/lib/api/client'
import type { Acceso } from '@/lib/authz/acceso'
import { ADMIN, CATALOGO, ROLES } from '@/components/admin/rolesDePrueba'

vi.mock('@/lib/api/config', () => ({ changesApi: { list: vi.fn().mockResolvedValue([
  { element_id: 'id-auditor', actor_name: 'Ana', changed_at: '2026-10-15T15:00:00Z' },
]) } }))
vi.mock('@/lib/api/access', () => ({
  accessApi: { roles: vi.fn(), permissions: vi.fn(), createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn() },
}))

const GESTOR: Acceso = { ...ADMIN, permissions: [...ADMIN.permissions, 'roles.manage'] }

function mostrar(acceso: Acceso = GESTOR) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PermisosProvider acceso={acceso}><RolesTab /></PermisosProvider>
    </QueryClientProvider>)
}

describe('RolesTab', () => {
  beforeEach(() => {
    vi.mocked(accessApi.roles).mockReset().mockResolvedValue(ROLES)
    vi.mocked(accessApi.permissions).mockReset().mockResolvedValue(CATALOGO)
    vi.mocked(accessApi.createRole).mockReset()
    vi.mocked(accessApi.deleteRole).mockReset()
  })

  it('un rol de sistema se ve con sus permisos y sin acciones de edición', async () => {
    mostrar()
    fireEvent.click(await screen.findByRole('button', { name: /Operador de Operaciones/ }))
    const detalle = screen.getByRole('region', { name: 'Operador de Operaciones' })
    expect(within(detalle).getByText(/se define en el código y no se edita/)).toBeInTheDocument()
    expect(within(detalle).getByText('Firmar y reabrir el cierre del día')).toHaveAttribute('data-incluido', 'true')
    expect(within(detalle).getByText('Firmar el cierre del día con pendientes')).toHaveAttribute('data-incluido', 'false')
    expect(within(detalle).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(within(detalle).queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })

  it('crea un rol personalizado solo con permisos que tiene quien lo crea', async () => {
    vi.mocked(accessApi.createRole).mockResolvedValue({ ...ROLES[2], id: 'nuevo', code: 'bodega', name: 'Bodega', is_system: false })
    mostrar()
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo rol' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Bodega CD Lo Aguirre' } })
    expect(screen.getByRole('checkbox', { name: /Firmar el cierre del día con pendientes/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Ver viajes, el Monitor/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Firmar y reabrir/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear rol' }))
    await waitFor(() => expect(accessApi.createRole).toHaveBeenCalledWith({
      code: 'custom_bodega_cd_lo_aguirre', name: 'Bodega CD Lo Aguirre', description: '',
      permissions: ['operations.read', 'closures.sign'],
    }))
  })

  it('sin roles.manage no ofrece crear', async () => {
    mostrar(ADMIN)
    await screen.findByRole('button', { name: /Operador de Operaciones/ })
    expect(screen.queryByRole('button', { name: 'Nuevo rol' })).not.toBeInTheDocument()
  })

  it('eliminar un rol en uso muestra el 409 de la API', async () => {
    vi.mocked(accessApi.deleteRole).mockRejectedValue(new ApiError('El rol está asignado a 1 persona(s): reasígnalas primero', 409, null))
    mostrar()
    fireEvent.click(await screen.findByRole('button', { name: /Auditor de cierres/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('asignado a 1 persona(s)')
  })

  it('sin roles personalizados dice para qué sirven', async () => {
    vi.mocked(accessApi.roles).mockResolvedValue(ROLES.filter(r => r.is_system))
    mostrar()
    expect(await screen.findByText(/Aún no hay roles personalizados/)).toBeInTheDocument()
  })
})

describe('codigoDeRol', () => {
  it('sale del nombre, sin tildes ni espacios, con el prefijo de los personalizados', () => {
    expect(codigoDeRol('Bodega CD Lo Aguirre')).toBe('custom_bodega_cd_lo_aguirre')
    expect(codigoDeRol('Auditoría (externa)')).toBe('custom_auditoria_externa')
    expect(codigoDeRol('1 rol')).toBe('custom_1_rol')
  })
  it('respeta el largo que acepta la API (^custom_[a-z0-9_]{2,40}$)', () => {
    expect(codigoDeRol('x'.repeat(80))).toMatch(/^custom_[a-z0-9_]{2,40}$/)
  })
})

describe('orden de los roles de sistema', () => {
  beforeEach(() => {
    vi.mocked(accessApi.roles).mockReset().mockResolvedValue(ROLES)
    vi.mocked(accessApi.permissions).mockReset().mockResolvedValue(CATALOGO)
  })
  it('Propietario y Administración primero, después las áreas, Lectura al final', async () => {
    mostrar()
    const lista = await screen.findByRole('navigation', { name: 'Roles' })
    await within(lista).findByText('Lectura')
    const nombres = within(lista).getAllByRole('button').map(b => b.textContent?.replace(/\d+$/, ''))
    expect(nombres.slice(0, 4)).toEqual(['Propietario (Super admin)', 'Administración', 'Supervisor de Operaciones', 'Operador de Operaciones'])
    expect(nombres.indexOf('Lectura')).toBeGreaterThan(nombres.indexOf('Operador de Seguros'))
    // Abre con el primero de la lista elegido.
    expect(screen.getByRole('region', { name: 'Propietario (Super admin)' })).toBeInTheDocument()
  })

  // Configuración, Parte 1: los títulos van en texto normal, como el resto del kit.
  it('los títulos de grupo no van en mayúsculas', async () => {
    mostrar()
    expect(await screen.findByText('De sistema')).not.toHaveClass('uppercase')
  })
})

describe('RolesTab: spec 2026-10-22', () => {
  beforeEach(() => {
    vi.mocked(accessApi.roles).mockReset().mockResolvedValue(ROLES)
    vi.mocked(accessApi.permissions).mockReset().mockResolvedValue(CATALOGO)
  })

  it('pasar de crear un rol a editar otro no hereda el formulario', async () => {
    mostrar()
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo rol' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Bodega' } })
    fireEvent.click(screen.getByRole('button', { name: /Auditor de cierres/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('Auditor de cierres')
  })

  it('el detalle del rol muestra Última modificación', async () => {
    mostrar()
    fireEvent.click(await screen.findByRole('button', { name: /Auditor de cierres/ }))
    expect(await screen.findByText('Última modificación: Ana, 15/10/2026')).toBeInTheDocument()
  })

  // Revisión final (I2): con la caché de la app (60 s), el detalle mostraba el autor viejo.
  it('tras editar un rol, su Última modificación se vuelve a pedir', async () => {
    vi.mocked(accessApi.updateRole).mockResolvedValue({ ...ROLES.find(r => r.code === 'auditor')!, name: 'Auditor' })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })}>
        <PermisosProvider acceso={GESTOR}><RolesTab /></PermisosProvider>
      </QueryClientProvider>)
    fireEvent.click(await screen.findByRole('button', { name: /Auditor de cierres/ }))
    await screen.findByText('Última modificación: Ana, 15/10/2026')
    const antes = vi.mocked(changesApi.list).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Auditor' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(vi.mocked(changesApi.list).mock.calls.length).toBeGreaterThan(antes))
  })
})
