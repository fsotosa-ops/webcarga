import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequirementOption } from '@/lib/types'

vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: { patchConditions: vi.fn(), recalcPreview: vi.fn(), recalc: vi.fn() },
}))
const puedeAdministrar = vi.fn(() => true)
vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => puedeAdministrar() }))

import { requirementsApi } from '@/lib/api/requirements'
import { CondicionPanel } from './CondicionPanel'

// Vienen del catálogo, identificados por su CÓDIGO estable: el panel ya no
// los tiene escritos adentro.
const GESTIONES = [
  { id: 'TRACTOREO', label: 'Tractoreo' },
  { id: 'EQUIPO_COMPLETO', label: 'Equipo Completo' },
]

const SUBTIPOS = [
  { id: 't1', label: 'Furgón Congelado' },
  { id: 't2', label: 'Sider' },
]

function requisito(patch: Partial<RequirementOption> = {}): RequirementOption {
  return {
    id: 'r1',
    target_entity: 'ASSET',
    requirement_code: 'MANTENCION_FRIO',
    name: 'Mantención Cámara de Frío',
    requirement_level: 'SHIPPER_REQUIRED',
    has_expiration: true,
    is_active: true,
    applies_to_fleet_service_type_ids: null,
    applies_to_management_types: null,
    // MANTENCION_FRIO alcanza 36 de 118 vehículos: el dato real de producción.
    alcance: { alcanzadas: 36, universo: 118 },
    ...patch,
  }
}

const confirmar = vi.fn()

function montarPanel(r: RequirementOption = requisito(), onCerrar = vi.fn()) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const vista = render(
    <QueryClientProvider client={cliente}>
      <CondicionPanel requisito={r} subtipos={SUBTIPOS} gestiones={GESTIONES}
        revision={null} onConfirmar={confirmar} confirmando={false} onCerrar={onCerrar} />
    </QueryClientProvider>,
  )
  // Volver a dibujar con OTRO objeto requisito, como hace react-query cuando
  // refetchea el catálogo: mismo cliente, mismo panel montado.
  const redibujar = (otro: RequirementOption) => vista.rerender(
    <QueryClientProvider client={cliente}>
      <CondicionPanel requisito={otro} subtipos={SUBTIPOS} gestiones={GESTIONES}
        revision={null} onConfirmar={confirmar} confirmando={false} onCerrar={onCerrar} />
    </QueryClientProvider>,
  )
  return { onCerrar, vista, redibujar }
}

beforeEach(() => {
  puedeAdministrar.mockReturnValue(true)
  vi.mocked(requirementsApi.patchConditions).mockReset()
  vi.mocked(requirementsApi.patchConditions).mockResolvedValue({
    id: 'r1', requirement_code: 'MANTENCION_FRIO', is_active: true,
    applies_to_fleet_service_type_ids: [], applies_to_management_types: null,
  })
  vi.mocked(requirementsApi.recalcPreview).mockReset()
  vi.mocked(requirementsApi.recalcPreview).mockResolvedValue({ crear: 4, quitar: 1, bloqueados: 0 })
})

describe('CondicionPanel', () => {
  // El cambio que elimina las 167 casillas: primero la pregunta, y el selector
  // de subtipos aparece SÓLO si la respuesta lo necesita. 35 de 37 reglas se
  // resuelven sin ver un subtipo.
  it('pregunta a todos o a algunos, sin mostrar subtipos', () => {
    montarPanel()
    expect(screen.getByRole('radio', { name: /a todos los vehículos/i })).toBeChecked()
    expect(screen.queryByText(/furgón congelado/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sider/i)).not.toBeInTheDocument()
  })

  it('elegir "sólo a algunos" revela el selector', () => {
    montarPanel()
    fireEvent.click(screen.getByRole('radio', { name: /sólo a algunos/i }))
    expect(screen.getByRole('checkbox', { name: /furgón congelado/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /sider/i })).toBeInTheDocument()
  })

  it('una regla que ya tiene subtipos abre en "sólo a algunos", con los suyos marcados', () => {
    montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    expect(screen.getByRole('radio', { name: /sólo a algunos/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /sider/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /furgón congelado/i })).not.toBeChecked()
  })

  it('el panel se cierra con Escape', () => {
    const { onCerrar } = montarPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })

  it('guarda los subtipos elegidos', async () => {
    montarPanel()
    fireEvent.click(screen.getByRole('radio', { name: /sólo a algunos/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /sider/i }))
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_fleet_service_type_ids: ['t2'] }))
  })

  // Volver a "a todos" es guardar la lista vacía: para el catálogo, sin marcas
  // significa sin restricción. Si el panel no mandara nada, la condición vieja
  // seguiría vigente y la pantalla mostraría otra cosa que la base.
  it('volver a "a todos" borra la condición guardada', async () => {
    montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    fireEvent.click(screen.getByRole('radio', { name: /a todos los vehículos/i }))
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_fleet_service_type_ids: [] }))
  })

  it('sin cambios no ofrece guardar', () => {
    montarPanel()
    expect(screen.queryByRole('button', { name: /^guardar$/i })).not.toBeInTheDocument()
  })

  it('a una empresa le pregunta por tipo de gestión, no por subtipo de vehículo', () => {
    montarPanel(requisito({ target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO'] }))
    expect(screen.getByRole('radio', { name: /a todas las empresas/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /tractoreo/i })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /furgón congelado/i })).not.toBeInTheDocument()
  })

  it('guarda el tipo de gestión de una empresa', async () => {
    montarPanel(requisito({ target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: /equipo completo/i }))
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_management_types: ['TRACTOREO', 'EQUIPO_COMPLETO'] }))
  })

  // Los 12 requisitos de conductor no tienen condición: la única regla que se
  // les puede tocar es la vigencia.
  it('a un conductor no le pregunta nada que no se pueda contestar', () => {
    montarPanel(requisito({ target_entity: 'DRIVER' }))
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByText(/todos los conductores/i)).toBeInTheDocument()
  })

  it('la vigencia se apaga desde el panel', async () => {
    montarPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: /vigente/i }))
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_fleet_service_type_ids: [], is_active: false }))
  })

  // GET /config/taxonomies filtra active=true: un subtipo dado de baja que
  // siga en la condición no tiene casilla. Guardar sin él lo borraría en
  // silencio.
  it('una marca de un subtipo dado de baja se avisa y no se pierde al guardar', async () => {
    montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2', 'de-baja'] }))
    expect(screen.getByText(/dado de baja/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /furgón congelado/i }))
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(requirementsApi.patchConditions).toHaveBeenCalledWith(
      'r1', { applies_to_fleet_service_type_ids: ['t2', 'de-baja', 't1'] }))
  })

  it('sin permiso de administración el panel no edita', () => {
    puedeAdministrar.mockReturnValue(false)
    montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    expect(screen.getByRole('radio', { name: /sólo a algunos/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^guardar$/i })).not.toBeInTheDocument()
  })

  // Cambiar la regla puede crear o quitar cientos de registros: guardarla y
  // aplicarla son dos actos distintos, y el segundo se ve antes de confirmar.
  it('ofrece ver qué cambia antes de aplicar', async () => {
    montarPanel()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await waitFor(() => expect(screen.getByText(/se agregan 4/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^aplicar$/i })).toBeInTheDocument()
  })

  // Clase de bug recurrente en este proyecto: el borrador que no se
  // resincroniza cuando el prop cambia deja la pantalla mostrando lo viejo.
  it('si el requisito cambia, el borrador se resincroniza', () => {
    const { redibujar } = montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    redibujar(requisito({ applies_to_fleet_service_type_ids: null }))
    expect(screen.getByRole('radio', { name: /a todos los vehículos/i })).toBeChecked()
  })

  // La misma clase de bug, del otro lado: resincronizar DE MÁS. El catálogo
  // llega de react-query, que con refetchOnWindowFocus devuelve un objeto
  // nuevo aunque el contenido sea idéntico. Si el borrador se resincroniza por
  // IDENTIDAD del arreglo y no por su contenido, irse a otra ventana quince
  // segundos y volver borra lo que se venía editando, sin ningún mensaje.
  // Afecta sólo a los requisitos que YA tienen condición, que son justo los
  // dos de los que trata la pantalla.
  it('un refetch que devuelve lo mismo no borra lo que el usuario eligió', () => {
    const { redibujar } = montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: /furgón congelado/i }))
    expect(screen.getByRole('checkbox', { name: /furgón congelado/i })).toBeChecked()

    redibujar(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))

    expect(screen.getByRole('checkbox', { name: /furgón congelado/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /sider/i })).toBeChecked()
  })

  it('un refetch que devuelve lo mismo tampoco desmarca "a todos"', () => {
    const { redibujar } = montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    fireEvent.click(screen.getByRole('radio', { name: /a todos los vehículos/i }))
    redibujar(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    expect(screen.getByRole('radio', { name: /a todos los vehículos/i })).toBeChecked()
  })

  // Guardar CIERRA la vista previa era una capacidad menos: el número recién
  // pasa a ser interesante después de guardar, y había que volver a pedirlo.
  it('guardar no cierra la vista previa, la deja recalcular', async () => {
    const { redibujar } = montarPanel(requisito({ applies_to_fleet_service_type_ids: ['t2'] }))
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se agregan 4/i)

    // Lo que hace react-query después de guardar: el catálogo se refetchea y
    // el panel se vuelve a dibujar con la fila nueva.
    redibujar(requisito({ applies_to_fleet_service_type_ids: ['t2'], is_active: false }))

    expect(screen.getByText(/se agregan 4/i)).toBeInTheDocument()
  })

  // Con la vista previa en 0 y 0 no hay nada que aplicar: el botón habilitado
  // invitaba a una escritura que no cambia nada.
  it('sin cambios que aplicar, el botón no se puede apretar', async () => {
    vi.mocked(requirementsApi.recalcPreview).mockResolvedValue({ crear: 0, quitar: 0, bloqueados: 0 })
    montarPanel()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled())
    expect(screen.getByText(/ya está aplicada/i)).toBeInTheDocument()
  })

  // El aviso nombraba mal justo la cosa que nadie puede ver: en una regla de
  // empresa lo oculto es un tipo de gestión, no un subtipo de vehículo.
  it('lo oculto se nombra según la entidad de la regla', () => {
    montarPanel(requisito({
      target_entity: 'CARRIER',
      applies_to_management_types: ['TRACTOREO', 'YA_NO_EXISTE'] as never,
    }))
    expect(screen.getByText(/tipo de gestión que ya no existe/i)).toBeInTheDocument()
    expect(screen.queryByText(/subtipo dado de baja/i)).not.toBeInTheDocument()
  })

  // Un requisito de empresa guarda la condición en OTRO campo: el arreglo que
  // hay que comparar por contenido no es el mismo.
  it('un refetch que devuelve lo mismo no borra el tipo de gestión elegido', () => {
    const { redibujar } = montarPanel(
      requisito({ target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO'] }))
    fireEvent.click(screen.getByRole('checkbox', { name: /equipo completo/i }))
    redibujar(requisito({ target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO'] }))
    expect(screen.getByRole('checkbox', { name: /equipo completo/i })).toBeChecked()
  })
})
