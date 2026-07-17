import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertStatTiles, type AlertStatTile } from './AlertStatTiles'

const TILES: AlertStatTile[] = [
  { id: '', label: 'Todas', value: 10, tone: 'neutral' },
  { id: 'PENDING', label: 'Pendientes', value: 3, tone: 'danger' },
  { id: 'OK', label: 'Al día', value: 7, tone: 'success' },
]

describe('AlertStatTiles', () => {
  it('renders every tile with its value and label', () => {
    render(<AlertStatTiles tiles={TILES} active="" onSelect={vi.fn()} />)
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('Todas')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Pendientes')).toBeInTheDocument()
  })

  it('calls onSelect with the tile id when clicked', () => {
    const onSelect = vi.fn()
    render(<AlertStatTiles tiles={TILES} active="" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Pendientes').closest('button')!)
    expect(onSelect).toHaveBeenCalledWith('PENDING')
  })

  it('marks the active tile as pressed', () => {
    render(<AlertStatTiles tiles={TILES} active="PENDING" onSelect={vi.fn()} />)
    expect(screen.getByText('Pendientes').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Todas').closest('button')).toHaveAttribute('aria-pressed', 'false')
  })
})
