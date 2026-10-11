import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusChip } from './StatusChip'

describe('StatusChip', () => {
  it('muestra el texto con el tono de su señal', () => {
    render(<><StatusChip tone="resolved">Activo</StatusChip><StatusChip tone="neutral">De baja</StatusChip></>)
    expect(screen.getByText('Activo')).toHaveClass('text-resuelto')
    expect(screen.getByText('De baja')).toHaveClass('text-informativo')
  })
})
