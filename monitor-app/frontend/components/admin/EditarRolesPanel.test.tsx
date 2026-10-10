import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditarRolesPanel from './EditarRolesPanel'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import { accessApi } from '@/lib/api/access'
import { ApiError } from '@/lib/api/client'
import { ADMIN, CATALOGO, ROLES } from './rolesDePrueba'

vi.mock('@/lib/api/access', () => ({ accessApi: { setUserRoles: vi.fn() } }))

const PERSONA = { id: 'u2', full_name: 'María Torres', email: 'maria@ejemplo.cl', roles: ['reader'] }

function mostrar(roles = PERSONA.roles) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <PermisosProvider acceso={ADMIN}>
      <EditarRolesPanel persona={{ ...PERSONA, roles }} roles={ROLES} catalogo={CATALOGO} onSaved={onSaved} onClose={onClose} />
    </PermisosProvider>,
  )
  return { onSaved, onClose }
}

describe('EditarRolesPanel', () => {
  // Con llaves: lo que devuelve beforeEach, Vitest lo corre como limpieza
  // después del test, y devolver el mock lo llamaba una vez más.
  beforeEach(() => { vi.mocked(accessApi.setUserRoles).mockReset() })

  it('dice qué permisos gana antes de guardar, y guarda la lista nueva', async () => {
    vi.mocked(accessApi.setUserRoles).mockResolvedValue({ roles: ['operations_operator', 'reader'] })
    const { onSaved } = mostrar()
    fireEvent.click(screen.getByRole('radiogroup', { name: 'Operaciones' }).querySelector('[value="operator"]')!)
    expect(screen.getByText(/gana: Firmar y reabrir el cierre del día/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar roles' }))
    await waitFor(() => expect(accessApi.setUserRoles).toHaveBeenCalledWith('u2', ['reader', 'operations_operator']))
    expect(onSaved).toHaveBeenCalledWith(['operations_operator', 'reader'])
  })

  it('sin cambios no deja guardar', () => {
    mostrar()
    expect(screen.getByRole('button', { name: 'Guardar roles' })).toBeDisabled()
  })

  it('sin ningún rol no deja guardar y explica qué hacer', () => {
    mostrar()
    fireEvent.click(screen.getByRole('checkbox', { name: /Lectura/ }))
    expect(screen.getByText(/sin roles la persona no puede entrar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar roles' })).toBeDisabled()
  })

  it('el 409 de la API se ve en el panel y lo elegido se mantiene', async () => {
    vi.mocked(accessApi.setUserRoles).mockRejectedValue(new ApiError('Debe quedar al menos un Propietario', 409, null))
    const { onClose } = mostrar()
    fireEvent.click(screen.getByRole('checkbox', { name: /Soporte técnico/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar roles' }))
    expect(await screen.findByText('Debe quedar al menos un Propietario')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Soporte técnico/ })).toBeChecked()
    expect(onClose).not.toHaveBeenCalled()
  })

  // Menor 7: conservar o quitar un rol que el actor no podría dar no es
  // escalar; agregarlo sí.
  it('un rol que ya tiene se puede quitar aunque quien edita no pueda darlo', () => {
    mostrar(['reader', 'auditor'])
    const auditor = screen.getByRole('checkbox', { name: /Auditor de cierres/ })
    expect(auditor).toBeChecked()
    expect(auditor).toBeEnabled()
    fireEvent.click(auditor)
    expect(auditor).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Guardar roles' })).toBeEnabled()
  })
})

