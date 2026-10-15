import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransporterCard } from './TransporterCard'
import type { CarrierListItem } from '@/lib/types'
import { complianceSummary } from '@/lib/states.fixtures'

const ITEM: CarrierListItem = {
  id: 't1', tax_id: '11111111-1', country_code: 'CL', business_name: 'Transportes Test',
  operational_status: 'ACTIVE', total_requirements: 12, last_document_update: '2026-06-01',
  compliance_summary: complianceSummary(),
}

describe('TransporterCard', () => {
  it('renders name and tax_id', () => {
    render(<TransporterCard item={ITEM} />)
    expect(screen.getByText('Transportes Test')).toBeInTheDocument()
    expect(screen.getByText('11111111-1')).toBeInTheDocument()
  })

  it('dos chips: ciclo de vida y habilitación', () => {
    render(<TransporterCard item={ITEM} />)
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Habilitada')).toHaveClass('text-resuelto')
  })

  it('una activa con obligatorios vencidos dice No habilitada, en rojo', () => {
    render(<TransporterCard item={{ ...ITEM, compliance_summary: complianceSummary({ worst_state: 'OVERDUE', can_operate: false }) }} />)
    expect(screen.getByText('No habilitada')).toHaveClass('text-status-incidente')
  })

  it('una dada de baja no se ve en rojo (las 205 LEGACY, §1)', () => {
    render(<TransporterCard item={{ ...ITEM, operational_status: 'LEGACY_INACTIVE', compliance_summary: complianceSummary({ worst_state: 'MISSING', can_operate: false }) }} />)
    expect(screen.getByText('No habilitada')).toHaveClass('text-informativo')
  })

  // El resumen aparte (TransporterSlideOver) se retiró el 15/10: la tarjeta lleva a la ficha.
  it('la tarjeta entera es un enlace a la ficha, con la lista para volver', () => {
    render(<TransporterCard item={ITEM} returnTo="/dashboard/carriers?q=test" />)
    expect(screen.getByRole('link', { name: /Transportes Test/ }))
      .toHaveAttribute('href', `/dashboard/carriers/t1?next=${encodeURIComponent('/dashboard/carriers?q=test')}`)
  })

  it('renders a placeholder for a company with no name', () => {
    render(<TransporterCard item={{ ...ITEM, business_name: '' }} />)
    expect(screen.getByText('Sin nombre')).toBeInTheDocument()
  })

  it('shows Dada de baja for legacy_inactive companies (concept exposed to the user is Activo/Inactivo, not Activo/Legacy)', () => {
    render(<TransporterCard item={{ ...ITEM, operational_status: 'LEGACY_INACTIVE' }} />)
    expect(screen.getByText('Dada de baja')).toBeInTheDocument()
  })

  it('shows an amber Onboarding badge for companies created without tax_id', () => {
    render(<TransporterCard item={{ ...ITEM, operational_status: 'ONBOARDING' }} />)
    const badge = screen.getByText('En onboarding')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('text-warning')
  })
})
