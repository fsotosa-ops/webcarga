import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CertificationStatusTable } from './CertificationStatusTable'

describe('CertificationStatusTable', () => {
  // Certificación › Requisito con la cabecera del kit (15/10), como Pendientes.
  it('la cabecera va en texto normal, sin mayúsculas', () => {
    render(<CertificationStatusTable rows={[{
      entity_id: 'r1', entity_name: 'SOAP', carrier_id: null, carrier_name: null, operational_status: null,
      total_count: 122, satisfied_count: 1, pending_count: 121, pending_mandatory: 121, unclassified_count: 0,
    } as never]} />)
    const documento = screen.getByRole('columnheader', { name: 'Documento' })
    expect(documento.className).not.toMatch(/uppercase/)
    expect(documento.className).toMatch(/text-etiqueta/)
  })
})
