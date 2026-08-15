import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChildrenList } from './ChildrenList'

const filas = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `d${i}`, nombre: `Conductor ${i}`, tipo: 'DRIVER' as const,
  cubiertos: 0, total: 12,
}))

describe('ChildrenList', () => {
  it('muestra el avance de cada uno', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(2)} onAbrir={vi.fn()} />)
    expect(screen.getAllByText('0 de 12')).toHaveLength(2)
  })

  // Una empresa con veinte o más estiraría el panel sin límite.
  it('con flota grande pagina en vez de estirar el panel', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(45)} onAbrir={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /^Conductor \d+/ })).toHaveLength(20)
    expect(screen.getByText(/1 de 3/)).toBeInTheDocument()
  })

  it('avanza de página sin salir de la pantalla', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(45)} onAbrir={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByText(/2 de 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Conductor 20/ })).toBeInTheDocument()
  })

  it('con flota chica no muestra controles de paginación', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(3)} onAbrir={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /siguiente/i })).not.toBeInTheDocument()
  })

  // Cambia el panel, no la página: por eso son botones, no enlaces.
  it('abrir uno avisa a quién, sin navegar', () => {
    const onAbrir = vi.fn()
    render(<ChildrenList titulo="Su flota" filas={filas(2)} onAbrir={onAbrir} />)
    fireEvent.click(screen.getByRole('button', { name: /^Conductor 1/ }))
    expect(onAbrir).toHaveBeenCalledWith('DRIVER', 'd1')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('distingue conductores de vehículos', () => {
    render(<ChildrenList
      titulo="Su flota"
      filas={[{ id: 'a1', nombre: 'HKXW55', tipo: 'ASSET', cubiertos: 5, total: 10 }]}
      onAbrir={vi.fn()}
    />)
    expect(screen.getByText(/vehículo/i)).toBeInTheDocument()
  })

  it('sin flota lo dice, en vez de una lista vacía', () => {
    render(<ChildrenList titulo="Su flota" filas={[]} onAbrir={vi.fn()} />)
    expect(screen.getByText(/todavía no tiene/i)).toBeInTheDocument()
  })
})
