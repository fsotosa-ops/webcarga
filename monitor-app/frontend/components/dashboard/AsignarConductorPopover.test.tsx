import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AsignarConductorPopover } from './AsignarConductorPopover'

const CONTENIDO = {
  driver_id: 'd1', full_name: 'Suarez Lopez Efrain Eduardo', tax_id: '16.428.339-1',
  carrier_name: 'Transportes Sur', contiene: true, similitud: 0.88,
}
const PARECIDO = {
  driver_id: 'd2', full_name: 'Gomez Sifontes Carlos Eduardo', tax_id: '13.905.774-K',
  carrier_name: 'Transportes C&M', contiene: false, similitud: 0.22,
}

const base = {
  nombreTms: 'SUAREZ LOPEZ EFRAIN EDUARDO',
  viajesDeLaPersona: 13,
  onAsignar: vi.fn(),
  onDarDeAlta: vi.fn(),
  onCancelar: vi.fn(),
}

describe('AsignarConductorPopover', () => {
  it('siempre muestra el nombre crudo que reporto el TMS', () => {
    render(<AsignarConductorPopover {...base} candidatos={[CONTENIDO]} />)
    expect(screen.getByText('SUAREZ LOPEZ EFRAIN EDUARDO')).toBeInTheDocument()
  })

  // El control y su consecuencia dicen lo mismo: no hay que acordarse de lo
  // que se marco dos renglones mas arriba.
  it('el boton dice a cuantos viajes se aplica, y cambia con la casilla', () => {
    render(<AsignarConductorPopover {...base} candidatos={[CONTENIDO]} />)
    fireEvent.click(screen.getByRole('button', { name: /Suarez Lopez Efrain/i }))

    expect(screen.getByRole('button', { name: /Asignar a 13 viajes/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /Asignar solo a este viaje/i })).toBeInTheDocument()
  })

  it('no se puede confirmar mientras cargan los candidatos', () => {
    render(<AsignarConductorPopover {...base} candidatos={[]} cargando />)
    expect(screen.getByRole('button', { name: /Asignar/i })).toBeDisabled()
  })

  // Medido: de las 28 personas sin identificar, 19 no tienen ningun candidato
  // contenido. Ofrecer al "mas parecido" ahi es ofrecer a otra persona: para
  // el viaje 2032999 el mejor da 0,22 y no es quien.
  it('sin ningun candidato contenido, el camino principal es dar de alta', () => {
    render(<AsignarConductorPopover {...base} candidatos={[PARECIDO]} />)

    const alta = screen.getByRole('button', { name: /dar de alta/i })
    expect(alta).toBeInTheDocument()
    // el parecido no se ofrece como opcion principal, queda detras de un gesto
    expect(screen.queryByRole('button', { name: /Gomez Sifontes/i })).toBeNull()
    expect(screen.getByText(/No encontramos a esta persona/i)).toBeInTheDocument()
  })

  it('los parecidos se pueden ver, pero hay que pedirlos', () => {
    render(<AsignarConductorPopover {...base} candidatos={[PARECIDO]} />)
    fireEvent.click(screen.getByRole('button', { name: /ver parecidos/i }))
    expect(screen.getByRole('button', { name: /Gomez Sifontes/i })).toBeInTheDocument()
  })

  // Decision del usuario (2026-08-18): el alta pide RUT. tax_id sigue siendo
  // obligatorio porque es la clave con la que el resolvedor identifica por
  // RUT — un conductor sin RUT nunca se identificaria solo.
  it('dar de alta pide el RUT, y no deja confirmar sin el', () => {
    render(<AsignarConductorPopover {...base} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))

    expect(screen.getByLabelText(/RUT/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Crear y asignar/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/RUT/i), { target: { value: '16.428.339-1' } })
    expect(screen.getByRole('button', { name: /Crear y asignar/i })).toBeEnabled()
  })

  it('el alta propone el nombre del TMS, ya legible', () => {
    render(<AsignarConductorPopover {...base} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    expect(screen.getByLabelText(/Nombre/i)).toHaveValue('Suarez Lopez Efrain Eduardo')
  })
})
