import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ColumnsMenu } from './ColumnsMenu'

const COLUMNAS = [
  { column: { id: 'nombre', header: 'Conductor', value: () => null, hideable: false }, visible: true },
  { column: { id: 'empresa', header: 'Empresa', value: () => null }, visible: true },
  { column: { id: 'viaje', header: 'Nº viaje', value: () => null }, visible: false },
]

function abrir(onChange = vi.fn(), onReset = vi.fn()) {
  render(<ColumnsMenu columns={COLUMNAS} onChange={onChange} onReset={onReset} />)
  fireEvent.click(screen.getByRole('button', { name: 'Columnas' }))
  return { menu: screen.getByRole('dialog', { name: 'Columnas' }), onChange, onReset }
}

describe('ColumnsMenu', () => {
  it('lista las columnas en orden; la que identifica la fila no se oculta', () => {
    const { menu } = abrir()
    expect(within(menu).getAllByRole('listitem').map(li => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Conductor'), expect.stringContaining('Empresa')]))
    expect(within(menu).queryByRole('checkbox', { name: 'Mostrar Conductor' })).toBeNull()
    expect(within(menu).getByRole('checkbox', { name: 'Mostrar Nº viaje' })).not.toBeChecked()
  })

  it('ocultar y mostrar guarda la lista completa en orden', () => {
    const { menu, onChange } = abrir()
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Mostrar Empresa' }))
    expect(onChange).toHaveBeenCalledWith([
      { id: 'nombre', hidden: false }, { id: 'empresa', hidden: true }, { id: 'viaje', hidden: true },
    ])
  })

  it('mover con los botones reordena (además del arrastre)', () => {
    const { menu, onChange } = abrir()
    fireEvent.click(within(menu).getByRole('button', { name: 'Subir Nº viaje' }))
    expect(onChange).toHaveBeenCalledWith([
      { id: 'nombre', hidden: false }, { id: 'viaje', hidden: true }, { id: 'empresa', hidden: false },
    ])
  })

  it('"Restablecer" vuelve al orden de la tabla', () => {
    const { menu, onReset } = abrir()
    fireEvent.click(within(menu).getByRole('button', { name: 'Restablecer' }))
    expect(onReset).toHaveBeenCalled()
  })
})
