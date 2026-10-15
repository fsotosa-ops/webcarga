import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Table, TableHeader, TableSection } from './Table'
import { CABECERA } from './EncabezadoOrdenable'

describe('Table (kit, Entrega 1 de fichas)', () => {
  it('K1a: el encabezado va en texto normal, como Pendientes, y no en mayúsculas', () => {
    render(
      <Table header={<TableHeader><span className="flex-1">Documento</span><span>Estado</span></TableHeader>}>
        <div>fila</div>
      </Table>,
    )
    const encabezado = screen.getByText('Documento').parentElement!
    expect(encabezado.className).not.toMatch(/uppercase/)
    expect(encabezado.className).toMatch(/text-etiqueta/)
    expect(screen.getByText('fila')).toBeInTheDocument()
  })

  it('una sección se titula con su nombre y agrupa sus filas', () => {
    render(<Table><TableSection id="s-1" title="Conductores"><div>Vidal</div></TableSection></Table>)
    expect(screen.getByRole('region', { name: 'Conductores' })).toHaveTextContent('Vidal')
  })

  it('el <th> de las tablas de verdad usa el mismo encabezado: sin mayúsculas ni 10 px', () => {
    expect(CABECERA).not.toMatch(/uppercase|text-\[10px\]/)
    expect(CABECERA).toMatch(/text-etiqueta/)
  })
})
