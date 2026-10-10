import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectorDeRoles from './SelectorDeRoles'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'
import { ADMIN, CATALOGO, ROLES } from './rolesDePrueba'

function mostrar(value: string[], onChange = vi.fn()) {
  render(
    <PermisosProvider acceso={ADMIN}>
      <SelectorDeRoles roles={ROLES} catalogo={CATALOGO} value={value} onChange={onChange} />
    </PermisosProvider>,
  )
  return onChange
}

describe('SelectorDeRoles', () => {
  it('por área se elige un nivel: pasar a Operador saca al Supervisor', () => {
    const onChange = mostrar(['reader', 'operations_supervisor'])
    const operaciones = screen.getByRole('radiogroup', { name: 'Operaciones' })
    expect(screen.getAllByRole('radio', { name: 'Supervisor' })[0]).toBeChecked()
    fireEvent.click(operaciones.querySelector('[value="operator"]')!)
    expect(onChange).toHaveBeenCalledWith(['reader', 'operations_operator'])
  })

  it('un rol que no puede dar queda deshabilitado y dice por qué', () => {
    mostrar(['reader'])
    expect(screen.getByRole('checkbox', { name: /Propietario/ })).toBeDisabled()
    expect(screen.getByText('Solo un Propietario puede dar este rol')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Auditor de cierres/ })).toBeDisabled()
    expect(screen.getByText(/Incluye permisos que tú no tienes: Firmar el cierre del día con pendientes/)).toBeInTheDocument()
  })

  it('marcar un rol general lo agrega', () => {
    const onChange = mostrar(['reader'])
    fireEvent.click(screen.getByRole('checkbox', { name: /Soporte técnico/ }))
    expect(onChange).toHaveBeenCalledWith(['reader', 'support'])
  })

  it('un área sin Supervisor en el catálogo no ofrece el nivel', () => {
    mostrar([])
    const seguros = screen.getByRole('radiogroup', { name: 'Seguros' })
    expect(seguros.querySelector('[value="supervisor"]')).toBeNull()
  })
})
