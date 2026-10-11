import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AvisoFueraDeEnCurso } from './AvisoFueraDeEnCurso'

describe('AvisoFueraDeEnCurso', () => {
  it('dice cuántos activos quedaron fuera y por qué, y lleva al Historial', () => {
    const onVer = vi.fn()
    render(<AvisoFueraDeEnCurso cantidad={2} dias={3} onVer={onVer} />)
    expect(screen.getByText('2 viajes activos llevan más de 3 días sin movimiento y no se muestran aquí.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver en Historial' }))
    expect(onVer).toHaveBeenCalledOnce()
  })

  it('en singular', () => {
    render(<AvisoFueraDeEnCurso cantidad={1} dias={1} onVer={() => {}} />)
    expect(screen.getByText('1 viaje activo lleva más de 1 día sin movimiento y no se muestra aquí.')).toBeInTheDocument()
  })

  it('sin ninguno fuera, no dice nada', () => {
    const { container } = render(<AvisoFueraDeEnCurso cantidad={0} dias={3} onVer={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mientras no llega la cifra, no afirma nada', () => {
    const { container } = render(<AvisoFueraDeEnCurso cantidad={undefined} dias={3} onVer={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
