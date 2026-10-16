import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ColumnFilter } from './ColumnFilter'

function montar(props: Partial<Parameters<typeof ColumnFilter>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <div style={{ overflow: 'hidden', height: 10 }}>
      <ColumnFilter
        header="Empresa" kind="values" values={['Hasa Spa', 'Huemul', 'Hueraman y Cía.']} selected={[]}
        count={v => ({ 'Hasa Spa': 4, 'Huemul': 2, 'Hueraman y Cía.': 0 } as Record<string, number>)[v] ?? 0}
        onChange={onChange} {...props}
      />
    </div>,
  )
  return { onChange }
}

describe('ColumnFilter', () => {
  it('abre en un portal (no lo recorta la tabla) con la cifra de cada valor', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa' }))
    const dialogo = screen.getByRole('dialog', { name: 'Filtrar por Empresa' })
    expect(dialogo.parentElement).toBe(document.body)
    expect(within(dialogo).getByRole('checkbox', { name: 'Hasa Spa, 4' })).toBeInTheDocument()
  })

  it('busca al tipear', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en Empresa' }), { target: { value: 'hue' } })
    const opciones = within(screen.getByRole('dialog')).getAllByRole('checkbox').map(c => c.getAttribute('aria-label'))
    expect(opciones).toEqual(['Huemul, 2', 'Hueraman y Cía., 0'])
  })

  it('marcar un valor suma; "Limpiar" vacía', () => {
    const { onChange } = montar({ selected: ['Huemul'] })
    fireEvent.click(screen.getByRole('button', { name: /Filtrar por Empresa/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hasa Spa, 4' }))
    expect(onChange).toHaveBeenLastCalledWith(['Huemul', 'Hasa Spa'])
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('con algo elegido, el botón lo dice', () => {
    montar({ selected: ['Huemul'] })
    expect(screen.getByRole('button', { name: 'Filtrar por Empresa (1 elegido)' })).toBeInTheDocument()
  })

  it('Escape cierra y devuelve el foco al botón', () => {
    montar()
    const boton = screen.getByRole('button', { name: 'Filtrar por Empresa' })
    fireEvent.click(boton)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(boton)
  })

  it('las flechas recorren las opciones', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa' }))
    const buscador = screen.getByRole('searchbox')
    // Al abrir, el foco ya está en el buscador: se tipea sin un clic más.
    expect(document.activeElement).toBe(buscador)
    fireEvent.keyDown(buscador, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Hasa Spa, 4' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Huemul, 2' }))
  })

  it('"tiene / no tiene" ofrece dos opciones con su nombre', () => {
    montar({ header: 'Comentario', kind: 'presence', values: ['present', 'absent'], count: () => 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Comentario' }))
    const opciones = within(screen.getByRole('dialog')).getAllByRole('checkbox').map(c => c.getAttribute('aria-label'))
    expect(opciones).toEqual(['Tiene, 1', 'No tiene, 1'])
  })
})
