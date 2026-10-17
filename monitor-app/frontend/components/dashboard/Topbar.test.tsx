import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const menu = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('./MobileNav', () => ({ useMobileMenu: () => ({ open: menu.open, close: vi.fn(), isOpen: false }) }))
vi.mock('next/image', () => ({ default: (p: { src: string; alt: string }) => <img src={p.src} alt={p.alt} /> }))

import Topbar from './Topbar'

describe('Topbar (N7)', () => {
  it('usa el logo oficial completo sobre el fondo de la barra lateral, sin escribir "WebCarga" a mano', () => {
    const { container } = render(<Topbar displayName="Óscar Operaciones" roleName="Supervisor de Operaciones" />)
    expect(screen.getByRole('img', { name: 'WebCarga' })).toHaveAttribute('src', '/brand/webcarga-logo.png')
    expect(container.querySelector('header')).toHaveClass('bg-sidebar')
    expect(container.textContent).not.toMatch(/WebCarga/)
  })

  it('el avatar abre el menú', () => {
    render(<Topbar displayName="Óscar Operaciones" roleName="Supervisor de Operaciones" />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de Óscar Operaciones, Supervisor de Operaciones' }))
    expect(menu.open).toHaveBeenCalled()
  })
})
