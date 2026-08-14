import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ComponentProps } from 'react'
import { TriageFileTable } from './TriageFileTable'

const row = (id: string, carrier: string, over: Record<string, unknown> = {}) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  created_at: '2026-08-14T10:00:00Z',
  carrier_id: carrier.toLowerCase(), carrier_name: carrier,
  confidence: null, suggested_requirement_name: null, candidate_count: 0,
  ...over,
})

const ROWS = [row('i1', 'ACME'), row('i2', 'ACME'), row('i3', 'NORTE')]

function setup(over: Record<string, unknown> = {}) {
  const props = {
    rows: ROWS, focusedId: 'i1', selectedIds: new Set<string>(),
    onFocus: vi.fn(), onToggle: vi.fn(), onToggleAll: vi.fn(),
    ...over,
  }
  render(<TriageFileTable {...(props as unknown as ComponentProps<typeof TriageFileTable>)} />)
  return props
}

describe('TriageFileTable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('agrupa las filas por empresa', () => {
    setup()
    expect(screen.getByText(/ACME — 2 sin clasificar/i)).toBeInTheDocument()
    expect(screen.getByText(/NORTE — 1 sin clasificar/i)).toBeInTheDocument()
  })

  it('muestra las columnas de la tabla', () => {
    setup()
    expect(screen.getByRole('columnheader', { name: /archivo/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /subido/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /sugerencia/i })).toBeInTheDocument()
  })

  it('sin agente, la sugerencia es un guion', () => {
    setup()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('muestra la sugerencia cuando el agente la dejo', () => {
    setup({ rows: [row('i1', 'ACME', {
      match_status: 'SUGGESTED', suggested_requirement_name: 'Padrón', confidence: 0.91,
    })] })
    expect(screen.getByText(/Padrón/)).toBeInTheDocument()
    expect(screen.getByText(/91%/)).toBeInTheDocument()
  })

  it('avisa cuantas alternativas hay si es ambiguo', () => {
    setup({ rows: [row('i1', 'ACME', { match_status: 'AMBIGUOUS', candidate_count: 3 })] })
    expect(screen.getByText(/3 posibles/i)).toBeInTheDocument()
  })

  it('shift+click selecciona el rango', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /Seleccionar i3/ }), { shiftKey: true })
    expect(p.onToggle).toHaveBeenCalledWith('i3', { range: true })
  })

  it('click sin shift no pide rango', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /Seleccionar i2/ }))
    expect(p.onToggle).toHaveBeenCalledWith('i2', undefined)
  })

  it('mueve el foco con las flechas', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('table'), { key: 'ArrowDown' })
    expect(p.onFocus).toHaveBeenCalledWith('i2')
  })

  it('marca con la barra espaciadora', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('table'), { key: ' ' })
    expect(p.onToggle).toHaveBeenCalledWith('i1', undefined)
  })

  it('avisa cuando no queda nada por clasificar', () => {
    setup({ rows: [] })
    expect(screen.getByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  })
})
