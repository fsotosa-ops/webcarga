import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExpirationDateCell } from './ExpirationDateCell'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { patch: vi.fn().mockResolvedValue({}) },
}))
import { complianceApi } from '@/lib/api/compliance'

describe('ExpirationDateCell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('guarda la fecha al confirmar', async () => {
    const onSaved = vi.fn()
    render(<ExpirationDateCell recordId="r1" value={null} required canEdit onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: /agregar vencimiento/i }))
    const input = screen.getByLabelText(/fecha de vencimiento/i)
    fireEvent.change(input, { target: { value: '2027-03-31' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(complianceApi.patch).toHaveBeenCalledWith('r1', { expiration_date: '2027-03-31' })
      expect(onSaved).toHaveBeenCalledWith('r1', '2027-03-31')
    })
  })

  it('no ofrece edicion sin permiso', () => {
    render(<ExpirationDateCell recordId="r1" value="2027-03-31" required canEdit={false} onSaved={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('resincroniza el draft desde el prop al reabrir', () => {
    // Regresion: el bug de draft sin resincronizar ya aparecio 3 veces en este
    // frontend. El boton que ABRE la edicion debe resetear desde el prop, no
    // confiar en el useState inicial.
    const { rerender } = render(
      <ExpirationDateCell recordId="r1" value="2027-01-01" required canEdit onSaved={vi.fn()} />
    )
    rerender(<ExpirationDateCell recordId="r1" value="2028-12-31" required canEdit onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /vencimiento/i }))
    expect((screen.getByLabelText(/fecha de vencimiento/i) as HTMLInputElement).value).toBe('2028-12-31')
  })

  it('no llama a la API si la fecha no cambio', async () => {
    render(<ExpirationDateCell recordId="r1" value="2027-03-31" required canEdit onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /vencimiento/i }))
    fireEvent.blur(screen.getByLabelText(/fecha de vencimiento/i))

    await waitFor(() => expect(complianceApi.patch).not.toHaveBeenCalled())
  })
})
