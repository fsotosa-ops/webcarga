import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Cifra } from './Cifra'

describe('Cifra', () => {
  it('muestra el valor con su etiqueta', () => {
    render(<Cifra valor={2360} etiqueta="documentos por cubrir" />)
    expect(screen.getByText('2360')).toBeInTheDocument()
    expect(screen.getByText('documentos por cubrir')).toBeInTheDocument()
  })

  // El bug real que dio origen a este componente: Certificacion pintaba un
  // "0" en cifra grande mientras la consulta estaba en vuelo, y despues
  // saltaba a 2.360. Durante ese segundo la pantalla afirmaba con seguridad
  // algo falso. La regla vive aca dentro para que no haya que recordarla en
  // cada pantalla.
  it('no muestra nada mientras carga — ni el valor ni la etiqueta', () => {
    render(<Cifra valor={undefined} etiqueta="documentos por cubrir" cargando />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('documentos por cubrir')).not.toBeInTheDocument()
  })

  it('tampoco inventa un cero cuando el valor todavia no llego', () => {
    // Sin `cargando`, pero sin dato: el mismo error por otra puerta.
    render(<Cifra valor={undefined} etiqueta="equipos" />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  // "Todavia no llego" y "no se va a mostrar" son dos cosas distintas. Las
  // tres cifras que la ficha de empresa oculta a proposito —contarlas sobre
  // una lista truncada seria mentir— quedaban latiendo para siempre: un
  // esqueleto promete un dato que no va a llegar nunca.
  it('sin `cargando` y sin dato lo dice, en vez de latir para siempre', () => {
    render(<Cifra valor={undefined} etiqueta="al dia" />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('al dia')).toBeInTheDocument()
  })

  it('un cero de verdad si se muestra', () => {
    // "Cero documentos pendientes" es una respuesta, y buena. Lo que no puede
    // es aparecer cuando todavia no se sabe.
    render(<Cifra valor={0} etiqueta="pendientes" />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('alinea los digitos entre filas', () => {
    render(<Cifra valor={7} etiqueta="equipos" />)
    expect(screen.getByText('7')).toHaveClass('tabular-nums')
  })

  it('usa los tokens de la escala, no tamanos sueltos', () => {
    render(<Cifra valor={12} etiqueta="viajes" />)
    expect(screen.getByText('12')).toHaveClass('text-cifra')
    expect(screen.getByText('viajes')).toHaveClass('text-etiqueta')
  })
})
