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
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'walmart' } })
    expect(screen.getByText(/Se vinculará automáticamente/)).toBeInTheDocument()
  })

  it('cliente es dropdown con canónicos y "Otro cliente" revela texto libre', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    const select = screen.getByLabelText('Cliente') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toEqual(expect.arrayContaining(['walmart', 'sodimac', 'colun', 'iansa', 'otro']))

    // Sin nombre → se envía el genérico 'otro'
    fireEvent.change(select, { target: { value: 'otro' } })
    expect(screen.getByLabelText(/Nombre del cliente/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    expect(vi.mocked(tripsApi.create).mock.calls[0][0].client_name).toBe('otro')

    // Con nombre → se envía el texto
    vi.mocked(tripsApi.create).mockClear()
    fireEvent.change(screen.getByLabelText(/Nombre del cliente/i), { target: { value: 'Agrosuper' } })
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    expect(vi.mocked(tripsApi.create).mock.calls[0][0].client_name).toBe('Agrosuper')
  })

  it('tipo de carga es dropdown con SECO/FRIO/CONGELADO', () => {
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    const select = screen.getByLabelText('Tipo de carga') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toEqual(expect.arrayContaining(['SECO', 'FRIO', 'CONGELADO']))
  })

  it('modo Sin TMS permite anotar un ID de seguimiento y lo envía sin origin_tms', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    fireEvent.change(screen.getByPlaceholderText(/Guía, hoja de ruta/), { target: { value: 'FAC-50' } })
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.source_system_trip_id).toBe('FAC-50')
    expect(payload.origin_tms).toBeUndefined()
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

  it('envía región/ciudad de origen y de cada destino en el payload', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)

    fireEvent.change(screen.getByLabelText('Región de origen'), { target: { value: 'Biobío' } })
    fireEvent.change(screen.getByLabelText('Ciudad de origen'), { target: { value: 'Concepción' } })

    fireEvent.click(screen.getByText('Agregar destino'))
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'CD El Peñón' } })
    fireEvent.change(screen.getByLabelText('Región destino 1'), { target: { value: 'Región Metropolitana de Santiago' } })
    fireEvent.change(screen.getByLabelText('Ciudad destino 1'), { target: { value: 'San Bernardo' } })

    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.origin_region).toBe('Biobío')
    expect(payload.origin_city).toBe('Concepción')
    expect(payload.stops?.[0]).toMatchObject({
      local: 'CD El Peñón',
      destination_region: 'Región Metropolitana de Santiago',
      destination_city: 'San Bernardo',
    })
  })

  it('destinos can be removed', () => {
    render(<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} />)
    fireEvent.click(screen.getByText('Agregar destino'))
    expect(screen.getByLabelText('Nombre destino 1')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Quitar destino 1'))
    expect(screen.queryByLabelText('Nombre destino 1')).not.toBeInTheDocument()
  })
})
