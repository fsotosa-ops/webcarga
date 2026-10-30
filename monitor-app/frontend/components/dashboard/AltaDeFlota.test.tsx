import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/lib/api/assets', () => ({
  assetsApi: {
    types: vi.fn().mockResolvedValue([
      { code: 'TRACTOCAMION', label: 'Tractocamión', is_power_unit: true },
      { code: 'RAMPLA', label: 'Rampla', is_power_unit: false },
    ]),
    create: vi.fn(),
  },
}))
vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn().mockResolvedValue([{ id: 's1', label: 'Furgón Seco' }]) },
}))
vi.mock('@/lib/api/locations', () => ({ locationsApi: { list: vi.fn().mockResolvedValue({ data: [] }) } }))
vi.mock('@/lib/api/drivers', () => ({ driversApi: { create: vi.fn() } }))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { assignDriver: vi.fn().mockResolvedValue(undefined), assignAsset: vi.fn(), list: vi.fn().mockResolvedValue({ data: [] }) },
}))

import { AltaDeFlota } from './AltaDeFlota'
import { driversApi } from '@/lib/api/drivers'
import { ApiError } from '@/lib/api/client'

function conCliente(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

beforeEach(() => { vi.mocked(driversApi.create).mockReset() })

/** El de guardar, en el pie: el disparador de afuera se llama igual. */
const botonGuardar = () => within(screen.getByRole('dialog')).getByRole('button', { name: /Agregar conductor|Guardando/ })

describe('AltaDeFlota', () => {
  it('se abre en un diálogo que dice a qué empresa queda asignado', () => {
    conCliente(<AltaDeFlota tipo="conductor" carrierId="c1" nombreEmpresa="Transportes Andina SpA" onCreado={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar conductor' }))
    const dialogo = screen.getByRole('dialog', { name: 'Agregar conductor' })
    expect(dialogo).toHaveAccessibleDescription('Queda asignado a Transportes Andina SpA.')
  })

  it('los campos tienen etiqueta visible y el botón se habilita con los obligatorios', () => {
    conCliente(<AltaDeFlota tipo="conductor" carrierId="c1" abiertoAlInicio onCreado={vi.fn()} />)
    const guardar = botonGuardar()
    expect(guardar).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/RUT/), { target: { value: '16.428.339-1' } })
    expect(guardar).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: 'Ana Pérez' } })
    expect(guardar).toBeEnabled()
  })

  it('Enter guarda: los campos van dentro de un formulario', async () => {
    vi.mocked(driversApi.create).mockResolvedValue({ id: 'd1', full_name: 'Ana Pérez' } as never)
    const onCreado = vi.fn()
    conCliente(<AltaDeFlota tipo="conductor" carrierId="c1" abiertoAlInicio onCreado={onCreado} />)
    fireEvent.change(screen.getByLabelText(/RUT/), { target: { value: '16.428.339-1' } })
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: 'Ana Pérez' } })
    fireEvent.submit(screen.getByLabelText(/Nombre completo/).closest('form')!)
    await waitFor(() => expect(onCreado).toHaveBeenCalledWith('c1', { id: 'd1', full_name: 'Ana Pérez' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('el RUT que informó el TMS se muestra de solo lectura', () => {
    conCliente(<AltaDeFlota tipo="conductor" carrierId={null} rutFijo="8245112-9" abiertoAlInicio onCreado={vi.fn()} />)
    const rut = screen.getByLabelText(/RUT/)
    expect(rut).toHaveValue('8245112-9')
    expect(rut).toHaveAttribute('readonly')
    expect(rut).toHaveAccessibleDescription('Lo informó el TMS.')
  })

  it('sin empresa de antemano, la pide con su consecuencia', () => {
    conCliente(<AltaDeFlota tipo="conductor" carrierId={null} abiertoAlInicio onCreado={vi.fn()} />)
    expect(screen.getByLabelText('Empresa')).toHaveAccessibleDescription(/Sin empresa no entra al cierre del día/)
  })

  it('un RUT que ya existe muestra el error y la salida, sin cerrar el diálogo', async () => {
    vi.mocked(driversApi.create).mockRejectedValue(new ApiError('Ya está registrado.', 409, {
      code: 'CONDUCTOR_YA_EXISTE', driver_id: 'd9', full_name: 'JAIME VIDAL', message: 'Ya está registrado.',
    }))
    const usar = vi.fn()
    conCliente(<AltaDeFlota tipo="conductor" carrierId="c1" abiertoAlInicio onCreado={vi.fn()}
                            yaExiste={{ accion: n => `Asignar a ${n}`, usar }} />)
    fireEvent.change(screen.getByLabelText(/RUT/), { target: { value: '8245112-9' } })
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: 'Jaime Vidal' } })
    fireEvent.click(botonGuardar())
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya está registrado.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Asignar a/ }))
    await waitFor(() => expect(usar).toHaveBeenCalledWith(expect.objectContaining({ driver_id: 'd9' })))
  })

  it('mientras guarda, Escape no lo cierra', async () => {
    vi.mocked(driversApi.create).mockReturnValue(new Promise(() => {}))
    conCliente(<AltaDeFlota tipo="conductor" carrierId="c1" abiertoAlInicio onCreado={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/RUT/), { target: { value: '16.428.339-1' } })
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: 'Ana Pérez' } })
    fireEvent.click(botonGuardar())
    expect(await screen.findByRole('button', { name: /Guardando/ })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Cancelar descarta lo escrito y vuelve a lo precargado', () => {
    conCliente(<AltaDeFlota tipo="conductor" carrierId="c1" prefill="Ana Pérez" onCreado={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar conductor' }))
    fireEvent.change(screen.getByLabelText(/RUT/), { target: { value: '16.428.339-1' } })
    fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: 'Otra persona' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar conductor' }))
    expect(screen.getByLabelText(/RUT/)).toHaveValue('')
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('Ana Pérez')
  })

  it('la carrocería se ofrece para una rampla, no para un tracto', async () => {
    conCliente(<AltaDeFlota tipo="equipo" carrierId="c1" abiertoAlInicio onCreado={vi.fn()} />)
    const tipo = await screen.findByRole('combobox', { name: 'Tipo de vehículo' })
    await screen.findByRole('option', { name: 'Rampla' })
    expect(tipo).toHaveValue('TRACTOCAMION')
    expect(screen.queryByRole('combobox', { name: 'Carrocería' })).not.toBeInTheDocument()
    fireEvent.change(tipo, { target: { value: 'RAMPLA' } })
    expect(screen.getByRole('combobox', { name: 'Carrocería' })).toBeInTheDocument()
  })
})
