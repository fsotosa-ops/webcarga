import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CeldaConductor } from './CeldaConductor'

describe('CeldaConductor', () => {
  // El guion mudo de hoy es lo unico que todos los productos de conciliacion
  // evitan: el texto crudo del origen es la unica pista que tiene la persona
  // para decidir. QuickBooks y Ramp nunca lo esconden.
  it('muestra el nombre del TMS aunque no haya conductor vinculado', () => {
    render(<CeldaConductor driverId={null} driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN" onAsignar={vi.fn()} />)
    expect(screen.getByText(/Suarez Lopez Efrain/i)).toBeInTheDocument()
    expect(screen.getByText(/Sin registrar/i)).toBeInTheDocument()
  })

  // El RUT es la prueba de identidad en la fila resuelta; en la pendiente
  // ocupa su lugar el "Sin registrar". Misma posicion, misma altura de fila.
  it('cuando esta resuelto muestra el nombre del roster y su RUT', () => {
    render(
      // driverId presente = hay vinculo real. Antes este test pasaba sin el,
      // porque la celda deducia "resuelto" del nombre — la premisa equivocada.
      <CeldaConductor driverId="d1" driverName="Altamirano Ruiz Victor" driverRut="17.332.089-2"
                      driverNameTms="ALTAMIRANO RUIZ VICTOR" onAsignar={vi.fn()} />,
    )
    expect(screen.getByText(/Altamirano Ruiz Victor/i)).toBeInTheDocument()
    expect(screen.getByText('17.332.089-2')).toBeInTheDocument()
    expect(screen.queryByText(/Sin registrar/i)).toBeNull()
  })

  it('sin permiso de edicion muestra el dato pero no es un boton', () => {
    render(
      <CeldaConductor driverId={null} driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN"
                      puedeEditar={false} onAsignar={vi.fn()} />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/Suarez Lopez Efrain/i)).toBeInTheDocument()
  })

  it('cuando el TMS tampoco reporto, lo dice y no inventa', () => {
    render(<CeldaConductor driverId={null} driverName={null} driverNameTms={null} onAsignar={vi.fn()} />)
    expect(screen.getByText(/El TMS no reportó conductor/i)).toBeInTheDocument()
  })

  it('al hacer clic en la celda pendiente pide asignar', async () => {
    const alAsignar = vi.fn()
    render(<CeldaConductor driverId={null} driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN" onAsignar={alAsignar} />)
    screen.getByRole('button').click()
    expect(alAsignar).toHaveBeenCalledOnce()
  })
})

// ── Bug encontrado en el click-through del 2026-08-18 ──────────────────────
//
// El backend arma `driver_name` con
//   COALESCE(d.full_name, fl.driver_name_raw, t.fleet->>'driver_name_tms')
// asi que CAE al nombre del TMS cuando no hay conductor vinculado. La celda
// calculaba `resuelto = Boolean(driverName)`, o sea que con un nombre del TMS
// presente SIEMPRE se veia resuelta: "Sin registrar" no aparecia nunca, ni el
// borde punteado, y el contador "N conductores sin identificar" del Monitor
// —que el plan declaro CONDICION DURA del diseño— daba 0 estructuralmente.
//
// Verificado en produccion sobre el viaje 2032999: sin conductor vinculado, la
// celda mostraba "Suarez Lopez Efrain Eduardo —" en vez de "Sin registrar".
//
// La señal correcta es el VINCULO, no el nombre: `driver_id` ya viaja en el
// payload (vfr.resolved_driver_id) y es null exactamente cuando no hay
// conductor resuelto. Un nombre puede venir de dos fuentes; el id, de una.
describe('CeldaConductor — la señal es el vinculo, no el nombre', () => {
  it('sin vinculo dice "Sin registrar" aunque driverName traiga el nombre del TMS', () => {
    render(
      <CeldaConductor driverId={null} driverName="Suarez Lopez Efrain Eduardo"
                      driverNameTms="SUAREZ LOPEZ EFRAIN EDUARDO" onAsignar={vi.fn()} />,
    )
    expect(screen.getByText(/Suarez Lopez Efrain Eduardo/i)).toBeInTheDocument()
    expect(screen.getByText(/Sin registrar/i)).toBeInTheDocument()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('con vinculo muestra el RUT, no "Sin registrar"', () => {
    render(
      <CeldaConductor driverId="d1" driverName="Altamirano Ruiz Victor"
                      driverRut="17.332.089-2" driverNameTms="ALTAMIRANO RUIZ VICTOR"
                      onAsignar={vi.fn()} />,
    )
    expect(screen.getByText('17.332.089-2')).toBeInTheDocument()
    expect(screen.queryByText(/Sin registrar/i)).toBeNull()
  })

  it('con vinculo pero sin RUT cargado muestra el guion, no "Sin registrar"', () => {
    render(
      <CeldaConductor driverId="d1" driverName="Perez Soto Ana" driverRut={null}
                      driverNameTms="PEREZ SOTO ANA" onAsignar={vi.fn()} />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/Sin registrar/i)).toBeNull()
  })
})
