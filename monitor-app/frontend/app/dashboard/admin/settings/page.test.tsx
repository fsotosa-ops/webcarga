import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const reemplazar = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: reemplazar }) }))
let permisos: string[] = []
vi.mock('@/lib/authz/PermisosProvider', () => ({ useAcceso: () => ({ permissions: permisos }) }))
vi.mock('./SettingsIndex', () => ({ SettingsIndex: () => <nav aria-label="Configuración">índice</nav> }))
vi.mock('./BuscadorConfig', () => ({ BuscadorConfig: () => null }))

import ConfiguracionPage from './page'

function pantalla(escritorio: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: escritorio }) as never
}

beforeEach(() => { reemplazar.mockClear(); permisos = ['operations.configure'] })

describe('/settings', () => {
  it('P1.8: en el teléfono muestra el índice y no salta a ninguna sección', () => {
    pantalla(false)
    render(<ConfiguracionPage />)
    expect(screen.getByRole('navigation', { name: 'Configuración' })).toBeInTheDocument()
    expect(reemplazar).not.toHaveBeenCalled()
  })

  it('en escritorio abre la primera sección que la persona puede ver', () => {
    pantalla(true)
    render(<ConfiguracionPage />)
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/operations/tms-statuses')
  })

  it('con solo certification.configure, la primera es de Certificación', () => {
    pantalla(true); permisos = ['certification.configure']
    render(<ConfiguracionPage />)
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/certification/conditions')
  })

  it('aterriza en la primera sección que la persona puede editar, no en una de solo lectura', () => {
    pantalla(true); permisos = ['commercial.edit']
    render(<ConfiguracionPage />)
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/operations/origins')
    reemplazar.mockClear(); permisos = ['insurance.configure']
    render(<ConfiguracionPage />)
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/insurance/expiry-alerts')
  })
})

