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
})
