import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LastChange } from './LastChange'

describe('LastChange', () => {
  it('con un cambio dice quién y cuándo, en día de Chile', () => {
    render(<LastChange change={{ actorName: 'Pablo Abumohor', changedAt: '2026-10-14T02:30:00Z' }} pending={false} />)
    // 02:30 UTC del 14/10 es el 13/10 en Chile.
    expect(screen.getByText('Última modificación: Pablo Abumohor, 13/10/2026')).toBeInTheDocument()
  })

  it('sin actor conocido dice Sistema', () => {
    render(<LastChange change={{ actorName: null, changedAt: '2026-10-20T15:00:00Z' }} pending={false} />)
    expect(screen.getByText('Última modificación: Sistema, 20/10/2026')).toBeInTheDocument()
  })

  it('sin cambios registrados lo dice con la fecha de puesta en marcha', () => {
    render(<LastChange change={undefined} pending={false} />)
    expect(screen.getByText('Sin cambios registrados desde el 22/10/2026')).toBeInTheDocument()
  })

  it('mientras carga no afirma nada', () => {
    const { container } = render(<LastChange change={undefined} pending />)
    expect(container.textContent).toBe('')
  })
})
