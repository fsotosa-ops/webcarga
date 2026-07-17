import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentChecklist, checklistCompletion } from './DocumentChecklist'

const ITEMS = [
  {
    id: 'cr1', requirement_code: 'POLIZA_FIRMADA', label: 'Póliza firmada', status: 'APPROVED' as const,
    requires_file: true, expiration_date: null, is_expired: false, is_expiring_soon: false,
  },
  {
    id: 'cr2', requirement_code: 'CERT_VIGENCIA', label: 'Certificado de vigencia', status: 'APPROVED' as const,
    requires_file: true, expiration_date: '2026-01-01', is_expired: true, is_expiring_soon: false,
  },
  {
    id: 'cr3', requirement_code: 'ENDOSO', label: 'Endoso', status: 'MISSING' as const,
    requires_file: true, expiration_date: null, is_expired: false, is_expiring_soon: false,
  },
]

describe('DocumentChecklist', () => {
  it('renders one node per document with its label', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText('Póliza firmada')).toBeInTheDocument()
    expect(screen.getByText('Certificado de vigencia')).toBeInTheDocument()
    expect(screen.getByText('Endoso')).toBeInTheDocument()
  })

  it('marks approved-and-not-expired documents with a check and MISSING ones as pending', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Póliza firmada — al día')).toBeInTheDocument()
    expect(screen.getByTitle('Endoso — pendiente')).toBeInTheDocument()
  })

  it('marks an approved-but-expired document as vencido', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Certificado de vigencia — vencido')).toBeInTheDocument()
  })

  it('calls onUpload with the record id and the chosen file when canEdit is true and requires_file', () => {
    const onUpload = vi.fn()
    render(<DocumentChecklist items={ITEMS} canEdit={true} onUpload={onUpload} />)
    const input = screen.getByLabelText('Subir Endoso') as HTMLInputElement
    const file = new File(['x'], 'endoso.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith('cr3', file)
  })

  it('does not render an upload control when canEdit is false', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.queryByLabelText('Subir Endoso')).not.toBeInTheDocument()
  })

  it('shows a completion count', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText('1 de 3 completos')).toBeInTheDocument()
  })

  it('shows a status select instead of an upload control for items that do not require a file', () => {
    const noFileItems = [{ ...ITEMS[2], requires_file: false }]
    render(<DocumentChecklist items={noFileItems} canEdit={true} onStatusChange={vi.fn()} />)
    expect(screen.queryByLabelText('Subir Endoso')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Estado de Endoso')).toBeInTheDocument()
  })

  it('calls onStatusChange with the record id and the new status', () => {
    const onStatusChange = vi.fn()
    const noFileItems = [{ ...ITEMS[2], requires_file: false }]
    render(<DocumentChecklist items={noFileItems} canEdit={true} onStatusChange={onStatusChange} />)
    fireEvent.change(screen.getByLabelText('Estado de Endoso'), { target: { value: 'APPROVED' } })
    expect(onStatusChange).toHaveBeenCalledWith('cr3', 'APPROVED')
  })

  it('does not show a status select when canEdit is false, even for items without file', () => {
    const noFileItems = [{ ...ITEMS[2], requires_file: false }]
    render(<DocumentChecklist items={noFileItems} canEdit={false} onStatusChange={vi.fn()} />)
    expect(screen.queryByLabelText('Estado de Endoso')).not.toBeInTheDocument()
  })

  it('hides the completion count when hideCounter is true', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} hideCounter />)
    expect(screen.queryByText('1 de 3 completos')).not.toBeInTheDocument()
  })

  it('checklistCompletion counts ok documents against the total', () => {
    expect(checklistCompletion(ITEMS)).toEqual({ ok: 1, total: 3 })
  })

  it('shows a relative expiry caption when expiration_date is set', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText(/vencido hace/)).toBeInTheDocument()
  })

  it('lets an editor set the expiration date even for a document without one yet', () => {
    const onExpirationChange = vi.fn()
    render(<DocumentChecklist items={ITEMS} canEdit={true} onUpload={vi.fn()} onExpirationChange={onExpirationChange} />)
    const input = screen.getByLabelText('Fecha de vencimiento de Póliza firmada') as HTMLInputElement
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '2027-06-01' } })
    expect(onExpirationChange).toHaveBeenCalledWith('cr1', '2027-06-01')
  })

  it('does not offer to edit the expiration date when canEdit is false', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} onExpirationChange={vi.fn()} />)
    expect(screen.queryByLabelText('Fecha de vencimiento de Póliza firmada')).not.toBeInTheDocument()
  })
})
