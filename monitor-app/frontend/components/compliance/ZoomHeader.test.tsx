import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ZoomHeader } from './ZoomHeader'

describe('ZoomHeader', () => {
  it('muestra dónde estás y cómo volver', () => {
    const onIr = vi.fn()
    render(<ZoomHeader
      migas={[{ label: 'Certificación' }, { label: 'Transportes Sur', onIr },
              { label: 'Juan Pérez' }]}
      titulo="Juan Pérez" cubiertos={0} total={12}
    />)
    // El último es dónde estás: no se puede volver a sí mismo.
    expect(screen.queryByRole('button', { name: 'Juan Pérez' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Transportes Sur' }))
    expect(onIr).toHaveBeenCalled()
  })

  // Las migas cambian el panel, no la página: por eso son botones y no enlaces.
  it('las migas no navegan', () => {
    render(<ZoomHeader
      migas={[{ label: 'Certificación', onIr: vi.fn() }, { label: 'ACME' }]}
      titulo="ACME" cubiertos={9} total={12}
    />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('dice cuánto le falta', () => {
    render(<ZoomHeader migas={[]} titulo="ACME" cubiertos={9} total={12} />)
    expect(screen.getByText('9 de 12')).toBeInTheDocument()
  })

  it('sin requisitos no inventa un porcentaje', () => {
    render(<ZoomHeader migas={[]} titulo="ACME" cubiertos={0} total={0} />)
    expect(screen.getByText(/sin requisitos/i)).toBeInTheDocument()
    expect(screen.queryByText('0 de 0')).not.toBeInTheDocument()
  })

  it('deja poner acciones propias del nivel', () => {
    render(<ZoomHeader
      migas={[]} titulo="ACME" cubiertos={1} total={2}
      acciones={<button type="button">Dar de baja</button>}
    />)
    expect(screen.getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument()
  })

  it('muestra un subtítulo cuando hay contexto que agregar', () => {
    render(<ZoomHeader migas={[]} titulo="HKXW55" subtitulo="Tracto" cubiertos={1} total={2} />)
    expect(screen.getByText('Tracto')).toBeInTheDocument()
  })
})
