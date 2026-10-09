import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CreateUserForm, { mensajeDeAcceso } from './CreateUserForm'
import { usersApi } from '@/lib/api/users'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import type { Acceso } from '@/lib/authz/acceso'
import type { RoleInfo } from '@/lib/api/roles'

vi.mock('@/lib/api/users', () => ({ usersApi: { create: vi.fn() } }))

function rol(code: string, name: string, permissions: string[], grants_all = false): RoleInfo {
  return { id: code, code, name, description: '', is_system: true, grants_all, permissions, assigned: 0 }
}
const ROLES = [
  rol('reader', 'Lectura', ['operations.read']),
  rol('admin', 'Administración', ['operations.read', 'users.manage']),
  rol('owner', 'Propietario', [], true),
]
const ADMIN: Acceso = {
  id: 'a', email: 'a@webcarga.com', full_name: null, roles: ['admin'], role_names: ['Administración'],
  permissions: ['operations.read'], aal: 'aal2',
}

// Alta de usuarios (seguridad, 09/10): correo de invitación de Supabase y,
// además, un mensaje para que el admin se lo envíe a la persona.
describe('mensajeDeAcceso', () => {
  const base = { nombre: 'Ana', email: 'ana@webcarga.com', rol: 'Lectura', url: 'https://app/login' }

  it('sin contraseña dice que entre con Google o Microsoft', () => {
    const m = mensajeDeAcceso(base)
    expect(m).toContain('Google o Microsoft')
    expect(m).toContain('ana@webcarga.com')
    expect(m).toContain('https://app/login')
    expect(m).not.toContain('contraseña')
  })

  it('con contraseña la incluye', () => {
    expect(mensajeDeAcceso({ ...base, password: 'una-clave-larga' })).toContain('una-clave-larga')
  })
})

describe('CreateUserForm', () => {
  beforeEach(() => vi.mocked(usersApi.create).mockReset())

  function mostrar(acceso: Acceso = ADMIN) {
    render(
      <PermisosProvider acceso={acceso}>
        <CreateUserForm roles={ROLES} onCreated={vi.fn()} onClose={vi.fn()} />
      </PermisosProvider>,
    )
  }

  function crear() {
    mostrar()
    fireEvent.change(screen.getByPlaceholderText('Felipe Rodríguez'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByPlaceholderText('usuario@empresa.cl'), { target: { value: 'ana@webcarga.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }))
  }

  it('al crear muestra el mensaje para copiar y avisa que salió el correo', async () => {
    vi.mocked(usersApi.create).mockResolvedValue({ invitation_sent: true } as never)
    crear()
    expect(await screen.findByText(/Le enviamos un correo de invitación/)).toBeInTheDocument()
    expect(screen.getByText(/te di acceso a WebCarga con el rol Lectura/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copiar mensaje/ })).toBeInTheDocument()
    expect(usersApi.create).toHaveBeenCalledWith(expect.objectContaining({ roles: ['reader'] }))
  })

  // La misma regla que valida la API (assert_can_grant): solo se ofrece un rol
  // cuyos permisos ya tiene quien invita, y Propietario solo lo da otro Propietario.
  it('ofrece solo los roles que la persona puede otorgar', () => {
    mostrar()
    expect(screen.getByText('Lectura')).toBeInTheDocument()
    expect(screen.queryByText('Administración')).not.toBeInTheDocument()
    expect(screen.queryByText('Propietario')).not.toBeInTheDocument()
  })

  it('un Propietario puede invitar a otro Propietario', () => {
    mostrar({ ...ADMIN, roles: ['owner'], permissions: ['operations.read', 'users.manage'] })
    expect(screen.getByText('Propietario')).toBeInTheDocument()
    expect(screen.getByText('Administración')).toBeInTheDocument()
  })

  it('si el correo no salió, pide enviar el mensaje', async () => {
    vi.mocked(usersApi.create).mockResolvedValue({ invitation_sent: false } as never)
    crear()
    await waitFor(() => expect(screen.getByText(/Envíale este mensaje por WhatsApp o correo/)).toBeInTheDocument())
  })
})
