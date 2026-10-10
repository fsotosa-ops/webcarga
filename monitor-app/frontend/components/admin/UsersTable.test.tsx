import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import UsersTable from './UsersTable'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import { accessApi } from '@/lib/api/access'
import { usersApi } from '@/lib/api/users'
import { ApiError } from '@/lib/api/client'
import type { Profile } from '@/lib/types'
import { ADMIN, CATALOGO, ROLES } from './rolesDePrueba'

vi.mock('@/lib/api/access', () => ({ accessApi: { setUserRoles: vi.fn() } }))
vi.mock('@/lib/api/users', () => ({ usersApi: { patch: vi.fn(), remove: vi.fn() } }))

const persona = (id: string, nombre: string, roles: string[]) =>
  ({ id, full_name: nombre, email: `${id}@ejemplo.cl`, roles, active: true, created_at: null }) as unknown as Profile

const USERS = [persona('u1', 'Pablo', ['owner']), persona('u2', 'María', ['reader'])]

function mostrar() {
  render(
    <PermisosProvider acceso={ADMIN}>
      <UsersTable users={USERS} currentUserId="actor" roles={ROLES} catalogo={CATALOGO} />
    </PermisosProvider>,
  )
}

const fila = (nombre: string) => screen.getByText(nombre).closest('tr')!

describe('UsersTable', () => {
  beforeEach(() => { vi.mocked(accessApi.setUserRoles).mockReset() })

  it('edita los roles desde el menú de la fila y la fila muestra los nuevos', async () => {
    vi.mocked(accessApi.setUserRoles).mockResolvedValue({ roles: ['reader', 'support'] })
    mostrar()
    fireEvent.click(within(fila('María')).getByRole('button', { name: 'Acciones' }))
    fireEvent.click(screen.getByRole('button', { name: 'Editar roles' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Soporte técnico/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar roles' }))
    expect(await within(fila('María')).findByText('Soporte técnico (proveedor)')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a un Propietario solo lo toca otro Propietario: la fila no ofrece acciones', () => {
    mostrar()
    expect(within(fila('Pablo')).queryByRole('button', { name: 'Acciones' })).not.toBeInTheDocument()
    expect(within(fila('María')).getByRole('button', { name: 'Acciones' })).toBeInTheDocument()
  })

  // Menor 3 de la revisión final RBAC: el interruptor volvía atrás sin decir
  // por qué (403 de MFA, 409 del último Propietario).
  it('si la API rechaza desactivar, dice por qué y la fila vuelve a como estaba', async () => {
    vi.mocked(usersApi.patch).mockRejectedValue(new ApiError('Debe quedar al menos un Propietario', 409, null))
    mostrar()
    fireEvent.click(within(fila('María')).getByRole('button', { name: 'Acciones' }))
    fireEvent.click(screen.getByRole('button', { name: /Desactivar acceso/ }))
    expect(await screen.findByText('Debe quedar al menos un Propietario')).toBeInTheDocument()
    expect(within(fila('María')).getByText('Activo')).toBeInTheDocument()
  })
})

