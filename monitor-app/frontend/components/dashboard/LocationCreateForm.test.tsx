import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocationCreateForm } from './LocationCreateForm'
import { locationsApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { create: vi.fn() },
}))

const CREATED: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: null,
  name: 'Local Nuevo', country_code: 'CL', format: null, address: null,
  region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: null, operational_status: 'ACTIVE', created_at: null, updated_at: null,
}

beforeEach(() => {
  vi.mocked(locationsApi.create).mockReset()
})

describe('LocationCreateForm', () => {
  it('shows only the trigger button until clicked', () => {
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    expect(screen.getByText('Nuevo local')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre del local nuevo')).not.toBeInTheDocument()
  })

  it('opens the form and requires a name before creating', () => {
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.click(screen.getByText('Crear local'))
    expect(screen.getByText('Nombre es requerido')).toBeInTheDocument()
    expect(locationsApi.create).not.toHaveBeenCalled()
  })

  it('creates the location and calls onCreated with the result', async () => {
    vi.mocked(locationsApi.create).mockResolvedValue(CREATED)
    const onCreated = vi.fn()
    render(<LocationCreateForm shipperId="shipper-1" onCreated={onCreated} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED))
    expect(locationsApi.create).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'SHIPPER', entity_id: 'shipper-1', name: 'Local Nuevo',
    }))
  })

  it('closes the form back to the trigger after a successful create', async () => {
    vi.mocked(locationsApi.create).mockResolvedValue(CREATED)
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))
    await waitFor(() => expect(screen.getByText('Nuevo local')).toBeInTheDocument())
  })

  it('shows an error and keeps the form open when create fails', async () => {
    vi.mocked(locationsApi.create).mockRejectedValue(new Error('Ya existe un local con ese nombre'))
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))
    expect(await screen.findByText('Ya existe un local con ese nombre')).toBeInTheDocument()
  })

  it('cancel button clears the draft and returns to the trigger', () => {
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.click(screen.getByText('Cancelar'))
    expect(screen.getByText('Nuevo local')).toBeInTheDocument()
  })
})
