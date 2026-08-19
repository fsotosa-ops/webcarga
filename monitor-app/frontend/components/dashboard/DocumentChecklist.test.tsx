import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DocumentChecklist, checklistCompletion } from './DocumentChecklist'

const ITEMS = [
  {
    id: 'cr1', requirement_id: 'req-cr1', requirement_code: 'POLIZA_FIRMADA', label: 'Póliza firmada', status: 'APPROVED' as const,
    requires_file: true, expiration_date: null, is_expired: false, is_expiring_soon: false, file_url: 'https://storage.example/poliza.pdf',
  },
  {
    id: 'cr2', requirement_id: 'req-cr2', requirement_code: 'CERT_VIGENCIA', label: 'Certificado de vigencia', status: 'APPROVED' as const,
    requires_file: true, expiration_date: '2026-01-01', is_expired: true, is_expiring_soon: false, file_url: null,
  },
  {
    id: 'cr3', requirement_id: 'req-cr3', requirement_code: 'ENDOSO', label: 'Endoso', status: 'MISSING' as const,
    requires_file: true, expiration_date: null, is_expired: false, is_expiring_soon: false, file_url: null,
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

  it('con politica NONE sube de una, sin preguntar nada', () => {
    const onUpload = vi.fn()
    const items = ITEMS.map(i => ({ ...i, expiration_policy: 'NONE' as const }))
    render(<DocumentChecklist items={items} canEdit={true} onUpload={onUpload} />)
    const input = screen.getByLabelText('Subir Endoso') as HTMLInputElement
    const file = new File(['x'], 'endoso.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith('cr3', file, undefined)
  })

  it('la ficha usa el MISMO gesto que Certificacion: pide la fecha antes de subir', async () => {
    const onUpload = vi.fn()
    const items = ITEMS.map(i => ({ ...i, expiration_policy: 'REQUIRED' as const }))
    render(<DocumentChecklist items={items} canEdit={true} onUpload={onUpload} />)

    fireEvent.change(screen.getByLabelText('Subir Endoso'), {
      target: { files: [new File(['x'], 'endoso.pdf', { type: 'application/pdf' })] },
    })

    // Si la ficha tuviera su propia version del gesto, no preguntaria nada.
    expect(await screen.findByLabelText(/vence el/i)).toBeInTheDocument()
    // Lo critico: NO se subio nada todavia. Subir antes de tener la fecha es
    // lo que dejaba el archivo varado con un 422 del servidor — 5 de los 12
    // requisitos de conductor y 8 de los 10 de vehiculo la exigen.
    expect(onUpload).not.toHaveBeenCalled()
  })

  it('sube recien cuando la fecha esta puesta', async () => {
    const onUpload = vi.fn()
    const items = ITEMS.map(i => ({ ...i, expiration_policy: 'REQUIRED' as const }))
    render(<DocumentChecklist items={items} canEdit={true} onUpload={onUpload} />)

    fireEvent.change(screen.getByLabelText('Subir Endoso'), {
      target: { files: [new File(['x'], 'endoso.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.change(await screen.findByLabelText(/vence el/i), { target: { value: '2027-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(
      'cr3', expect.any(File), '2027-01-31',
    ))
  })

  it('sin politica pregunta sin exigir: "no se" no se resuelve en ninguno de los dos extremos', async () => {
    const onUpload = vi.fn()
    render(<DocumentChecklist items={ITEMS} canEdit={true} onUpload={onUpload} />)

    fireEvent.change(screen.getByLabelText('Subir Endoso'), {
      target: { files: [new File(['x'], 'endoso.pdf', { type: 'application/pdf' })] },
    })

    // Pregunta...
    expect(await screen.findByLabelText(/vence el/i)).toBeInTheDocument()
    // ...pero deja guardar sin ella, que es lo unico honesto con un dato ausente.
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith('cr3', expect.any(File), undefined))
  })

  it('soltar un archivo carga lo que falta', async () => {
    const onUpload = vi.fn()
    const items = ITEMS.map(i => ({ ...i, expiration_policy: 'NONE' as const }))
    render(<DocumentChecklist items={items} canEdit={true} onUpload={onUpload} />)

    fireEvent.drop(screen.getByTitle('Endoso — pendiente'), {
      dataTransfer: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] },
    })

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith('cr3', expect.any(File), undefined))
  })

  it('soltar encima de un documento YA cargado no lo reemplaza', () => {
    const onUpload = vi.fn()
    const items = ITEMS.map(i => ({ ...i, expiration_policy: 'NONE' as const }))
    render(<DocumentChecklist items={items} canEdit={true} onUpload={onUpload} />)

    // 'Póliza firmada' ya tiene file_url. Reemplazar es un clic explicito en
    // su propio control; un arrastre accidental no puede pisar evidencia.
    fireEvent.drop(screen.getByTitle('Póliza firmada — al día'), {
      dataTransfer: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] },
    })

    expect(onUpload).not.toHaveBeenCalled()
  })

  it('un error de subida se muestra EN ESA fila', async () => {
    // `onUpload` de la ficha es async (DriverDetailPanel / VehicleDetailPanel
    // llaman al backend). Si el gesto no espera su promesa, el renglon dice
    // "listo" mientras la subida fallo, y el motivo se pierde como un rechazo
    // no manejado en la consola.
    const onUpload = vi.fn().mockRejectedValue(new Error('El archivo supera 7 MB'))
    const items = ITEMS.map(i => ({ ...i, expiration_policy: 'NONE' as const }))
    render(<DocumentChecklist items={items} canEdit={true} onUpload={onUpload} />)

    fireEvent.change(screen.getByLabelText('Subir Endoso'), {
      target: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/7 MB/)
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

  it('shows a "Ver" trigger for the uploaded file when file_url is set, regardless of canEdit', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByLabelText('Ver Póliza firmada')).toBeInTheDocument()
  })

  it('does not show a "Ver" trigger when file_url is null', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.queryByLabelText('Ver Endoso')).not.toBeInTheDocument()
  })

  it('opens the preview modal when clicking "Ver" and closes it', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Ver Póliza firmada'))
    expect(screen.getByLabelText('Cerrar')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(screen.queryByLabelText('Cerrar')).not.toBeInTheDocument()
  })

  it('does not offer PENDING_REVIEW as a selectable status (no due diligence step today)', () => {
    const noFileItems = [{ ...ITEMS[2], requires_file: false }]
    render(<DocumentChecklist items={noFileItems} canEdit={true} onStatusChange={vi.fn()} />)
    const select = screen.getByLabelText('Estado de Endoso') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).not.toContain('PENDING_REVIEW')
  })

  it('labels the expiration date so it is clear what it means', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText('Vence:')).toBeInTheDocument()
  })

  it('shows a prominent upload CTA for a record without a file, and a plain replace trigger once it has one', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={true} onUpload={vi.fn()} />)
    expect(screen.getByLabelText('Subir Endoso')).toBeInTheDocument()
    expect(screen.getByLabelText('Reemplazar Póliza firmada')).toBeInTheDocument()
    expect(screen.queryByLabelText('Subir Póliza firmada')).not.toBeInTheDocument()
  })

  it('deletes the file from the preview modal and calls onDelete with the record id', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(<DocumentChecklist items={ITEMS} canEdit={true} onUpload={vi.fn()} onDelete={onDelete} />)

    fireEvent.click(screen.getByLabelText('Ver Póliza firmada'))
    fireEvent.click(screen.getByLabelText('Eliminar Póliza firmada'))
    fireEvent.click(screen.getByText('Sí'))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('cr1'))
  })

  it('does not offer delete inside the preview modal for a non-editor', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Ver Póliza firmada'))
    expect(screen.queryByLabelText(/Eliminar/)).not.toBeInTheDocument()
  })
})
