import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AjustesPosterioresAlCierre } from './AjustesPosterioresAlCierre'
import type { AjustePosterior } from '@/lib/types'

const ajuste = (x: Partial<AjustePosterior>): AjustePosterior => ({
  trip_id: 't1', tipo: 'agregado', source_system_trip_id: 'M-1', client_name: 'Iansa',
  voided_at: null, voided_by_name: null, void_reason: null, ...x,
})

describe('AjustesPosterioresAlCierre', () => {
  it('no dice nada cuando no cambió nada', () => {
    const { container } = render(<AjustesPosterioresAlCierre ajustes={[]} volverA="/x" />)
    expect(container).toBeEmptyDOMElement()
  })

  // El día NO se reabre: la firma sigue siendo verdadera sobre lo que existía
  // cuando se firmó. Esto es un ajuste, y "reabierto" sería mentir.
  it('no dice que el día se reabrió', () => {
    render(<AjustesPosterioresAlCierre ajustes={[ajuste({})]} volverA="/x" />)
    expect(screen.queryByText(/reabiert/i)).toBeNull()
    expect(screen.getByText(/posterior al cierre/i)).toBeInTheDocument()
  })

  it('dice qué viaje entró y cuál salió, con el motivo de la anulación', () => {
    render(<AjustesPosterioresAlCierre volverA="/x" ajustes={[
      ajuste({ trip_id: 'a', tipo: 'agregado', source_system_trip_id: 'Q-9' }),
      ajuste({ trip_id: 'b', tipo: 'quitado', source_system_trip_id: 'M-2', voided_at: '2026-10-10T20:00:00Z',
               voided_by_name: 'Ana Pérez', void_reason: 'Duplicado' }),
    ]} />)
    expect(screen.getByText(/Q-9/)).toBeInTheDocument()
    expect(screen.getByText(/agregado/i)).toBeInTheDocument()
    expect(screen.getByText(/anulado/i)).toBeInTheDocument()
    expect(screen.getByText(/duplicado/i)).toBeInTheDocument()
  })

  it('cada viaje lleva a su detalle y vuelve al Cierre', () => {
    render(<AjustesPosterioresAlCierre ajustes={[ajuste({ trip_id: 'a' })]} volverA="/dashboard/operations/closures?fecha=2026-09-23" />)
    const link = screen.getByRole('link', { name: /ver viaje/i })
    expect(link.getAttribute('href')).toContain('/trips/a')
    expect(link.getAttribute('href')).toContain(encodeURIComponent('/dashboard/operations/closures'))
  })
})
