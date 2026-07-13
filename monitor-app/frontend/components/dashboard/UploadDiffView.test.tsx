import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UploadDiffView } from './UploadDiffView'
import type { CentralizerDiff } from '@/lib/types'

const diff: CentralizerDiff = {
  transporters: [
    {
      entity_key: '11111111', match_method: null, existing_id: null, change_type: 'new',
      field_diffs: [], conflict_reason: null, parsed_row: { business_name: 'Transportes Nueva SPA' },
    },
    {
      entity_key: '22222222', match_method: 'rut', existing_id: 't-1', change_type: 'updated',
      field_diffs: [{ field: 'business_name', old: 'Nombre Viejo', new: 'Nombre Nuevo', conflict: false }],
      conflict_reason: null, parsed_row: { business_name: 'Nombre Nuevo' },
    },
    {
      entity_key: '33333333', match_method: 'rut', existing_id: 't-2', change_type: 'conflict',
      field_diffs: [{ field: 'business_name', old: 'A', new: 'B', conflict: true }],
      conflict_reason: 'manually_edited_field', parsed_row: { business_name: 'B' },
    },
    {
      entity_key: '44444444', match_method: 'rut', existing_id: 't-3', change_type: 'unchanged',
      field_diffs: [], conflict_reason: null, parsed_row: { business_name: 'Sin Cambios SPA' },
    },
  ],
  drivers: [], vehicles: [],
  parse_errors: [{ sheet: 'Conductores', row: 5, reason: 'RUT vacío' }],
}

describe('UploadDiffView', () => {
  it('shows the summary chips with correct counts', () => {
    render(<UploadDiffView diff={diff} />)
    expect(screen.getByText('Nuevas 1')).toBeInTheDocument()
    expect(screen.getByText('Modificadas 1')).toBeInTheDocument()
    expect(screen.getByText('Conflictos 1')).toBeInTheDocument()
    expect(screen.getByText('Sin cambios 1')).toBeInTheDocument()
    expect(screen.getByText('Errores 1')).toBeInTheDocument()
  })

  it('defaults to the Nuevas tab and shows only new rows', () => {
    render(<UploadDiffView diff={diff} />)
    expect(screen.getByText('Transportes Nueva SPA')).toBeInTheDocument()
    expect(screen.queryByText('Nombre Nuevo')).not.toBeInTheDocument()
  })

  it('switches to Conflictos and expands a card to show the conflicting field', () => {
    render(<UploadDiffView diff={diff} />)
    fireEvent.click(screen.getByText('Conflictos'))
    expect(screen.getByText('B')).toBeInTheDocument()
    fireEvent.click(screen.getByText('B'))
    expect(screen.getByText(/A → B/)).toBeInTheDocument()
    expect(screen.getByText(/conflicto — no se aplica/)).toBeInTheDocument()
  })

  it('shows parse errors in the Errores tab', () => {
    render(<UploadDiffView diff={diff} />)
    fireEvent.click(screen.getByText('Errores'))
    expect(screen.getByText(/RUT vacío/)).toBeInTheDocument()
  })
})
