import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'
import type { TripsMeta } from '@/lib/types'

const meta = {
  statuses: [
    { id: 'CANCELADO', label: 'Cancelado', group: 'problema' },
    { id: 'VIAJE EN PREDIO', label: 'Viaje en Predio', group: 'en_local' },
  ],
  operational_states: [{ id: 'op1', label: 'Esperando descarga', group: 'en_local' }],
  tms_sources: [], operation_types: [],
} as unknown as TripsMeta

// P1.5 (Configuración, Parte 1): el estado se pinta con el tono de su columna.
describe('StatusBadge', () => {
  it('un estado en la columna Problema se ve urgente, sin colores en línea', () => {
    render(<StatusBadge status="CANCELADO" meta={meta} />)
    const chip = screen.getByText('CANCELADO')
    expect(chip).toHaveClass('text-status-incidente')
    expect(chip).not.toHaveAttribute('style')
  })

  it('"Viaje en Predio" está en En Local: tono de acción, no rojo', () => {
    render(<StatusBadge status="VIAJE EN PREDIO" meta={meta} />)
    expect(screen.getByText('VIAJE EN PREDIO')).toHaveClass('text-accion')
  })

  it('un estado operacional toma el tono de su grupo', () => {
    render(<StatusBadge status="op1" meta={meta} />)
    expect(screen.getByText('Esperando descarga')).toHaveClass('text-accion')
  })

  it('en la variante punto, el punto lleva el color del tono y el texto queda neutro', () => {
    const { container } = render(<StatusBadge status="CANCELADO" meta={meta} variante="punto" />)
    const punto = container.querySelector('span[aria-hidden] , span > span')
    expect(punto).toHaveClass('bg-status-incidente')
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('un estado que el catálogo no conoce se ve neutro', () => {
    render(<StatusBadge status="NUEVO DEL TMS" meta={meta} />)
    expect(screen.getByText('NUEVO DEL TMS')).toHaveClass('text-informativo')
  })
})
