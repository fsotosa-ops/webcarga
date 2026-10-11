import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BarraDeSeleccion } from './BarraDeSeleccion'

const opciones = [
  { id: 'dup', label: 'Duplicado', pideNota: false },
  { id: 'otro', label: 'Otro', pideNota: true },
]

function montar(onConfirmar = vi.fn()) {
  render(
    <BarraDeSeleccion seleccionados={2} ayuda="marca" onLimpiar={() => {}}
      destructiva={{ etiqueta: 'Anular 2 viajes', advertencia: 'Quedan anulados', confirmacion: 'Sí, anular 2',
                     motivos: { etiqueta: 'Motivo', opciones }, onConfirmar }} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /anular 2 viajes/i }))
  return onConfirmar
}

describe('BarraDeSeleccion con motivo de catálogo', () => {
  it('no confirma sin motivo', () => {
    montar()
    expect(screen.getByRole('button', { name: /sí, anular 2/i })).toBeDisabled()
  })

  it('con «Otro» no confirma sin comentario', () => {
    montar()
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'otro' } })
    expect(screen.getByRole('button', { name: /sí, anular 2/i })).toBeDisabled()
    // Que diga por qué el botón no se habilita.
    expect(screen.getByLabelText(/comentario \(obligatorio\)/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/comentario/i), { target: { value: 'por correo' } })
    expect(screen.getByRole('button', { name: /sí, anular 2/i })).toBeEnabled()
  })

  it('manda el motivo y el comentario', async () => {
    const onConfirmar = montar(vi.fn().mockResolvedValue(true))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'dup' } })
    fireEvent.click(screen.getByRole('button', { name: /sí, anular 2/i }))
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith({ motivoId: 'dup', nota: '' }))
  })

  it('conserva el motivo si el backend rechaza', async () => {
    montar(vi.fn().mockResolvedValue(false))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'otro' } })
    fireEvent.change(screen.getByLabelText(/comentario/i), { target: { value: 'por correo' } })
    fireEvent.click(screen.getByRole('button', { name: /sí, anular 2/i }))
    await waitFor(() => expect(screen.getByLabelText(/comentario/i)).toHaveValue('por correo'))
    expect(screen.getByLabelText(/motivo/i)).toHaveValue('otro')
  })
})
