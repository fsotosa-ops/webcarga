import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PermisosProvider, usePermiso } from './PermisosProvider'

function Muestra() {
  return <span>{usePermiso('closures.sign') ? 'puede' : 'no puede'}</span>
}
const base = { id: 'u', email: 'a@b.c', full_name: null, roles: [], role_names: [], aal: 'aal1' as const }

describe('usePermiso', () => {
  it('responde con los permisos que dio la API', () => {
    render(<PermisosProvider acceso={{ ...base, permissions: ['closures.sign'] }}><Muestra /></PermisosProvider>)
    expect(screen.getByText('puede')).toBeInTheDocument()
  })
  it('sin el permiso, no', () => {
    render(<PermisosProvider acceso={{ ...base, permissions: ['operations.read'] }}><Muestra /></PermisosProvider>)
    expect(screen.getByText('no puede')).toBeInTheDocument()
  })
})
