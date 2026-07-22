import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PendingDocsBadge } from './PendingDocsBadge'

// Feedback post-weekly 2026-07-22: el primer intento (prefijo de 1 letra,
// "T7"/"C12") seguía siendo ambiguo — el usuario preguntó qué significaba.
// Ahora un ícono de documento + el número, universalmente legible como "N
// documentos [pendientes]" sin memorizar una convención de letras. La
// entidad se desambigua por posición (el badge vive pegado al texto de esa
// entidad específica), reforzada por el título en hover.

describe('PendingDocsBadge', () => {
  it('renders nothing when count is 0, null or undefined', () => {
    const { container: c1 } = render(<PendingDocsBadge count={0} />)
    const { container: c2 } = render(<PendingDocsBadge count={null} />)
    const { container: c3 } = render(<PendingDocsBadge count={undefined} />)
    expect(c1.firstChild).toBeNull()
    expect(c2.firstChild).toBeNull()
    expect(c3.firstChild).toBeNull()
  })

  it('compact: shows the count as text, not a cryptic letter code', () => {
    render(<PendingDocsBadge count={7} label="Tracto" compact />)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText('T7')).not.toBeInTheDocument()
  })

  it('compact: title identifies both the entity and what the number means', () => {
    render(<PendingDocsBadge count={7} label="Tracto" compact />)
    expect(screen.getByTitle('Tracto: 7 documento(s) pendiente(s)')).toBeInTheDocument()
  })

  it('full: spells out the label and count as text', () => {
    render(<PendingDocsBadge count={12} label="Conductor" />)
    expect(screen.getByText('Conductor: 12 pendientes')).toBeInTheDocument()
  })

  it('uses red tone when critical, amber otherwise', () => {
    const { container: critical } = render(<PendingDocsBadge count={2} critical compact />)
    const { container: normal } = render(<PendingDocsBadge count={2} compact />)
    expect(critical.querySelector('span')?.className).toContain('bg-red-100')
    expect(normal.querySelector('span')?.className).toContain('bg-amber-50')
  })
})
