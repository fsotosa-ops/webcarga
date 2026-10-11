import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TriageUndoNotice } from './TriageUndoNotice'

const base = { mensaje: '38 archivos asignados a Transportes Charlotte Spa',
               onDeshacer: vi.fn(), onCerrar: vi.fn() }

describe('TriageUndoNotice', () => {
  it('dice qué pasó y ofrece revertirlo', () => {
    render(<TriageUndoNotice {...base} />)
    expect(screen.getByText(/38 archivos asignados/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deshacer/i })).toBeInTheDocument()
  })

  it('sin onDeshacer sólo informa: no ofrece una vuelta atrás que no existe', () => {
    render(<TriageUndoNotice mensaje="F30-1 de Transportes Andes guardado" onCerrar={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('F30-1 de Transportes Andes guardado')
    expect(screen.queryByRole('button', { name: /deshacer/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar aviso' })).toBeInTheDocument()
  })

  it('deshacer avisa al padre', () => {
    const onDeshacer = vi.fn()
    render(<TriageUndoNotice {...base} onDeshacer={onDeshacer} />)
    fireEvent.click(screen.getByRole('button', { name: /deshacer/i }))
    expect(onDeshacer).toHaveBeenCalled()
  })

  // No se desvanece solo: una asignacion de 200 archivos se revisa con calma.
  it('no se cierra solo — hay que cerrarlo a mano', () => {
    vi.useFakeTimers()
    const onCerrar = vi.fn()
    render(<TriageUndoNotice {...base} onCerrar={onCerrar} />)
    vi.advanceTimersByTime(30_000)
    expect(onCerrar).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('mientras revierte no se puede pedir dos veces', () => {
    render(<TriageUndoNotice {...base} deshaciendo />)
    expect(screen.getByRole('button', { name: /deshaciendo/i })).toBeDisabled()
  })

  it('es un aviso, no una alerta que interrumpa', () => {
    render(<TriageUndoNotice {...base} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
