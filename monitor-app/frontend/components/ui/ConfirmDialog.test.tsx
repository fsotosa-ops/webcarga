import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

function abrir(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onClose = vi.fn()
  const onConfirm = vi.fn(() => Promise.resolve())
  render(<ConfirmDialog title="Eliminar Transportes Sur" confirmLabel="Eliminar" tone="danger"
    onConfirm={onConfirm} onClose={onClose} errorFallback="No se pudo eliminar" {...props}>
    <p>Esto borra la empresa.</p>
  </ConfirmDialog>)
  return { onClose, onConfirm }
}

describe('ConfirmDialog', () => {
  it('el foco empieza en Cancelar: un Enter por reflejo no confirma', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })

  it('al confirmar y salir bien, se cierra', async () => {
    const { onClose, onConfirm } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('si falla, lo dice, no se cierra (haría creer que ocurrió) y deja reintentar', async () => {
    const { onClose } = abrir({ onConfirm: () => Promise.reject(new Error('Tiene pólizas cargadas')) })
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tiene pólizas cargadas')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeEnabled()
  })

  it('mientras viaja no se confirma dos veces y nada la cierra', async () => {
    let terminar!: () => void
    const onConfirm = vi.fn(() => new Promise<void>(r => { terminar = r }))
    const { onClose } = abrir({ onConfirm })
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('panel-overlay'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { terminar() })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('sin lo que necesita (confirmDisabled) no se puede confirmar', () => {
    abrir({ confirmDisabled: true })
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeDisabled()
  })

  it('una acción que no se deshace se pinta como peligrosa', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Eliminar' }).className).toMatch(/bg-status-incidente/)
  })
})
