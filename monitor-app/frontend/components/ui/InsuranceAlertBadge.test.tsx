import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InsuranceAlertBadge } from './InsuranceAlertBadge'

describe('InsuranceAlertBadge', () => {
  // Seguros E1 (15/10): la API dice EXPIRING, el nombre del glosario; un solo nombre para lo mismo.
  it('EXPIRING se lee "Póliza por vencer"', () => {
    render(<InsuranceAlertBadge alert="EXPIRING" />)
    expect(screen.getByTitle('Póliza por vencer')).toHaveTextContent('Póliza por vencer')
  })

  it('las críticas se nombran por lo que bloquea', () => {
    const { rerender } = render(<InsuranceAlertBadge alert="EXPIRED" />)
    expect(screen.getByTitle('Póliza vencida')).toBeInTheDocument()
    rerender(<InsuranceAlertBadge alert="OVERDUE_INSTALLMENTS" />)
    expect(screen.getByTitle('Cuotas impagas')).toBeInTheDocument()
  })
})
