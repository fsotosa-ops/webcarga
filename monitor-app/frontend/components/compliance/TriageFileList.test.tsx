import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ComponentProps } from 'react'
import { TriageFileList } from './TriageFileList'

const ITEMS = [
  { id: 'i1', file_name: 'IMG_9001.png', mime_type: 'image/png', size_bytes: 10,
    storage_path: 's/1', match_status: 'UNMATCHED' as const, preview_url: 'https://x/1' },
  { id: 'i2', file_name: 'IMG_9002.png', mime_type: 'image/png', size_bytes: 10,
    storage_path: 's/2', match_status: 'UNMATCHED' as const, preview_url: 'https://x/2' },
]

function setup(over: Record<string, unknown> = {}) {
  const props = {
    items: ITEMS, focusedId: 'i1', selectedIds: new Set<string>(),
    onFocus: vi.fn(), onToggle: vi.fn(), onToggleAll: vi.fn(), onDiscard: vi.fn(),
    ...over,
  }
  render(<TriageFileList {...(props as unknown as ComponentProps<typeof TriageFileList>)} />)
  return props
}

describe('TriageFileList', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista los archivos con su casilla', () => {
    setup()
    expect(screen.getByText('IMG_9001.png')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3) // 2 filas + "todos"
  })

  it('marca un archivo al hacer clic en su casilla', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /IMG_9001/i }))
    expect(p.onToggle).toHaveBeenCalledWith('i1')
  })

  it('marca todos de una vez', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /todos/i }))
    expect(p.onToggleAll).toHaveBeenCalled()
  })

  it('mueve el foco con las flechas', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(p.onFocus).toHaveBeenCalledWith('i2')
  })

  it('marca con la barra espaciadora', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: ' ' })
    expect(p.onToggle).toHaveBeenCalledWith('i1')
  })

  it('descarta con Delete', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Delete' })
    expect(p.onDiscard).toHaveBeenCalledWith('i1')
  })

  it('avisa cuando no queda nada por clasificar', () => {
    setup({ items: [] })
    expect(screen.getByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  })
})
