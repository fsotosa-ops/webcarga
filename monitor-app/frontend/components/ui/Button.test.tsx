import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('un botón del kit: por defecto secundario, tamaño normal, y no envía formularios por accidente', () => {
    render(<Button>Ver histórico</Button>)
    const b = screen.getByRole('button', { name: 'Ver histórico' })
    expect(b).toHaveAttribute('type', 'button')
    expect(b.className).toContain('border-border')
    expect(b.className).toContain('text-dato')
  })

  it('cada variante con su color del sistema, sin colores sueltos', () => {
    render(<>
      <Button variant="primary">Confirmar cierre</Button>
      <Button variant="danger">Forzar cierre</Button>
      <Button variant="link" size="sm">Reabrir día</Button>
    </>)
    expect(screen.getByRole('button', { name: 'Confirmar cierre' }).className).toContain('bg-accent')
    expect(screen.getByRole('button', { name: 'Forzar cierre' }).className).toContain('bg-status-incidente')
    const enlace = screen.getByRole('button', { name: 'Reabrir día' })
    expect(enlace.className).toContain('text-accion')
    expect(enlace.className).toContain('text-etiqueta')
    for (const b of screen.getAllByRole('button')) expect(b.className).not.toMatch(/-(gray|red|amber|green)-\d/)
  })

  it('pasa lo propio de un botón (deshabilitado, al hacer clic, enviar)', () => {
    const alHacerClic = vi.fn()
    render(<><Button disabled onClick={alHacerClic}>No</Button><Button type="submit">Guardar</Button></>)
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(alHacerClic).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('type', 'submit')
  })
})
