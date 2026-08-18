import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CeldaConductor } from './CeldaConductor'

describe('CeldaConductor', () => {
  // El guion mudo de hoy es lo unico que todos los productos de conciliacion
  // evitan: el texto crudo del origen es la unica pista que tiene la persona
  // para decidir. QuickBooks y Ramp nunca lo esconden.
  it('muestra el nombre del TMS aunque no haya conductor vinculado', () => {
    render(<CeldaConductor driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN" onAsignar={vi.fn()} />)
    expect(screen.getByText(/Suarez Lopez Efrain/i)).toBeInTheDocument()
    expect(screen.getByText(/Sin registrar/i)).toBeInTheDocument()
  })

  // El RUT es la prueba de identidad en la fila resuelta; en la pendiente
  // ocupa su lugar el "Sin registrar". Misma posicion, misma altura de fila.
  it('cuando esta resuelto muestra el nombre del roster y su RUT', () => {
    render(
      <CeldaConductor driverName="Altamirano Ruiz Victor" driverRut="17.332.089-2"
                      driverNameTms="ALTAMIRANO RUIZ VICTOR" onAsignar={vi.fn()} />,
    )
    expect(screen.getByText(/Altamirano Ruiz Victor/i)).toBeInTheDocument()
    expect(screen.getByText('17.332.089-2')).toBeInTheDocument()
    expect(screen.queryByText(/Sin registrar/i)).toBeNull()
  })

  it('sin permiso de edicion muestra el dato pero no es un boton', () => {
    render(
      <CeldaConductor driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN"
                      puedeEditar={false} onAsignar={vi.fn()} />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/Suarez Lopez Efrain/i)).toBeInTheDocument()
  })

  it('cuando el TMS tampoco reporto, lo dice y no inventa', () => {
    render(<CeldaConductor driverName={null} driverNameTms={null} onAsignar={vi.fn()} />)
    expect(screen.getByText(/El TMS no reportó conductor/i)).toBeInTheDocument()
  })

  it('al hacer clic en la celda pendiente pide asignar', async () => {
    const alAsignar = vi.fn()
    render(<CeldaConductor driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN" onAsignar={alAsignar} />)
    screen.getByRole('button').click()
    expect(alAsignar).toHaveBeenCalledOnce()
  })
})
