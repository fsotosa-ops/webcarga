import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DocumentChecklist, type ChecklistItem } from './DocumentChecklist'

vi.mock('@/hooks/useGestoDeCarga', () => ({
  useGestoDeCarga: () => ({ propsDeZona: () => ({}), propsDeInput: () => ({}), estado: { tipo: 'inactivo' }, reintentar: vi.fn() }),
}))
vi.mock('@/components/compliance/PedirDatoDelDocumento', () => ({ PedirDatoDelDocumento: () => null }))

const base: Omit<ChecklistItem, 'id' | 'label' | 'document_state'> = {
  requirement_id: 'r', requirement_code: 'X', status: 'MISSING', requires_file: true,
  expiration_date: null, days_to_expiry: null, alert_severity: null, file_url: null,
}
const items: ChecklistItem[] = [
  { ...base, id: '1', requirement_id: 'r1', label: 'Licencia', document_state: 'MISSING' },
  { ...base, id: '2', requirement_id: 'r2', label: 'Cédula', document_state: 'UP_TO_DATE' },
  { ...base, id: '3', requirement_id: 'r3', label: 'Hoja de vida', document_state: 'OVERDUE', open_request_id: 'q1' },
]

describe('DocumentChecklist — Pedir a Certificación (Entrega B)', () => {
  it('P6: sin poder subir, ofrece pedir lo pendiente y no ofrece subir', () => {
    render(<DocumentChecklist items={items} canUpload={false} onRequest={vi.fn()} onUpload={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Pedir Licencia a Certificación' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pedir Cédula a Certificación' })).not.toBeInTheDocument()
    expect(screen.getByText('Pedido a Certificación')).toBeInTheDocument()
    expect(screen.queryByText('Subir documento')).not.toBeInTheDocument()
  })

  it('P7: mientras el pedido viaja, el botón no deja pedir de nuevo', async () => {
    let terminar: () => void = () => {}
    const onRequest = vi.fn(() => new Promise<void>(r => { terminar = r }))
    render(<DocumentChecklist items={items} canUpload={false} onRequest={onRequest} />)
    const boton = screen.getByRole('button', { name: 'Pedir Licencia a Certificación' })
    fireEvent.click(boton)
    expect(boton).toBeDisabled()
    fireEvent.click(boton)
    expect(onRequest).toHaveBeenCalledTimes(1)
    terminar()
    await waitFor(() => expect(boton).not.toBeDisabled())
  })
})
