import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LogoWebCarga from './LogoWebCarga'

// El logo oficial (sacado de app.webcarga.com): blanco, para fondo oscuro; el
// isotipo (el cubo del favicon) para fondo claro, donde el blanco no se ve.
describe('LogoWebCarga', () => {
  it('completo usa el logo blanco y se nombra WebCarga', () => {
    render(<LogoWebCarga forma="completo" alto={28} />)
    const img = screen.getByRole('img', { name: 'WebCarga' })
    expect(img.getAttribute('src')).toContain('webcarga-logo.png')
    expect(img).toHaveAttribute('height', '28')
  })
  it('isotipo usa el cubo azul, para fondo claro', () => {
    render(<LogoWebCarga forma="isotipo" alto={32} />)
    expect(screen.getByRole('img', { name: 'WebCarga' }).getAttribute('src')).toContain('webcarga-icon.png')
  })
})
