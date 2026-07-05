import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TripCreateSlideOver } from './TripCreateSlideOver'
import { tripsApi } from '@/lib/api/trips'
import type { TripsMeta } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { create: vi.fn() },
}))
vi.mock('@/lib/api/transporters', () => ({
  transportersApi: { list: vi.fn().mockResolvedValue({ data: [] }), get: vi.fn() },
}))

const meta: TripsMeta = {
  statuses: [{ id: 'ASIGNADO', label: 'ASIGNADO', bg_color: '#fff', text_color: '#000', group: 'otro' }],
  tms_sources: [
    { id: 'qanalytics', label: 'QA', bg_color: '#fff', text_color: '#000' },
    { id: 'manual', label: 'Manual', bg_color: '#fff', text_color: '#000' },
  ],
  operational_states: [], alert_thresholds: [], csv_columns: [], temperature_ranges: [],
}

beforeEach(() => {
  vi.mocked(tripsApi.create).mockReset()
})

describe('TripCreateSlideOver', () => {
  it('has dialog semantics and closes with Escape', () => {
    const onClose = vi.fn()
    render(<TripCreateSlideOver open onClose={onClose} onCreated={vi.fn()} meta={meta} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('defaults planning_date to today', () => {
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
    expect(screen.getByDisplayValue(today)).toBeInTheDocument()
  })

  it('submits with Enter (form submit) and sends stops + origin', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new', planning_date: '2026-07-06' } as never)
    const onCreated = vi.fn()
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={onCreated} meta={meta} />)

    // Agregar un destino
    fireEvent.click(screen.getByText('Agregar destino'))
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'Local Maipú' } })

    // Enviar el form
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.stops).toEqual([{ local: 'Local Maipú', planning_date: null }])
    expect(payload.origin_tms).toBeUndefined() // modo "Sin TMS"
    expect(onCreated).toHaveBeenCalled()
  })

  it('shows TMS selector and reconciliation hint when origin is a mapped TMS', () => {
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    fireEvent.click(screen.getByText('TMS integrado'))
    fireEvent.change(screen.getByLabelText('TMS de origen'), { target: { value: 'qanalytics' } })
    fireEvent.change(screen.getByPlaceholderText('1994062'), { target: { value: '555' } })
    fireEvent.change(screen.getByPlaceholderText('Walmart, Colun…'), { target: { value: 'Walmart' } })
    expect(screen.getByText(/Se vinculará automáticamente/)).toBeInTheDocument()
  })

  it('el selector de TMS integrado no ofrece "manual" como opción', () => {
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    fireEvent.click(screen.getByText('TMS integrado'))
    const select = screen.getByLabelText('TMS de origen') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toContain('qanalytics')
    expect(values).not.toContain('manual')
  })

  it('shows a visible error when the backend rejects (409 duplicado)', async () => {
    vi.mocked(tripsApi.create).mockRejectedValue(new Error('Ya registraste el viaje 555 de Walmart'))
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    fireEvent.click(screen.getByText('Crear viaje'))
    expect(await screen.findByText(/Ya registraste el viaje/)).toBeInTheDocument()
  })

  it('destinos can be removed', () => {
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    fireEvent.click(screen.getByText('Agregar destino'))
    expect(screen.getByLabelText('Nombre destino 1')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Quitar destino 1'))
    expect(screen.queryByLabelText('Nombre destino 1')).not.toBeInTheDocument()
  })
})
