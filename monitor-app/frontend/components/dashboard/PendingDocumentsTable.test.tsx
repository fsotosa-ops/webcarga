import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PendingDocumentsTable } from './PendingDocumentsTable'
import type { PendingComplianceRow } from '@/lib/types'

function makeRow(overrides: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'r1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', carrier_tax_id: '76.111.111-1',
    carrier_operation_types: ['Tractoreo'], certification_type: 'BASICA', category: 'CHOFER',
    entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Perez',
    requirement_code: 'LICENCIA_CONDUCIR', document_name: 'Licencia conducir',
    status: 'MISSING', expiration_date: null,
    ...overrides,
  }
}

const BASE_PROPS = {
  onToggle: vi.fn(), onToggleAll: vi.fn(), onUploadSingle: vi.fn(),
  onOpenBulkUpload: vi.fn(), onOpenCompanyPanel: vi.fn(),
}

describe('PendingDocumentsTable', () => {
  it('renders a placeholder when there are no pending rows', () => {
    render(<PendingDocumentsTable rows={[]} selected={new Set()} {...BASE_PROPS} />)
    expect(screen.getByText('Sin documentos pendientes')).toBeInTheDocument()
  })

  it('renders EETT, categoría, sub categoría, tipo de documento and the operation type chip', () => {
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} />)
    expect(screen.getByText('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
    expect(screen.getByText('CHOFER')).toBeInTheDocument()
    expect(screen.getByText('Juan Perez')).toBeInTheDocument()
    expect(screen.getByText('Licencia conducir')).toBeInTheDocument()
  })

  it('does not show the bulk action bar when nothing is selected', () => {
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} />)
    expect(screen.queryByText('Subir masivo')).not.toBeInTheDocument()
  })

  it('enables "Subir masivo" only when the whole selection is a single carrier', () => {
    const rows = [makeRow({ id: 'r1', carrier_id: 'c1' }), makeRow({ id: 'r2', carrier_id: 'c1' })]
    render(<PendingDocumentsTable rows={rows} selected={new Set(['r1', 'r2'])} {...BASE_PROPS} />)
    expect(screen.getByRole('button', { name: 'Subir masivo' })).toBeEnabled()
  })

  it('disables "Subir masivo" and warns when the selection spans multiple carriers', () => {
    const rows = [makeRow({ id: 'r1', carrier_id: 'c1' }), makeRow({ id: 'r2', carrier_id: 'c2', carrier_name: 'Otra Empresa' })]
    render(<PendingDocumentsTable rows={rows} selected={new Set(['r1', 'r2'])} {...BASE_PROPS} />)
    expect(screen.getByRole('button', { name: 'Subir masivo' })).toBeDisabled()
    expect(screen.getByText('La carga masiva solo puede ser de una empresa a la vez')).toBeInTheDocument()
  })

  it('calls onToggle when a row checkbox is clicked', () => {
    const onToggle = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText('Seleccionar Licencia conducir de Juan Perez'))
    expect(onToggle).toHaveBeenCalledWith('r1')
  })

  it('calls onToggleAll when the header checkbox is clicked', () => {
    const onToggleAll = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onToggleAll={onToggleAll} />)
    fireEvent.click(screen.getByLabelText('Seleccionar todo'))
    expect(onToggleAll).toHaveBeenCalled()
  })

  it('calls onUploadSingle with the record id and the chosen file', () => {
    const onUploadSingle = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onUploadSingle={onUploadSingle} />)
    const file = new File(['x'], 'licencia.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Archivo para Licencia conducir'), { target: { files: [file] } })
    expect(onUploadSingle).toHaveBeenCalledWith('r1', file)
  })

  it('calls onOpenBulkUpload when "Subir masivo" is clicked and enabled', () => {
    const onOpenBulkUpload = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set(['r1'])} {...BASE_PROPS} onOpenBulkUpload={onOpenBulkUpload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Subir masivo' }))
    expect(onOpenBulkUpload).toHaveBeenCalled()
  })

  it('calls onOpenCompanyPanel with the carrier id when the company name is clicked', () => {
    const onOpenCompanyPanel = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onOpenCompanyPanel={onOpenCompanyPanel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transportes Sur Spa' }))
    expect(onOpenCompanyPanel).toHaveBeenCalledWith('c1')
  })
})
