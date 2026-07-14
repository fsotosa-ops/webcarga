import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColumnMappingResolver } from './ColumnMappingResolver'
import type { UnresolvedColumn, ComplianceDocCatalogEntry } from '@/lib/types'

const unresolved: UnresolvedColumn[] = [
  { sheet: 'Empresas', header: 'Cuenta Banco Empresa' },
]
const catalog: ComplianceDocCatalogEntry[] = [
  { doc_code: 'rol_sii', entity_type: 'transporter', label: 'Rol SII' },
  { doc_code: 'cuenta_empresa', entity_type: 'transporter', label: 'Cuenta de la empresa' },
]

describe('ColumnMappingResolver', () => {
  it('disables submit until every column has a resolution', () => {
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={vi.fn()} submitting={false} />)
    expect(screen.getByText(/Confirmar y continuar/)).toBeDisabled()
  })

  it('submits a "map" resolution when an existing doc_code is chosen', () => {
    const onSubmit = vi.fn()
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={onSubmit} submitting={false} />)
    fireEvent.change(screen.getByLabelText('Mapeo para Cuenta Banco Empresa'), { target: { value: 'cuenta_empresa' } })
    fireEvent.click(screen.getByText(/Confirmar y continuar/))
    expect(onSubmit).toHaveBeenCalledWith([
      { sheet: 'Empresas', header: 'Cuenta Banco Empresa', action: 'map', doc_code: 'cuenta_empresa' },
    ])
  })

  it('submits an "ignore" resolution', () => {
    const onSubmit = vi.fn()
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={onSubmit} submitting={false} />)
    fireEvent.click(screen.getByLabelText('Ignorar Cuenta Banco Empresa'))
    fireEvent.click(screen.getByText(/Confirmar y continuar/))
    expect(onSubmit).toHaveBeenCalledWith([
      { sheet: 'Empresas', header: 'Cuenta Banco Empresa', action: 'ignore' },
    ])
  })

  it('submits a "create" resolution with doc_code and label', () => {
    const onSubmit = vi.fn()
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={onSubmit} submitting={false} />)
    fireEvent.click(screen.getByText('+ Nuevo tipo de documento'))
    fireEvent.change(screen.getByLabelText('Código para Cuenta Banco Empresa'), { target: { value: 'cuenta_banco_empresa' } })
    fireEvent.change(screen.getByLabelText('Etiqueta para Cuenta Banco Empresa'), { target: { value: 'Cuenta Banco Empresa' } })
    fireEvent.click(screen.getByText(/Confirmar y continuar/))
    expect(onSubmit).toHaveBeenCalledWith([
      { sheet: 'Empresas', header: 'Cuenta Banco Empresa', action: 'create', doc_code: 'cuenta_banco_empresa', label: 'Cuenta Banco Empresa' },
    ])
  })
})
