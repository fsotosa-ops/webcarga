import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: {
    // Eco lo que se manda: el test de "guardar recien despues" necesita que
    // lo que vuelve del PATCH sea lo que de verdad se guardaria, para poder
    // simular al padre real (condiciones-tab.tsx) propagandolo de vuelta.
    patchConditions: vi.fn((id: string, body: Record<string, unknown>) =>
      Promise.resolve({ id, requirement_code: 'MANTENCION_FRIO', ...body })),
    recalcPreview:   vi.fn().mockResolvedValue({ crear: 0, quitar: 16, bloqueados: 4 }),
    recalc:          vi.fn().mockResolvedValue({ creados: 0, quitados: 16, bloqueados: 4 }),
  },
}))
vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => true }))

import { requirementsApi } from '@/lib/api/requirements'
import { RequirementConditionsPanel } from './RequirementConditionsPanel'
import type { RequirementConditions } from '@/lib/types'

const REQ: RequirementConditions = {
  id: 'r1', requirement_code: 'MANTENCION_FRIO', name: 'Mantención Cámara de Frío',
  target_entity: 'ASSET', is_active: true,
  applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
}
const SUBTIPOS = [
  { id: 't1', label: 'Furgón Congelado / Refrigerado' },
  { id: 't2', label: 'Furgón Seco' },
]

// Simula al padre real (condiciones-tab.tsx via useConfigList().setItems):
// propaga lo que devuelve el PATCH hacia el prop, no lo asume localmente.
function Harness({ over = {} }: { over?: Partial<typeof REQ> }) {
  const [requisito, setRequisito] = useState({ ...REQ, ...over })
  return (
    <RequirementConditionsPanel
      requisito={requisito}
      subtipos={SUBTIPOS}
      onSaved={patch => setRequisito(r => ({ ...r, ...patch }))}
    />
  )
}

function setup(over = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness over={over} />
    </QueryClientProvider>,
  )
}

// A diferencia de Harness (que sólo actualiza el prop vía onSaved, como
// resultado de un guardado de ESTE panel), este simula una recarga externa
// de la lista -- "Reintentar" en LoadState, otra pestaña, otro usuario --
// que cambia `requisito` sin que el panel haya iniciado nada.
function HarnessExterno({ inicial, actualizado }: { inicial: RequirementConditions; actualizado: RequirementConditions }) {
  const [requisito, setRequisito] = useState(inicial)
  return (
    <div>
      <button type="button" onClick={() => setRequisito(actualizado)}>Recargar</button>
      <RequirementConditionsPanel requisito={requisito} subtipos={SUBTIPOS} />
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('RequirementConditionsPanel', () => {
  it('un requisito sin restriccion lo dice, en vez de mostrar cero marcas', () => {
    setup()
    expect(screen.getByText(/aplica a todos/i)).toBeInTheDocument()
  })

  it('tildar una casilla no guarda nada todavia', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Furgón Congelado / Refrigerado'))
    expect(requirementsApi.patchConditions).not.toHaveBeenCalled()
  })

  it('guardar manda el conjunto completo de marcas, no solo la ultima tildada', async () => {
    setup()
    fireEvent.click(screen.getByLabelText('Furgón Congelado / Refrigerado'))
    fireEvent.click(screen.getByLabelText('Furgón Seco'))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_fleet_service_type_ids: ['t1', 't2'] }))
  })

  it('con cambios sin guardar, ver que cambia queda deshabilitado', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Furgón Congelado / Refrigerado'))
    expect(screen.getByRole('button', { name: /ver qué cambia/i })).toBeDisabled()
  })

  it('no aplica el cambio sin mostrar antes que va a pasar', async () => {
    setup()
    fireEvent.click(screen.getByLabelText('Furgón Congelado / Refrigerado'))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    // Recien habilitado una vez que el padre confirmo el guardado (prop
    // resincronizada), no apenas se dispara la mutacion.
    await waitFor(() => expect(screen.getByRole('button', { name: /ver qué cambia/i })).not.toBeDisabled())

    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    expect(await screen.findByText(/se quitan 16/i)).toBeInTheDocument()
    expect(requirementsApi.recalc).not.toHaveBeenCalled()
  })

  it('aplicar no existe hasta que llega la vista previa', async () => {
    setup()
    expect(screen.queryByRole('button', { name: /aplicar/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    expect(screen.queryByRole('button', { name: /aplicar/i })).not.toBeInTheDocument()

    await screen.findByText(/se quitan 16/i)
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeInTheDocument()
  })

  it('nombra los que no puede quitar, en vez de esconderlos', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    expect(await screen.findByText(/4 .*documento/i)).toBeInTheDocument()
  })

  it('aplicar recien despues de la vista previa, y pide confirmacion', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se quitan 16/i)
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))

    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(requirementsApi.recalc).toHaveBeenCalledWith('r1'))
  })

  it('si se cancela la confirmacion, no aplica nada', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se quitan 16/i)
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))

    // No es una asercion inmediata: si `aplicar.mutate()` se hubiera
    // disparado igual que si `window.confirm` nunca se hubiera consultado,
    // `recalc` arranca dentro de la cadena de microtareas del click. `act`
    // drena esa cola pendiente antes de que sigamos -- no es una espera de
    // reloj, es "dejar correr lo que ya esta encolado". onSuccess de la
    // mutacion esconde la vista previa (`setVerPreview(false)`), asi que la
    // prueba mas fuerte de que NO se disparo es que la vista previa siga ahi.
    await act(async () => {})
    expect(requirementsApi.recalc).not.toHaveBeenCalled()
    expect(screen.getByText(/se quitan 16/i)).toBeInTheDocument()
  })

  it('tildar una casilla tras ver la vista previa deja aplicar deshabilitado', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se quitan 16/i)

    fireEvent.click(screen.getByLabelText('Furgón Seco'))

    expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled()
  })

  it('si aplicar falla se ve el error', async () => {
    vi.mocked(requirementsApi.recalc).mockRejectedValueOnce(new Error('fallo del recalculo'))
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se quitan 16/i)
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))

    expect(await screen.findByText(/fallo del recalculo/i)).toBeInTheDocument()
  })

  it('guardar refresca la vista previa si estaba abierta', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se quitan 16/i)
    expect(requirementsApi.recalcPreview).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('Furgón Seco'))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(requirementsApi.recalcPreview).toHaveBeenCalledTimes(2))
  })

  it('si la lista se recarga externamente, las casillas reflejan el dato nuevo', () => {
    const actualizado: RequirementConditions = { ...REQ, applies_to_fleet_service_type_ids: ['t1'] }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <HarnessExterno inicial={REQ} actualizado={actualizado} />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText('Furgón Congelado / Refrigerado')).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: /recargar/i }))

    expect(screen.getByLabelText('Furgón Congelado / Refrigerado')).toBeChecked()
  })

  it('si guardar falla se ve el error y el boton no pasa a guardado', async () => {
    vi.mocked(requirementsApi.patchConditions).mockRejectedValueOnce(new Error('fallo de red'))
    setup()
    fireEvent.click(screen.getByLabelText('Furgón Congelado / Refrigerado'))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    expect(await screen.findByText(/fallo de red/i)).toBeInTheDocument()
    expect(screen.queryByText(/^guardado$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar/i })).toBeInTheDocument()
  })

  it('un requisito no vigente lo dice', () => {
    setup({ is_active: false })
    expect(screen.getByText(/no está vigente/i)).toBeInTheDocument()
  })

  it('un no admin no puede tocar las casillas ni aplicar', async () => {
    vi.resetModules()
    vi.doMock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => false }))
    const { RequirementConditionsPanel: SoloLectura } = await import('./RequirementConditionsPanel')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SoloLectura requisito={REQ} subtipos={SUBTIPOS} />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: /aplicar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Furgón Congelado / Refrigerado')).toBeDisabled()
  })

  it('un requisito de empresa muestra las casillas de tipo de gestion, no las de subtipo', () => {
    setup({ target_entity: 'CARRIER' })
    expect(screen.getByLabelText('Tractoreo')).toBeInTheDocument()
    expect(screen.getByLabelText('Equipo Completo')).toBeInTheDocument()
    expect(screen.queryByLabelText('Furgón Congelado / Refrigerado')).not.toBeInTheDocument()
  })

  it('un requisito de conductor no tiene casillas de condicion, pero si bloque de vigencia', () => {
    // I1 + su consecuencia directa: is_active paso a ser editable, y por eso
    // los requisitos de conductor (cuya UNICA regla es is_active) necesitan
    // el mismo bloque de vista previa/aplicar que los demas -- si no, se
    // podrian apagar desde la pantalla sin ninguna via para reconciliar los
    // registros que dejan de corresponder.
    setup({ target_entity: 'DRIVER' })
    expect(screen.getByText(/todos los conductores/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Furgón Congelado / Refrigerado')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tractoreo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Vigente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ver qué cambia/i })).toBeInTheDocument()
  })

  it('apagar la vigencia de un requisito de conductor lo deja guardable, y guardar manda solo is_active', async () => {
    setup({ target_entity: 'DRIVER' })
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Vigente'))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { is_active: false }))
  })

  it('tildar la vigencia ensucia el panel igual que una condicion', () => {
    setup({ target_entity: 'ASSET' })
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Vigente'))

    expect(screen.getByRole('button', { name: /guardar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ver qué cambia/i })).toBeDisabled()
  })

  it('guardar con vigencia Y condicion tocadas manda las dos claves en el mismo PATCH', async () => {
    setup({ target_entity: 'ASSET' })
    fireEvent.click(screen.getByLabelText('Vigente'))
    fireEvent.click(screen.getByLabelText('Furgón Seco'))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_fleet_service_type_ids: ['t2'], is_active: false }))
  })

  it('guardar sin tocar la vigencia no la incluye en el body', async () => {
    setup({ target_entity: 'ASSET' })
    fireEvent.click(screen.getByLabelText('Furgón Seco'))
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_fleet_service_type_ids: ['t2'] }))
    const bodySent = vi.mocked(requirementsApi.patchConditions).mock.calls[0][1]
    expect('is_active' in bodySent).toBe(false)
  })

  it('un no admin no puede tocar la casilla de vigencia', async () => {
    vi.resetModules()
    vi.doMock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => false }))
    const { RequirementConditionsPanel: SoloLectura } = await import('./RequirementConditionsPanel')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SoloLectura requisito={REQ} subtipos={SUBTIPOS} />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText('Vigente')).toBeDisabled()
  })

  it('si el prop se recarga externamente, la casilla de vigencia refleja el dato nuevo', () => {
    const actualizado: RequirementConditions = { ...REQ, is_active: false }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <HarnessExterno inicial={REQ} actualizado={actualizado} />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText('Vigente')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: /recargar/i }))

    expect(screen.getByLabelText('Vigente')).not.toBeChecked()
  })
})
