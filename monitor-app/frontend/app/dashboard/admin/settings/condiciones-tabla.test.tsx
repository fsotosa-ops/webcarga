import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequirementOption } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listRequirements: vi.fn() },
}))
vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn() },
}))
vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: { patchConditions: vi.fn(), recalcPreview: vi.fn(), recalc: vi.fn() },
}))
vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => true }))

// El documento abierto VIAJA EN LA URL, como un viaje del Monitor: cada test
// elige qué trae.
let urlActual = ''
const reemplazar = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar }),
  usePathname: () => '/dashboard/admin/settings/certification',
  useSearchParams: () => new URLSearchParams(urlActual),
}))

import { complianceApi } from '@/lib/api/compliance'
import { taxonomiesApi } from '@/lib/api/config'
import { CondicionesTabla } from './condiciones-tabla'

const BASE = {
  requirement_level: 'SHIPPER_REQUIRED',
  has_expiration: true,
} as const

// MANTENCION_FRIO alcanza 36 de 118 vehículos: su regla lista 9 subtipos y 3
// tienen vehículos. Es el dato real de producción, y coincide con sus 36
// registros vigentes.
// El orden de llegada NO coincide con el alfabético del nombre: si coincidiera,
// ordenar por documento daría el mismo resultado que no ordenar y el test
// pasaría sin probar nada.
const REQS: RequirementOption[] = [
  { ...BASE, id: 'r2', requirement_code: 'REVISION_TECNICA', name: 'Revisión Técnica',
    target_entity: 'ASSET', is_active: true,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 118, universo: 118 } },
  { ...BASE, id: 'r1', requirement_code: 'MANTENCION_FRIO', name: 'Mantención Cámara de Frío',
    target_entity: 'ASSET', is_active: true,
    applies_to_fleet_service_type_ids: ['t1'], applies_to_management_types: null,
    alcance: { alcanzadas: 36, universo: 118 } },
  // Apagado y sin condición: el backend informa 248 de 248 porque `alcanzadas`
  // cuenta la condición, no la vigencia.
  { ...BASE, id: 'r3', requirement_code: 'SEGURO_EETT', name: 'Seguro EETT',
    target_entity: 'CARRIER', is_active: false,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 248, universo: 248 } },
]

const SUBTIPOS = [
  { id: 't1', label: 'Furgón Congelado', bg_color: '#fff', text_color: '#000', sort_order: 1, active: true },
]

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CondicionesTabla />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  urlActual = ''
  reemplazar.mockClear()
  vi.mocked(complianceApi.listRequirements).mockReset()
  vi.mocked(complianceApi.listRequirements).mockResolvedValue(REQS)
  vi.mocked(taxonomiesApi.list).mockReset()
  vi.mocked(taxonomiesApi.list).mockResolvedValue(SUBTIPOS)
})

describe('CondicionesTabla', () => {
  // El cambio central: la regla se ENUNCIA. Antes eran diez casillas por
  // requisito, dibujadas aunque 35 de 37 no tuvieran ninguna marcada.
  it('enuncia la regla en una frase, sin casillas', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Sólo Furgón Congelado')).toBeInTheDocument())
    expect(screen.getByText('Todos los vehículos')).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('dice a cuántas entidades alcanza', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('36 de 118')).toBeInTheDocument())
  })

  it('la entidad es una columna, no un encabezado de grupo', async () => {
    montar()
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /entidad/i })).toBeInTheDocument())
  })

  it('ordena por documento al hacer clic en su encabezado', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    // De entrada manda la entidad, que es el orden por defecto.
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Revisión Técnica')

    fireEvent.click(screen.getByRole('button', { name: /documento/i }))
    const filas = screen.getAllByRole('row').slice(1)
    expect(filas[0]).toHaveTextContent('Mantención Cámara de Frío')
    expect(filas[1]).toHaveTextContent('Revisión Técnica')
    expect(filas[2]).toHaveTextContent('Seguro EETT')
  })

  it('el encabezado ordenado lo declara de forma accesible', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /documento/i }))
    expect(screen.getByRole('columnheader', { name: /documento/i }))
      .toHaveAttribute('aria-sort', 'ascending')
  })

  it('el chip de con condición filtra', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /con condición/i }))
    expect(screen.queryByText('Revisión Técnica')).not.toBeInTheDocument()
    expect(screen.getByText('Mantención Cámara de Frío')).toBeInTheDocument()
  })

  it('el chip de sin vigencia filtra', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sin vigencia/i }))
    expect(screen.getByText('Seguro EETT')).toBeInTheDocument()
    expect(screen.queryByText('Revisión Técnica')).not.toBeInTheDocument()
  })

  // "FRIO" sin tilde NO está en el nombre ("Mantención Cámara de Frío"), sólo
  // en el código: es lo único que distingue buscar por código de buscar por
  // nombre, y el código es como se nombra un documento entre sistemas.
  it('la búsqueda encuentra por código, no sólo por nombre', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/buscar documento/i), { target: { value: 'FRIO' } })
    expect(screen.getByText('Mantención Cámara de Frío')).toBeInTheDocument()
    expect(screen.queryByText('Revisión Técnica')).not.toBeInTheDocument()
    expect(screen.queryByText('Seguro EETT')).not.toBeInTheDocument()
  })

  it('sin coincidencias lo dice, en vez de mostrar una tabla vacía', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/buscar documento/i), { target: { value: 'zzz' } })
    expect(screen.getByText(/ningún documento coincide/i)).toBeInTheDocument()
  })

  // `alcance.alcanzadas` cuenta la condición, no la vigencia: el backend
  // informa 248 de 248 para un requisito apagado. Leído literal, la fila diría
  // "Todas las empresas · 248 de 248 · Sin vigencia" y se contradiría sola.
  it('una fila sin vigencia no dice que se le exige a todas', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Seguro EETT')).toBeInTheDocument())
    expect(screen.queryByText('Todas las empresas')).not.toBeInTheDocument()
    expect(screen.getByText('No se exige')).toBeInTheDocument()
    expect(screen.getByText('Alcanzaría a 248 de 248')).toBeInTheDocument()
  })

  // El chevron es el único camino a la edición: sin nombre, un lector de
  // pantalla anuncia 37 botones idénticos.
  it('cada fila ofrece abrirse, y el botón nombra la fila', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /revisión técnica/i })).toBeInTheDocument()
  })

  // El panel abre con URL propia, como abre un viaje: editar una regla es
  // enlazable, y recargar no te devuelve a la lista.
  it('el chevron escribe el documento en la URL', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /editar revisión técnica/i }))
    expect(reemplazar).toHaveBeenCalledWith(
      '/dashboard/admin/settings/certification?doc=REVISION_TECNICA')
  })

  it('abrir un documento no pierde el resto de la URL', async () => {
    urlActual = 'section=conditions'
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /editar revisión técnica/i }))
    expect(reemplazar).toHaveBeenCalledWith(
      '/dashboard/admin/settings/certification?section=conditions&doc=REVISION_TECNICA')
  })

  it('con un documento en la URL el panel abre solo', async () => {
    urlActual = 'doc=MANTENCION_FRIO'
    montar()
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /mantención cámara de frío/i })).toBeInTheDocument())
  })

  it('cerrar el panel quita el documento de la URL', async () => {
    urlActual = 'doc=MANTENCION_FRIO'
    montar()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/certification')
  })

  it('un documento que no existe en el catálogo no abre ningún panel', async () => {
    urlActual = 'doc=NO_EXISTE'
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('avisa cuando el catálogo no carga, y deja reintentar', async () => {
    vi.mocked(complianceApi.listRequirements).mockRejectedValue(new Error('sin red'))
    montar()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument())
  })
})
