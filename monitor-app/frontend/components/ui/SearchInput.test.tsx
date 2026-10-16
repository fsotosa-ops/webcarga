import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SearchInput } from './SearchInput'

describe('SearchInput', () => {
  it('es un campo de búsqueda con nombre y ayuda', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} label="Buscar" placeholder="Patente o conductor…" />)
    const campo = screen.getByRole('searchbox', { name: 'Buscar' })
    expect(campo).toHaveAttribute('placeholder', 'Patente o conductor…')
    fireEvent.change(campo, { target: { value: 'bd' } })
    expect(onChange).toHaveBeenCalledWith('bd')
  })
})
