import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RegionCityPicker, CHILE_REGIONS } from './RegionCityPicker'

describe('RegionCityPicker', () => {
  it('lista las 16 regiones de Chile', () => {
    render(<RegionCityPicker region={null} city={null} onChange={vi.fn()} />)
    const select = screen.getByLabelText('Región') as HTMLSelectElement
    // 16 regiones + opción vacía
    expect(select.options.length).toBe(17)
    expect(CHILE_REGIONS.length).toBe(16)
  })

  it('ciudad deshabilitada hasta elegir región; luego lista sus ciudades', () => {
    const { rerender } = render(<RegionCityPicker region={null} city={null} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Ciudad')).toBeDisabled()

    rerender(<RegionCityPicker region="Región Metropolitana de Santiago" city={null} onChange={vi.fn()} />)
    const citySelect = screen.getByLabelText('Ciudad') as HTMLSelectElement
    expect(citySelect).not.toBeDisabled()
    const values = Array.from(citySelect.options).map(o => o.value)
    expect(values).toContain('San Bernardo')
    expect(values).not.toContain('Concepción') // de otra región
  })

  it('cambiar la región resetea la ciudad', () => {
    const onChange = vi.fn()
    render(<RegionCityPicker region="Biobío" city="Concepción" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Región'), { target: { value: 'Antofagasta' } })
    expect(onChange).toHaveBeenCalledWith('Antofagasta', null)
  })

  it('conserva valores desconocidos como opción extra (data vieja)', () => {
    render(<RegionCityPicker region="Región Metropolitana de Santiago" city="Ciudad Fantasma" onChange={vi.fn()} />)
    const citySelect = screen.getByLabelText('Ciudad') as HTMLSelectElement
    expect(citySelect.value).toBe('Ciudad Fantasma')
  })
})
