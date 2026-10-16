import { render, screen } from '@testing-library/react'
import { CircleCheck } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { StatusChip } from './StatusChip'

describe('StatusChip', () => {
  it('muestra el texto con el tono de su señal', () => {
    render(<><StatusChip tone="resolved">Activo</StatusChip><StatusChip tone="neutral">De baja</StatusChip></>)
    expect(screen.getByText('Activo')).toHaveClass('text-resuelto')
    expect(screen.getByText('De baja')).toHaveClass('text-informativo')
  })

  it('con icono lo dibuja antes del texto, oculto para el lector de pantalla', () => {
    const { container } = render(<StatusChip tone="resolved" icon={CircleCheck}>Activa</StatusChip>)
    expect(screen.getByText('Activa')).toHaveClass('text-resuelto')
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('no se parte en dos renglones en una columna angosta (teléfono)', () => {
    render(<StatusChip tone="resolved">Al día</StatusChip>)
    expect(screen.getByText('Al día')).toHaveClass('whitespace-nowrap')
  })
})
