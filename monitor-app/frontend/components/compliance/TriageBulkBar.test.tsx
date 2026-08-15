import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { TriageBulkBar } from './TriageBulkBar'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { moveItems: vi.fn().mockResolvedValue({ moved: 2 }) },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))

function setup(over: Record<string, unknown> = {}) {
  const props = {
    selectedCount: 3, targetIds: ['i1', 'i2', 'i3'], currentCarrierId: 'c1',
    onDiscard: vi.fn(), onClear: vi.fn(), onMoved: vi.fn(), ...over,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TriageBulkBar {...(props as unknown as ComponentProps<typeof TriageBulkBar>)} />
    </QueryClientProvider>,
  )
  return props
}

describe('TriageBulkBar', () => {
  // En reposo la barra no desaparece: enseña que existe la selección múltiple.
  // Si solo apareciera al marcar algo, la capacidad sería invisible hasta que
  // alguien la descubra por accidente.
  it('sin seleccion explica como marcar, en vez de esconderse', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TriageBulkBar
          selectedCount={0} targetIds={[]} currentCarrierId={null}
          onDiscard={vi.fn()} onClear={vi.fn()} onMoved={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/ninguno seleccionado/i)).toBeInTheDocument()
    expect(screen.getByText(/barra espaciadora/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /descartar/i })).not.toBeInTheDocument()
  })

  it('dice cuantos hay seleccionados', () => {
    setup()
    expect(screen.getByText(/3 seleccionados/i)).toBeInTheDocument()
  })

  it('descartar pide confirmacion en la barra, no en un modal', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /descartar los 3/i }))
    expect(p.onDiscard).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/se borran definitivamente/i)).toBeInTheDocument()
  })

  it('descarta al confirmar', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /descartar los 3/i }))
    fireEvent.click(screen.getByRole('button', { name: /sí, descartar 3/i }))
    expect(p.onDiscard).toHaveBeenCalled()
  })

  it('se puede arrepentir', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /descartar los 3/i }))
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(p.onDiscard).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /descartar los 3/i })).toBeInTheDocument()
  })

  it('deselecciona', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /deseleccionar/i }))
    expect(p.onClear).toHaveBeenCalled()
  })

  it('ofrece mover cuando la seleccion es de una sola empresa', () => {
    setup()
    expect(screen.getByRole('button', { name: /mover 3 a otra empresa/i })).toBeInTheDocument()
  })

  it('no ofrece mover si la seleccion cruza empresas', () => {
    setup({ currentCarrierId: null })
    expect(screen.queryByRole('button', { name: /mover/i })).not.toBeInTheDocument()
  })

  // Con un filtro puesto, "todo" es ambiguo: es la causa numero uno de
  // asignaciones masivas erroneas.
  it('los botones dicen la cantidad exacta, nunca "seleccionados"', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TriageBulkBar
          selectedCount={3}
          targetIds={['a', 'b', 'c']}
          currentCarrierId="c1"
          onDiscard={vi.fn()}
          onClear={vi.fn()}
          onMoved={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: /descartar los 3/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^descartar$/i })).not.toBeInTheDocument()
  })

  it('con un solo archivo concuerda en singular', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TriageBulkBar
          selectedCount={1}
          targetIds={['a']}
          currentCarrierId="c1"
          onDiscard={vi.fn()}
          onClear={vi.fn()}
          onMoved={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: /descartar 1 archivo/i })).toBeInTheDocument()
  })
})
