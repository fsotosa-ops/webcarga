import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/config', () => ({
  busquedaConfigApi: { buscar: vi.fn() },
}))
import { busquedaConfigApi } from '@/lib/api/config'
import { BuscadorConfig } from './BuscadorConfig'

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BuscadorConfig />
    </QueryClientProvider>,
  )
}

function escribir(texto: string) {
  fireEvent.change(screen.getByLabelText(/buscar un ajuste/i), { target: { value: texto } })
}

const FRIO = [
  { domain: 'certification', section: 'conditions', id: 'r1', label: 'Mantención Cámara de Frío' },
  { domain: 'operations', section: 'temperature-ranges', id: 'FRIO', label: 'Frío' },
]

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.mocked(busquedaConfigApi.buscar).mockReset()
  vi.mocked(busquedaConfigApi.buscar).mockResolvedValue(FRIO)
})

describe('BuscadorConfig', () => {
  // Busca sobre el CONTENIDO, no sobre los títulos de sección: "frío"
  // encuentra la condición de Certificación y el rango de Operaciones. Es lo
  // que hace que el módulo escale a 20 o 200 ajustes.
  it('un resultado dice dónde vive, no sólo cómo se llama', async () => {
    montar()
    escribir('frio')
    await vi.advanceTimersByTimeAsync(300)

    await waitFor(() => expect(screen.getByText('Mantención Cámara de Frío')).toBeInTheDocument())
    expect(screen.getByText('Certificación · Condiciones de documentos')).toBeInTheDocument()
    expect(screen.getByText('Operaciones · Rangos de temperatura')).toBeInTheDocument()
  })

  // Las dos secciones con panel abren el elemento directo; el resto lleva a su
  // sección, que es lo más cerca que se llega sin inventarle un panel a una
  // tabla que no lo tiene.
  it('lleva al elemento cuando la sección sabe abrirlo', async () => {
    montar()
    escribir('frio')
    await vi.advanceTimersByTimeAsync(300)

    await waitFor(() => expect(screen.getByRole('option', { name: /cámara de frío/i }))
      .toHaveAttribute('href',
        '/dashboard/admin/settings/certification?section=conditions&doc=r1'))
    expect(screen.getByRole('option', { name: /^frío/i }))
      .toHaveAttribute('href', '/dashboard/admin/settings/operations?section=temperature-ranges')
  })

  // Con un caracter el resultado son casi todos los ajustes de la app: lo
  // mismo que no buscar, con una consulta de más.
  it('con una sola letra no consulta', async () => {
    montar()
    escribir('f')
    await vi.advanceTimersByTimeAsync(300)
    expect(busquedaConfigApi.buscar).not.toHaveBeenCalled()
  })

  // Sin esto, "temperatura" son once consultas de las que sólo la última
  // importa.
  it('espera a que la escritura pare antes de consultar', async () => {
    montar()
    escribir('fr')
    escribir('fri')
    escribir('frio')
    await vi.advanceTimersByTimeAsync(300)

    await waitFor(() => expect(busquedaConfigApi.buscar).toHaveBeenCalledTimes(1))
    expect(busquedaConfigApi.buscar).toHaveBeenCalledWith('frio')
  })

  it('sin coincidencias lo dice, en vez de no mostrar nada', async () => {
    vi.mocked(busquedaConfigApi.buscar).mockResolvedValue([])
    montar()
    escribir('zzz')
    await vi.advanceTimersByTimeAsync(300)

    await waitFor(() => expect(screen.getByText(/ningún ajuste coincide/i)).toBeInTheDocument())
  })

  // Un fallo de red que se dibuja como "no hay resultados" manda a buscar de
  // otra manera algo que sí está: es el defecto de los dos significados, otra
  // vez.
  it('un fallo de la búsqueda no se ve como "no hay nada"', async () => {
    vi.mocked(busquedaConfigApi.buscar).mockRejectedValue(new Error('sin red'))
    montar()
    escribir('frio')
    await vi.advanceTimersByTimeAsync(300)

    await waitFor(() => expect(screen.getByText(/no se pudo buscar/i)).toBeInTheDocument())
    expect(screen.queryByText(/ningún ajuste coincide/i)).not.toBeInTheDocument()
  })
})
