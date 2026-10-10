import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CreateUserForm, { mensajeDeAcceso } from './CreateUserForm'
import { usersApi } from '@/lib/api/users'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import type { Acceso } from '@/lib/authz/acceso'
import { ADMIN, CATALOGO, ROLES } from './rolesDePrueba'

vi.mock('@/lib/api/users', () => ({ usersApi: { create: vi.fn() } }))

// Alta de usuarios (seguridad, 09/10): correo de invitación de Supabase y,
// además, un mensaje para que el admin se lo envíe a la persona.
describe('mensajeDeAcceso', () => {
  const base = { nombre: 'Ana', email: 'ana@webcarga.com', roles: ['Lectura'], url: 'https://app/login' }

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

  it('nombra un rol o varios', () => {
    expect(mensajeDeAcceso(base)).toContain('con el rol Lectura')
    expect(mensajeDeAcceso({ ...base, roles: ['Lectura', 'Operador de Operaciones', 'Operador de Seguros'] }))
      .toContain('con los roles Lectura, Operador de Operaciones y Operador de Seguros')
  })
})

describe('CreateUserForm', () => {
  beforeEach(() => { vi.mocked(usersApi.create).mockReset() })

  function mostrar(acceso: Acceso = ADMIN) {
    render(
      <PermisosProvider acceso={acceso}>
        <CreateUserForm roles={ROLES} catalogo={CATALOGO} onCreated={vi.fn()} onClose={vi.fn()} />
      </PermisosProvider>,
    )
  }

  function llenar() {
    fireEvent.change(screen.getByPlaceholderText('Felipe Rodríguez'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByPlaceholderText('usuario@empresa.cl'), { target: { value: 'ana@webcarga.com' } })
  }

  it('parte con Lectura, invita con varios roles y el mensaje los nombra', async () => {
    vi.mocked(usersApi.create).mockResolvedValue({ invitation_sent: true } as never)
    mostrar()
    llenar()
    expect(screen.getByRole('checkbox', { name: /Lectura/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radiogroup', { name: 'Operaciones' }).querySelector('[value="operator"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }))
    expect(await screen.findByText(/Le enviamos un correo de invitación/)).toBeInTheDocument()
    expect(usersApi.create).toHaveBeenCalledWith(expect.objectContaining({ roles: ['reader', 'operations_operator'] }))
    expect(screen.getByText(/con los roles Lectura y Operador de Operaciones/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copiar mensaje/ })).toBeInTheDocument()
  })

  it('si el correo no salió, pide enviar el mensaje', async () => {
    vi.mocked(usersApi.create).mockResolvedValue({ invitation_sent: false } as never)
    mostrar()
    llenar()
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }))
    await waitFor(() => expect(screen.getByText(/Envíale este mensaje por WhatsApp o correo/)).toBeInTheDocument())
  })

  it('sin roles no deja crear', () => {
    mostrar()
    llenar()
    fireEvent.click(screen.getByRole('checkbox', { name: /Lectura/ }))
    expect(screen.getByRole('button', { name: 'Crear usuario' })).toBeDisabled()
  })

  // La misma regla que valida la API (assert_can_grant).
  it('Propietario lo da solo otro Propietario', () => {
    mostrar()
    expect(screen.getByRole('checkbox', { name: /Propietario/ })).toBeDisabled()
  })

  it('un Propietario puede invitar a otro Propietario', () => {
    mostrar({ ...ADMIN, roles: ['owner'] })
    expect(screen.getByRole('checkbox', { name: /Propietario/ })).toBeEnabled()
  })
})
