import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HistorialDeFirmas } from './HistorialDeFirmas'
import type { FirmaDelDia } from '@/lib/types'

const firma = (x: Partial<FirmaDelDia>): FirmaDelDia => ({
  version: 1, signed_at: '2026-09-24T01:51:08Z', signed_by_name: 'Cristian Castillo',
  override_count: 0, totals: { viajes: 38 }, captured_from: 'backfill', ...x,
})

describe('HistorialDeFirmas', () => {
  it('con una sola firma no muestra historial', () => {
    const { container } = render(<HistorialDeFirmas firmas={[firma({})]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('con varias, lista cada versión con quién firmó', () => {
    render(<HistorialDeFirmas firmas={[
      firma({ version: 2, signed_by_name: 'Ana Pérez', captured_from: 'signing' }),
      firma({ version: 1 }),
    ]} />)
    expect(screen.getByText(/versión 2/i)).toBeInTheDocument()
    expect(screen.getByText(/versión 1/i)).toBeInTheDocument()
    expect(screen.getByText(/ana pérez/i)).toBeInTheDocument()
    expect(screen.getByText(/cristian castillo/i)).toBeInTheDocument()
  })
})
