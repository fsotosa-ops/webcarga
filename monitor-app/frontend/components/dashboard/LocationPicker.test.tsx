import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocationPicker } from './LocationPicker'
import { locationsApi } from '@/lib/api/locations'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn() },
}))

function renderPicker(props: Partial<Parameters<typeof LocationPicker>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <LocationPicker value="" onChange={vi.fn()} ariaLabel="Origen" {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue({ data: [], count: 0, page: 1, limit: 8 })
})

describe('LocationPicker', () => {
  it('renders a plain text input with the given aria-label', () => {
    renderPicker({ ariaLabel: 'Origen' })
    expect(screen.getByLabelText('Origen')).toHaveValue('')
  })

  it('calls onChange on every keystroke, same as a plain input', () => {
    const onChange = vi.fn()
    renderPicker({ onChange })
    fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'CD Lo Aguirre' } })
    expect(onChange).toHaveBeenCalledWith('CD Lo Aguirre')
  })

  it('no busca contra el backend con menos de 2 caracteres', async () => {
    renderPicker({ value: 'C' })
    fireEvent.focus(screen.getByLabelText('Origen'))
    await new Promise(r => setTimeout(r, 300))
    expect(locationsApi.list).not.toHaveBeenCalled()
  })

  it('busca locales existentes y los muestra como sugerencias', async () => {
    vi.mocked(locationsApi.list).mockResolvedValue({
      data: [{
        id: 'loc-1', entity_type: 'SHIPPER', entity_id: 's1', site_number: '72',
        name: 'CD Puerto Santiago 1', country_code: 'CL', format: null, address: null,
        region_name: null, region_number: null, opens_at: null, closes_at: null,
        operation_type: 'RM', operational_status: 'ACTIVE', is_manual_override: false,
        created_at: null, updated_at: null,
      }],
      count: 1, page: 1, limit: 8,
    })
    renderPicker({ value: 'puerto' })
    fireEvent.focus(screen.getByLabelText('Origen'))
    expect(await screen.findByText('CD Puerto Santiago 1')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(locationsApi.list).toHaveBeenCalledWith({ q: 'puerto', operational_status: 'ACTIVE', limit: 8 })
  })

  it('elegir una sugerencia llama a onChange con el nombre exacto del local y cierra el dropdown', async () => {
    vi.mocked(locationsApi.list).mockResolvedValue({
      data: [{
        id: 'loc-1', entity_type: 'SHIPPER', entity_id: 's1', site_number: null,
        name: 'CD PUERTO SANTIAGO 1', country_code: 'CL', format: null, address: null,
        region_name: null, region_number: null, opens_at: null, closes_at: null,
        operation_type: null, operational_status: 'ACTIVE', is_manual_override: false,
        created_at: null, updated_at: null,
      }],
      count: 1, page: 1, limit: 8,
    })
    const onChange = vi.fn()
    renderPicker({ value: 'puerto', onChange })
    fireEvent.focus(screen.getByLabelText('Origen'))
    fireEvent.click(await screen.findByText('CD PUERTO SANTIAGO 1'))
    expect(onChange).toHaveBeenCalledWith('CD PUERTO SANTIAGO 1')
    await waitFor(() => expect(screen.queryByText('CD PUERTO SANTIAGO 1')).not.toBeInTheDocument())
  })

  it('muestra aviso de "sin locales existentes" cuando la búsqueda no encuentra nada', async () => {
    renderPicker({ value: 'zzz-inexistente' })
    fireEvent.focus(screen.getByLabelText('Origen'))
    expect(await screen.findByText(/Sin locales existentes/)).toBeInTheDocument()
  })
})
