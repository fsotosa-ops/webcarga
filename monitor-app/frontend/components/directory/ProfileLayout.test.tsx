import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AsidePanel, ProfileLayout } from './ProfileLayout'

// La forma de las tres fichas (maqueta del 15/10, a ancho real): la sección al
// centro y un panel fijo al costado, con los dos bordes superiores alineados.
describe('ProfileLayout', () => {
  it('P3: el centro y el costado son columnas de la misma grilla, alineadas arriba', () => {
    render(<ProfileLayout aside={<AsidePanel title="Contactos">Camila</AsidePanel>}><div>Documentos</div></ProfileLayout>)
    const aside = screen.getByRole('complementary')
    const grid = aside.parentElement!
    expect(grid).toContainElement(screen.getByText('Documentos'))
    expect(grid.className).toMatch(/items-start/)
    expect(grid.className).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_340px\]/)
    expect(screen.getByRole('region', { name: 'Contactos' })).toHaveTextContent('Camila')
  })
})
