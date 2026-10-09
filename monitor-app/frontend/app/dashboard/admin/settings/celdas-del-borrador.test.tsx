import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { RequirementOption } from '@/lib/types'
import { CeldaExigible, CeldaNivel, CeldaRenovacion } from './celdas-del-borrador'

const REQ = {
  id: 'r1', requirement_code: 'DOC', name: 'Doc', target_entity: 'CARRIER',
  requirement_level: 'LEGAL_MANDATORY', expiration_policy: 'NONE', is_active: true,
} as RequirementOption

describe('CeldaNivel', () => {
  it('un tercer valor NO se colapsa: se muestra y no se toca', () => {
    render(<CeldaNivel requisito={REQ} valor="SHIPPER_REQUIRED" puedeEditar onCambiar={vi.fn()} />)
    expect(screen.getByText('SHIPPER_REQUIRED')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('alterna entre obligatorio y opcional', () => {
    const onCambiar = vi.fn()
    render(<CeldaNivel requisito={REQ} valor="LEGAL_MANDATORY" puedeEditar onCambiar={onCambiar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar Doc a opcional' }))
    expect(onCambiar).toHaveBeenCalledWith('CONDITIONAL_OPTIONAL')
  })
})

describe('CeldaRenovacion', () => {
  it('una regla que la celda no sabe escribir se muestra tal cual', () => {
    render(
      <CeldaRenovacion
        requisito={REQ} puedeEditar onCambiar={vi.fn()}
        vigencia={{ politica: 'ISSUE_PLUS_MONTHS', validity_months: 6 }}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Cómo se renueva Doc' })).toHaveDisplayValue('Cada 6 meses')
  })
})

describe('CeldaExigible', () => {
  it('a una empresa no le ofrece lo que es solo de conductor', () => {
    render(<CeldaExigible requisito={REQ} valor="ON_ENTITY_START" puedeEditar onCambiar={vi.fn()} />)
    expect(screen.queryByRole('option', { name: 'Al término' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Solo si se pide' })).toBeInTheDocument()
  })
})
