import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CarrierCertificationTable } from './CarrierCertificationTable'
import type { CarrierCertificationRow } from '@/lib/types'

const fila = (over: Partial<CarrierCertificationRow> = {}): CarrierCertificationRow => ({
  carrier_id: 'c1', carrier_name: 'Test Empresa Webcarga', operational_status: 'ACTIVE',
  total_count: 12, satisfied_count: 9, pending_count: 3, pending_mandatory: 1,
  unclassified_count: 0, ...over,
})

describe('CarrierCertificationTable', () => {
  it('muestra el avance de cada empresa', () => {
    render(<CarrierCertificationTable rows={[fila()]} />)
    expect(screen.getByText('9 de 12')).toBeInTheDocument()
  })

  // Las dos mitades del trabajo en la misma fila: es lo que evita tener que
  // cruzar dos listas hermanas de memoria.
  it('muestra cuántos documentos llegaron sin clasificar', () => {
    render(<CarrierCertificationTable rows={[fila({ unclassified_count: 3 })]} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('marca al día a la empresa sin pendientes', () => {
    render(<CarrierCertificationTable rows={[fila({ satisfied_count: 12, pending_count: 0, pending_mandatory: 0 })]} />)
    expect(screen.getByText(/al día/i)).toBeInTheDocument()
  })

  it('avisa de los obligatorios por ley sin cubrir', () => {
    render(<CarrierCertificationTable rows={[fila({ pending_mandatory: 4 })]} />)
    expect(screen.getByTitle(/4 obligatorios por ley/i)).toBeInTheDocument()
  })

  it('la empresa lleva a su ficha, en el tab de documentos', () => {
    render(<CarrierCertificationTable rows={[fila()]} />)
    expect(screen.getByRole('link', { name: /Test Empresa Webcarga/ }))
      .toHaveAttribute('href', '/dashboard/carriers/c1?tab=documentos')
  })

  it('señala cuando la empresa no está activa', () => {
    render(<CarrierCertificationTable rows={[fila({ operational_status: 'LEGACY_INACTIVE', unclassified_count: 2 })]} />)
    expect(screen.getByText(/no activa/i)).toBeInTheDocument()
  })

  it('no deja la tabla vacía sin explicación', () => {
    render(<CarrierCertificationTable rows={[]} />)
    expect(screen.getByText(/no hay empresas/i)).toBeInTheDocument()
  })
})
