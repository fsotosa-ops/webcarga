import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CreateUserForm, { mensajeDeAcceso } from './CreateUserForm'
import { usersApi } from '@/lib/api/users'

vi.mock('@/lib/api/users', () => ({ usersApi: { create: vi.fn() } }))

const ROLES = [
  { id: 'viewer', label: 'Viewer', description: 'Solo lectura', level: 0 },
  { id: 'admin',  label: 'Admin',  description: 'Gestión',      level: 3 },
]

// Alta de usuarios (seguridad, 09/10): correo de invitación de Supabase y,
// además, un mensaje para que el admin se lo envíe a la persona.
describe('mensajeDeAcceso', () => {
  const base = { nombre: 'Ana', email: 'ana@webcarga.com', rol: 'Viewer', url: 'https://app/login' }

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

  function crear() {
    render(<CreateUserForm actorRole="admin" roles={ROLES} onCreated={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Felipe Rodríguez'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByPlaceholderText('usuario@empresa.cl'), { target: { value: 'ana@webcarga.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }))
  }

  it('al crear muestra el mensaje para copiar y avisa que salió el correo', async () => {
    vi.mocked(usersApi.create).mockResolvedValue({ invitation_sent: true } as never)
    crear()
    expect(await screen.findByText(/Le enviamos un correo de invitación/)).toBeInTheDocument()
    expect(screen.getByText(/te di acceso a WebCarga con el rol Viewer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copiar mensaje/ })).toBeInTheDocument()
  })

  it('si el correo no salió, pide enviar el mensaje', async () => {
    vi.mocked(usersApi.create).mockResolvedValue({ invitation_sent: false } as never)
    crear()
    await waitFor(() => expect(screen.getByText(/Envíale este mensaje por WhatsApp o correo/)).toBeInTheDocument())
  })
})
