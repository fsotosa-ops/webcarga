import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CertificationStatusTable } from './CertificationStatusTable'
import type { CertificationStatusRow } from '@/lib/types'

const fila = (over: Partial<CertificationStatusRow> = {}): CertificationStatusRow => ({
  entity_id: 'c1', entity_name: 'Test Empresa Webcarga',
  carrier_id: 'c1', carrier_name: 'Test Empresa Webcarga', operational_status: 'ACTIVE',
  total_count: 12, satisfied_count: 9, pending_count: 3, pending_mandatory: 1,
  unclassified_count: 0, ...over,
})

describe('CertificationStatusTable', () => {
  it('muestra el avance de cada empresa', () => {
    render(<CertificationStatusTable rows={[fila()]} group="carrier" />)
    expect(screen.getByText('9 de 12')).toBeInTheDocument()
  })

  // Las dos mitades del trabajo en la misma fila: es lo que evita tener que
  // cruzar dos listas hermanas de memoria.
  it('muestra cuántos documentos llegaron sin clasificar', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ unclassified_count: 3 })]} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('marca al día a la empresa sin pendientes', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ satisfied_count: 12, pending_count: 0, pending_mandatory: 0 })]} />)
    expect(screen.getByText(/al día/i)).toBeInTheDocument()
  })

  it('avisa de los obligatorios por ley sin cubrir', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ pending_mandatory: 4 })]} />)
    expect(screen.getByTitle(/4 obligatorios por ley/i)).toBeInTheDocument()
  })

  it('la empresa lleva a su ficha, en el tab de documentos', () => {
    render(<CertificationStatusTable rows={[fila()]} group="carrier" />)
    expect(screen.getByRole('link', { name: /Test Empresa Webcarga/ }))
      .toHaveAttribute('href', '/dashboard/carriers/c1?tab=documentos')
  })

  it('señala cuando la empresa no está activa', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ operational_status: 'LEGACY_INACTIVE', unclassified_count: 2 })]} />)
    expect(screen.getByText(/no activa/i)).toBeInTheDocument()
  })

  it('no deja la tabla vacía sin explicación', () => {
    render(<CertificationStatusTable rows={[]} group="carrier" />)
    expect(screen.getByText(/no hay empresas/i)).toBeInTheDocument()
  })
})

// Un conductor o un vehículo sin la empresa a la que pertenece no dice nada.
describe('CertificationStatusTable — agrupada por conductor o vehículo', () => {
  const conductor = fila({
    entity_id: 'd1', entity_name: 'Juan Pérez',
    carrier_id: 'c9', carrier_name: 'Transportes Sur Spa',
  })

  it('muestra a qué empresa pertenece el conductor', () => {
    render(<CertificationStatusTable rows={[conductor]} group="driver" />)
    expect(screen.getByRole('columnheader', { name: 'Conductor' })).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Transportes Sur Spa' }))
      .toHaveAttribute('href', '/dashboard/carriers/c9?tab=documentos')
  })

  it('avisa cuando el conductor no tiene empresa asignada', () => {
    render(<CertificationStatusTable
      rows={[fila({ entity_name: 'Sin Asignar', carrier_id: null, carrier_name: null })]}
      group="driver"
    />)
    expect(screen.getByText(/sin empresa/i)).toBeInTheDocument()
  })

  it('encabeza Vehículo al agrupar por patente', () => {
    render(<CertificationStatusTable rows={[fila({ entity_name: 'HKXW55' })]} group="asset" />)
    expect(screen.getByRole('columnheader', { name: 'Vehículo' })).toBeInTheDocument()
  })

  // Un documento de la bandeja pertenece a una empresa, no a un conductor.
  it('no muestra la columna de sin clasificar fuera de empresas', () => {
    render(<CertificationStatusTable rows={[conductor]} group="driver" />)
    expect(screen.queryByRole('columnheader', { name: /sin clasificar/i })).not.toBeInTheDocument()
  })
})
