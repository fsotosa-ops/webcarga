import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AccordionSection } from './AccordionSection'

describe('AccordionSection', () => {
  it('renders children when defaultOpen is true (or omitted)', () => {
    render(<AccordionSection title="Bitácora"><p>contenido</p></AccordionSection>)
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('hides children when defaultOpen is false', () => {
    render(<AccordionSection title="Bitácora" defaultOpen={false}><p>contenido</p></AccordionSection>)
    expect(screen.queryByText('contenido')).not.toBeInTheDocument()
  })

  it('toggles visibility on header click', () => {
    render(<AccordionSection title="Bitácora"><p>contenido</p></AccordionSection>)
    fireEvent.click(screen.getByRole('button', { name: /Bitácora/ }))
    expect(screen.queryByText('contenido')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bitácora/ }))
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('exposes aria-expanded matching the current state', () => {
    render(<AccordionSection title="Bitácora"><p>contenido</p></AccordionSection>)
    const button = screen.getByRole('button', { name: /Bitácora/ })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('accepts a ReactNode title (icon + dynamic text), not just a string', () => {
    render(
      <AccordionSection title={<span>Ruta (3 paradas)</span>}>
        <p>contenido</p>
      </AccordionSection>,
    )
    expect(screen.getByText('Ruta (3 paradas)')).toBeInTheDocument()
  })
})
