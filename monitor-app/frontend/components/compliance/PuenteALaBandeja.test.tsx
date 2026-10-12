import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))

import { PuenteALaBandeja } from './PuenteALaBandeja'

describe('PuenteALaBandeja', () => {
  it('lleva a Sin clasificar con la empresa ya elegida', () => {
    render(<PuenteALaBandeja carrierId="c1" carrierName="ACME" />)
    expect(screen.getByRole('link', { name: 'Llévalos a Sin clasificar' }))
      .toHaveAttribute('href', '/dashboard/compliance/inbox?empresa=c1')
  })
})
