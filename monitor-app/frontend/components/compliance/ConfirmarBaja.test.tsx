import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ConfirmarBaja } from './ConfirmarBaja'

const base = {
  abierto: true, nombreSujeto: 'Juan Pérez', nombreEmpresa: 'Transportes Demo',
  cuantosDocumentos: 3, onCancelar: vi.fn(), onConfirmar: vi.fn().mockResolvedValue(undefined),
}

describe('ConfirmarBaja', () => {
  it('dice qué NO se pierde, que es la duda de quien confirma', () => {
    render(<ConfirmarBaja {...base} />)
    expect(screen.getByText(/3 documentos/)).toBeInTheDocument()
    expect(screen.getByText(/se conservan/i)).toBeInTheDocument()
  })

  it('no promete un regreso que hoy no funciona', () => {
    // is_manual_override marca la asignacion dada de baja, y el INSERT de
    // reasignacion la lee como "no tocar" tambien cuando decidio una
    // persona: volver a asignar a la misma empresa responde 201 y no hace
    // nada. La mitad "se conservan" es cierta y se queda; la promesa de
    // que el regreso funciona solo, no.
    render(<ConfirmarBaja {...base} />)
    expect(screen.queryByText(/si vuelve/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no hay que pedirlos de nuevo/i)).not.toBeInTheDocument()
  })

  it('sin documentos cargados no habla de documentos', () => {
    // Prometer que "se conservan 0 documentos" es ruido que hace dudar.
    render(<ConfirmarBaja {...base} cuantosDocumentos={0} />)
    expect(screen.queryByText(/documentos/i)).not.toBeInTheDocument()
  })

  it('si el servidor falla, lo dice y deja reintentar', async () => {
    const onConfirmar = vi.fn().mockRejectedValue(new Error('sesión vencida'))
    render(<ConfirmarBaja {...base} onConfirmar={onConfirmar} />)

    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/sesión vencida/i)
    // Y el diálogo sigue abierto: cerrarlo haria creer que la baja ocurrio.
    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeEnabled()
  })

  it('mientras viaja no se puede confirmar dos veces', async () => {
    let resolver: () => void = () => {}
    const onConfirmar = vi.fn(() => new Promise<void>(r => { resolver = r }))
    render(<ConfirmarBaja {...base} onConfirmar={onConfirmar} />)

    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }))
    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeDisabled()

    resolver()
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1))
  })

  it('un padre que pasa handlers inline no revive el boton a mitad de un request', async () => {
    // El padre real (la ficha) pasa onCancelar como una flecha inline —
    // identidad nueva en cada render. Si el efecto que arma el listener de
    // Escape depende de onCancelar, un re-render del padre durante una baja
    // en vuelo reinicia el efecto, hace setEnviando(false) y "Dar de baja"
    // vuelve a quedar habilitado con el request todavía viajando.
    let resolver: () => void = () => {}
    const onConfirmar = vi.fn(() => new Promise<void>(r => { resolver = r }))

    function Padre() {
      const [, forzarRerender] = useState(0)
      return (
        <>
          <button type="button" onClick={() => forzarRerender(n => n + 1)}>re-renderizar padre</button>
          <ConfirmarBaja {...base} onConfirmar={onConfirmar} onCancelar={() => {}} />
        </>
      )
    }

    render(<Padre />)
    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }))
    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 're-renderizar padre' }))

    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeDisabled()

    resolver()
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1))
  })

  it('mientras viaja, ni el fondo ni Escape cancelan: creer que canceló mientras la baja sigue en curso', () => {
    let resolver: () => void = () => {}
    const onConfirmar = vi.fn(() => new Promise<void>(r => { resolver = r }))
    const onCancelar = vi.fn()
    const { container } = render(<ConfirmarBaja {...base} onConfirmar={onConfirmar} onCancelar={onCancelar} />)

    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancelar).not.toHaveBeenCalled()

    const fondo = container.querySelector('[aria-hidden="true"]') as Element
    fireEvent.click(fondo)
    expect(onCancelar).not.toHaveBeenCalled()

    void resolver
  })

  // El aviso que faltaba: sacarle la empresa a alguien que está manejando lo
  // borra del cierre del día. El 25/08 pasó de verdad, con 70 viajes.
  it('avisa cuando el sujeto tiene viajes activos', () => {
    render(<ConfirmarBaja {...base} viajesActivos={70} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/70 viajes activos/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/deja de aparecer en el cierre/i)
  })

  it('con un solo viaje lo dice en singular', () => {
    render(<ConfirmarBaja {...base} viajesActivos={1} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/1 viaje activo\b/i)
  })

  it('sin viajes activos no dibuja el aviso', () => {
    render(<ConfirmarBaja {...base} viajesActivos={0} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // "Todavía no sé" no es "cero": mientras la consulta viaja no se afirma nada.
  it('mientras no llega el dato no afirma que no tiene viajes', () => {
    render(<ConfirmarBaja {...base} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
