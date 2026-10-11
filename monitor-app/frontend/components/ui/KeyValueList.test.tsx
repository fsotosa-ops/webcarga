import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KeyValueList } from './KeyValueList'

describe('KeyValueList', () => {
  it('pareja cada rótulo con su valor, en una lista de definiciones', () => {
    render(<KeyValueList items={[{ label: 'Empresa', value: 'Bugarín' }, { label: 'Teléfono', value: 'Sin teléfono' }]} />)
    const terms = screen.getAllByRole('term').map(t => t.textContent)
    const values = screen.getAllByRole('definition').map(d => d.textContent)
    expect(terms).toEqual(['Empresa', 'Teléfono'])
    expect(values).toEqual(['Bugarín', 'Sin teléfono'])
  })
})
