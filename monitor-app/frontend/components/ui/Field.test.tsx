import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field, inputClass } from './Field'

describe('inputClass', () => {
  it('el borde, el foco y el texto salen del sistema; el ancho lo pone quien lo usa', () => {
    const c = inputClass()
    expect(c).toMatch(/\bborder-border\b/)
    expect(c).toMatch(/\bfocus:ring-accent\/20\b/)
    expect(c).toMatch(/\btext-dato\b/)
    expect(c).not.toMatch(/\bw-/)
  })

  it('tres tamaños: formulario, barra y celda', () => {
    expect(inputClass({ size: 'md' })).toMatch(/\bpx-3 py-2\b/)
    expect(inputClass({ size: 'sm' })).toMatch(/\bpx-2\.5 py-1\.5\b/)
    expect(inputClass({ size: 'xs' })).toMatch(/\btext-etiqueta\b/)
  })

  it('un campo con error se pinta con el color del error', () => {
    expect(inputClass({ invalid: true })).toMatch(/\bborder-status-incidente\b/)
    expect(inputClass()).not.toMatch(/status-incidente/)
  })
})

describe('Field', () => {
  it('la etiqueta nombra al campo, y el asterisco dice que es obligatorio', () => {
    render(<Field label="Patente" required>{id => <input id={id} className={inputClass()} />}</Field>)
    expect(screen.getByRole('textbox', { name: /Patente/ })).toBeInTheDocument()
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
  })

  it('la ayuda y el error describen el campo; el error se anuncia', () => {
    render(<Field label="RUT" hint="Sin puntos" error="RUT inválido">{(id, describedBy) =>
      <input id={id} aria-describedby={describedBy} className={inputClass({ invalid: true })} />}</Field>)
    const campo = screen.getByRole('textbox', { name: 'RUT' })
    expect(campo).toHaveAccessibleDescription('Sin puntos RUT inválido')
    expect(screen.getByRole('alert')).toHaveTextContent('RUT inválido')
  })
})
