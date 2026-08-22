import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: { create: vi.fn() },
}))
import { requirementsApi } from '@/lib/api/requirements'
import { NuevoDocumentoPanel } from './NuevoDocumentoPanel'

function montar(onCerrar = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NuevoDocumentoPanel onCerrar={onCerrar} />
    </QueryClientProvider>,
  )
  return onCerrar
}

const escribirNombre = (v: string) =>
  fireEvent.change(screen.getByLabelText('Nombre del documento'), { target: { value: v } })

beforeEach(() => {
  vi.mocked(requirementsApi.create).mockReset().mockResolvedValue({ id: 'r-nuevo' } as never)
})

describe('NuevoDocumentoPanel', () => {
  it('sin nombre no se puede crear', () => {
    montar()
    expect(screen.getByRole('button', { name: /^crear$/i })).toBeDisabled()
  })

  it('crea con nombre, quién lo presenta y si es obligatorio', async () => {
    const onCerrar = montar()
    escribirNombre('Certificado de Antecedentes')
    fireEvent.click(screen.getByRole('radio', { name: 'Conductor' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Opcional' }))
    fireEvent.click(screen.getByRole('button', { name: /^crear$/i }))

    await waitFor(() => expect(requirementsApi.create).toHaveBeenCalledWith({
      name: 'Certificado de Antecedentes',
      target_entity: 'DRIVER',
      requirement_level: 'CONDITIONAL_OPTIONAL',
    }))
    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
  })

  // El codigo es la llave de los alias y del motor de match. Verlo ANTES de
  // crear evita la sorpresa de descubrir despues con cual quedo -- y que
  // alguien intente cambiarlo, que es lo que no se puede.
  it('muestra el código que se va a derivar del nombre', () => {
    montar()
    escribirNombre('F30 Multas')
    expect(screen.getByText(/F30_MULTAS/)).toBeInTheDocument()
  })

  it('el código pierde los acentos y la puntuación', () => {
    montar()
    escribirNombre('Póliza de Seguro (vigente)')
    expect(screen.getByText(/POLIZA_DE_SEGURO_VIGENTE/)).toBeInTheDocument()
  })

  // Si no se dice, alguien crea el documento, no lo ve en ninguna empresa y
  // cree que fallo. Y es la razon por la que el alta no es una escritura
  // masiva: apagado no le aplica a nadie.
  it('avisa que nace sin vigencia, antes de crear', () => {
    montar()
    expect(screen.getByText(/sin vigencia/i)).toBeInTheDocument()
    expect(screen.getByText(/todavía no se le va a pedir a nadie/i)).toBeInTheDocument()
  })

  it('no hay campo para el código: se deriva, no se escribe', () => {
    montar()
    const campos = screen.getAllByRole('textbox')
    expect(campos).toHaveLength(1)
    expect(campos[0]).toHaveAccessibleName('Nombre del documento')
  })

  it('si crear falla lo dice y no cierra el panel', async () => {
    vi.mocked(requirementsApi.create).mockRejectedValue(
      new Error('Ya existe un documento de CARRIER con el codigo F30_MULTAS'))
    const onCerrar = montar()
    escribirNombre('F30 Multas')
    fireEvent.click(screen.getByRole('button', { name: /^crear$/i }))

    expect(await screen.findByText(/Ya existe un documento/)).toBeInTheDocument()
    expect(onCerrar).not.toHaveBeenCalled()
  })
})
