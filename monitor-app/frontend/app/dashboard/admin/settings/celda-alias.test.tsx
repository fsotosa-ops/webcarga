import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RequirementOption } from '@/lib/types'
import { CeldaAlias } from './celdas-editables'

vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: { addAlias: vi.fn(), removeAlias: vi.fn(), patchConditions: vi.fn() },
}))
import { requirementsApi } from '@/lib/api/requirements'

/** El contrato real de `RequirementOption`, copiado de su definición y no
 *  inferido del nombre: un mock con la forma equivocada hace pasar el test por
 *  la razón incorrecta, y este repo ya lo pagó una vez. */
function requisito(patch: Partial<RequirementOption> = {}): RequirementOption {
  return {
    id: 'r1', target_entity: 'CARRIER', requirement_code: 'F30_MULTAS',
    name: 'F30 Multas', requirement_level: 'LEGAL_MANDATORY',
    has_expiration: true, expiration_policy: 'REQUIRED', is_active: true,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 39, universo: 39 },
    aliases: ['F30'],
    ...patch,
  }
}

function montar(r: RequirementOption, puedeEditar = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CeldaAlias requisito={r} puedeEditar={puedeEditar} />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('CeldaAlias', () => {
  it('muestra cómo se reconoce el documento en el nombre del archivo', () => {
    montar(requisito({ aliases: ['F30', 'F 30 MULTAS'] }))
    expect(screen.getByText('F30')).toBeInTheDocument()
    expect(screen.getByText('F 30 MULTAS')).toBeInTheDocument()
  })

  // Un documento sin alias es INVISIBLE para el clasificador: sus archivos caen
  // en "sin resolver" y nada falla. Una celda vacía se lee como "no hay nada
  // que ver"; acá hay algo que arreglar, y tiene que decirlo.
  it('avisa cuando el documento no se reconoce en ningún archivo', () => {
    montar(requisito({ aliases: [] }))
    expect(screen.getByText(/no se reconoce/i)).toBeInTheDocument()
  })

  // "No sé" y "no tiene ninguno" son cosas distintas. El campo llega opcional
  // porque frontend y API se despliegan por separado, y esa ventana es real.
  it('distingue "todavía no llegó el dato" de "no tiene ninguno"', () => {
    montar(requisito({ aliases: undefined }))
    expect(screen.queryByText(/no se reconoce/i)).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('agrega otra forma de escribirlo', async () => {
    montar(requisito())
    fireEvent.click(screen.getByRole('button', { name: /agregar otra forma/i }))
    const campo = screen.getByRole('textbox')
    fireEvent.change(campo, { target: { value: 'FORMULARIO 30' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    // `mutate` dispara la petición de forma asíncrona: sin esperar, la
    // aserción corre antes de que React Query llame al mutationFn.
    await waitFor(() =>
      expect(requirementsApi.addAlias).toHaveBeenCalledWith('r1', 'FORMULARIO 30'))
  })

  it('escribir a medias y arrepentirse no guarda nada', () => {
    montar(requisito())
    fireEvent.click(screen.getByRole('button', { name: /agregar otra forma/i }))
    const campo = screen.getByRole('textbox')
    fireEvent.change(campo, { target: { value: 'A MEDIAS' } })
    fireEvent.keyDown(campo, { key: 'Escape' })
    expect(requirementsApi.addAlias).not.toHaveBeenCalled()
  })

  it('sin permiso se ve pero no se edita', () => {
    montar(requisito(), false)
    expect(screen.getByText('F30')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agregar otra forma/i })).not.toBeInTheDocument()
  })
})
