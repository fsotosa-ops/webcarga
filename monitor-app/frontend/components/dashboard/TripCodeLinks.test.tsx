import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TripCodeLinks } from './TripCodeLinks'
import { tripCodes } from '@/lib/tripRefs'

describe('TripCodeLinks', () => {
  it('lista todos los viajes de la fila, cada uno con su enlace (D8)', () => {
    render(<TripCodeLinks trips={[{ id: 't1', code: '2033000' }, { id: 't2', code: '2033001' }]} href={id => `/viaje/${id}`} />)
    expect(screen.getByRole('link', { name: 'Ver viaje 2033000' })).toHaveAttribute('href', '/viaje/t1')
    expect(screen.getByRole('link', { name: 'Ver viaje 2033001' })).toHaveAttribute('href', '/viaje/t2')
  })

  it('sin viajes dice que no hay, y un viaje sin Nº del TMS se nombra por su id', () => {
    const { rerender } = render(<TripCodeLinks trips={[]} href={id => id} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    rerender(<TripCodeLinks trips={[{ id: 't9', code: null }]} href={id => id} />)
    expect(screen.getByRole('link', { name: 'Ver viaje t9' })).toBeInTheDocument()
  })

  it('los valores de la columna son los Nº, uno por viaje', () => {
    expect(tripCodes([{ id: 't1', code: '30' }, { id: 't9', code: null }])).toEqual(['30', 't9'])
    expect(tripCodes(undefined)).toEqual([])
  })
})
