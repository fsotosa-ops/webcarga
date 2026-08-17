import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Estado } from './Estado'

/**
 * 48 estados vacios escritos a mano y 138 Loader2 sueltos (auditoria
 * 2026-08-16). Los tres estados ocupan EL MISMO lugar y se excluyen entre si;
 * tenerlos como tres cosas sueltas es lo que hizo que en 48 lugares se
 * escribiera solo uno de los tres.
 */
describe('Estado', () => {
  it('cargando se anuncia y no afirma ningun dato', () => {
    render(<Estado tipo="cargando" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('el vacio dice que pasa, no solo que no hay nada', () => {
    render(
      <Estado
        tipo="vacio"
        titulo="Tomamos todas las cargas del día"
        detalle="Ningún viaje quedó sin asignar."
      />,
    )
    expect(screen.getByText('Tomamos todas las cargas del día')).toBeInTheDocument()
    expect(screen.getByText('Ningún viaje quedó sin asignar.')).toBeInTheDocument()
  })

  it('el vacio puede ofrecer que hacer', () => {
    render(
      <Estado tipo="vacio" titulo="Sin documentos">
        <button>Subir el primero</button>
      </Estado>,
    )
    expect(screen.getByRole('button', { name: 'Subir el primero' })).toBeInTheDocument()
  })

  it('el error se anuncia como alerta y explica que paso', () => {
    render(<Estado tipo="error" titulo="No se pudo cargar el estado de la certificación" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo cargar el estado de la certificación',
    )
  })

  it('el error no se disfraza de vacio', () => {
    // Un fallo de red mostrado como "no hay nada" hace creer que el dato no
    // existe. Son cosas distintas y tienen que verse distinto.
    render(<Estado tipo="error" titulo="No se pudo cargar" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('usa los tokens de la escala', () => {
    render(<Estado tipo="vacio" titulo="Sin resultados" />)
    expect(screen.getByText('Sin resultados')).toHaveClass('text-lectura')
  })
})
