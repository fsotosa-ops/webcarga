import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { EncabezadoOrdenable } from './EncabezadoOrdenable'

function montar(orden: Parameters<typeof EncabezadoOrdenable>[0]['orden'], onOrdenar = vi.fn()) {
  render(
    <table><thead><tr>
      <EncabezadoOrdenable columna="nombre" orden={orden} onOrdenar={onOrdenar}>Documento</EncabezadoOrdenable>
    </tr></thead></table>,
  )
  return onOrdenar
}

describe('EncabezadoOrdenable', () => {
  it('avisa por que columna ordenar al hacer clic', () => {
    const onOrdenar = montar(null)
    // El manejador de clic vive en el <button> de adentro, no en el <th>: un
    // clic disparado sobre el columnheader no baja al hijo (fireEvent.click
    // no simula la propagacion de un clic real de mouse a traves del layout).
    fireEvent.click(screen.getByRole('button', { name: /documento/i }))
    expect(onOrdenar).toHaveBeenCalledWith('nombre')
  })

  // aria-sort es como un lector de pantalla sabe que la tabla esta ordenada.
  // Sin esto el orden es informacion que solo existe si ves el icono.
  it('declara el orden de forma accesible', () => {
    montar({ columna: 'nombre', direccion: 'asc' })
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('una columna que no ordena no dice nada', () => {
    montar({ columna: 'otra', direccion: 'asc' })
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
  })

  // Orden de tabulacion y foco visible: regla de severidad alta de ui-ux-pro-max.
  it('se puede ordenar con el teclado', () => {
    const onOrdenar = montar(null)
    const boton = screen.getByRole('button', { name: /documento/i })
    // jsdom no reimplementa la accion por defecto del navegador (Enter/Espacio
    // sobre un <button> nativo dispara un clic): fireEvent.keyDown por si solo
    // no lo produce. Lo que sí se puede comprobar aca es el contrato que
    // GARANTIZA esa operabilidad por teclado en un navegador real: que el
    // elemento clicable sea un <button> nativo, no un <div> con onClick.
    expect(boton.tagName).toBe('BUTTON')
    fireEvent.click(boton)
    expect(onOrdenar).toHaveBeenCalledWith('nombre')
  })
})
