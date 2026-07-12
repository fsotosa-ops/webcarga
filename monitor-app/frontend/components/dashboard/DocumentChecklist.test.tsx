import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentChecklist, checklistCompletion } from './DocumentChecklist'

const ITEMS = [
  { doc_code: 'poliza_firmada', label: 'Póliza firmada', status: 'ok' as const, expiry_date: null, has_expiry: false },
  { doc_code: 'certificado_vigencia', label: 'Certificado de vigencia', status: 'actualizar' as const, expiry_date: '2026-01-01', has_expiry: true },
  { doc_code: 'endoso', label: 'Endoso', status: null, expiry_date: null, has_expiry: false },
]

describe('DocumentChecklist', () => {
  it('renders one node per document with its label', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText('Póliza firmada')).toBeInTheDocument()
    expect(screen.getByText('Certificado de vigencia')).toBeInTheDocument()
    expect(screen.getByText('Endoso')).toBeInTheDocument()
  })

  it('marks ok documents with a check and pending ones without', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Póliza firmada — al día')).toBeInTheDocument()
    expect(screen.getByTitle('Endoso — pendiente')).toBeInTheDocument()
  })

  it('marks a document with status actualizar as vencido', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Certificado de vigencia — vencido')).toBeInTheDocument()
  })

  it('calls onUpload with the doc_code and the chosen file when canEdit is true', () => {
    const onUpload = vi.fn()
    render(<DocumentChecklist items={ITEMS} canEdit={true} onUpload={onUpload} />)
    const input = screen.getByLabelText('Subir Endoso') as HTMLInputElement
    const file = new File(['x'], 'endoso.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith('endoso', file)
  })

  it('does not render an upload control when canEdit is false', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.queryByLabelText('Subir Endoso')).not.toBeInTheDocument()
  })

  it('shows a completion count', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText('1 de 3 completos')).toBeInTheDocument()
  })

  it('shows a status select instead of an upload control when onStatusChange is provided', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={true} onStatusChange={vi.fn()} />)
    expect(screen.queryByLabelText('Subir Endoso')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Estado de Endoso')).toBeInTheDocument()
  })

  it('calls onStatusChange with the doc_code and the new status', () => {
    const onStatusChange = vi.fn()
    render(<DocumentChecklist items={ITEMS} canEdit={true} onStatusChange={onStatusChange} />)
    fireEvent.change(screen.getByLabelText('Estado de Endoso'), { target: { value: 'ok' } })
    expect(onStatusChange).toHaveBeenCalledWith('endoso', 'ok')
  })

  it('does not show a status select when canEdit is false, even with onStatusChange provided', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onStatusChange={vi.fn()} />)
    expect(screen.queryByLabelText('Estado de Endoso')).not.toBeInTheDocument()
  })

  it('hides the completion count when hideCounter is true', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} hideCounter />)
    expect(screen.queryByText('1 de 3 completos')).not.toBeInTheDocument()
  })

  it('checklistCompletion counts ok documents against the total', () => {
    expect(checklistCompletion(ITEMS)).toEqual({ ok: 1, total: 3 })
  })
})
