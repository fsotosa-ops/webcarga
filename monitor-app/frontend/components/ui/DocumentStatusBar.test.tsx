import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentStatusBar } from './DocumentStatusBar'

const docs = (extra = {}) => ({ ok: 12, expiring: 3, expired: 2, missing: 0, attention: [], ...extra })

describe('DocumentStatusBar', () => {
  it('cuenta cada estado y omite los que están en cero', () => {
    render(<DocumentStatusBar documents={docs()} />)
    expect(screen.getByText('12 al día')).toBeInTheDocument()
    expect(screen.getByText('3 por vencer')).toBeInTheDocument()
    expect(screen.getByText('2 vencidos')).toBeInTheDocument()
    expect(screen.queryByText(/faltan?/)).toBeNull()
  })

  it('cada tramo de la barra mide lo que pesa su estado', () => {
    render(<DocumentStatusBar documents={docs()} />)
    expect(screen.getByTestId('segment-ok')).toHaveStyle({ width: `${(12 / 17) * 100}%` })
    expect(screen.getByTestId('segment-expired')).toHaveStyle({ width: `${(2 / 17) * 100}%` })
  })

  it('sin requisitos no dibuja una barra vacía: lo dice', () => {
    render(<DocumentStatusBar documents={docs({ ok: 0, expiring: 0, expired: 0 })} />)
    expect(screen.getByText('Sin requisitos configurados')).toBeInTheDocument()
    expect(screen.queryByTestId('segment-ok')).toBeNull()
  })

  it('lista lo que hay que atender con su fecha', () => {
    render(<DocumentStatusBar documents={docs({
      missing: 1,
      attention: [
        { name: 'Licencia A5', state: 'expired', due_on: '2026-10-02' },
        { name: 'Antecedentes', state: 'expiring', due_on: '2026-10-18' },
        { name: 'Examen', state: 'missing', due_on: null },
      ],
    })} />)
    expect(screen.getByText('1 falta')).toBeInTheDocument()
    expect(screen.getByText('Vencido 02/10')).toBeInTheDocument()
    expect(screen.getByText('Vence 18/10')).toBeInTheDocument()
    expect(screen.getByText('Falta')).toBeInTheDocument()
  })

  it('las cifras de atención salen del resumen de la API y la flota va en su línea (D-R9)', () => {
    render(<DocumentStatusBar documents={docs({ expired: 9, expiring: 9 })}
                              counts={{ overdue: 2, expiring: 1, missing: 0 }}
                              fleet={{ overdue: 3, expiring: 0, missing: 4 }} />)
    expect(screen.getByText('2 vencidos')).toBeInTheDocument()
    expect(screen.queryByText('9 vencidos')).toBeNull()
    expect(screen.getByText('Flota activa: 3 vencidos · 4 faltan')).toBeInTheDocument()
  })
})
