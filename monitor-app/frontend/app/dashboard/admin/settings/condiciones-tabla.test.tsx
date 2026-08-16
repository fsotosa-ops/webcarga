import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequirementOption } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listRequirements: vi.fn() },
}))
vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn() },
  revisionesApi: { list: vi.fn(), confirm: vi.fn() },
}))
vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: { patchConditions: vi.fn(), recalcPreview: vi.fn(), recalc: vi.fn() },
}))
vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => true }))

// El documento abierto VIAJA EN LA URL, como un viaje del Monitor: cada test
// elige qué trae.
let urlActual = ''
const reemplazar = vi.fn()
const empujar = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: empujar }),
  usePathname: () => '/dashboard/admin/settings/certification',
  useSearchParams: () => new URLSearchParams(urlActual),
}))

import { complianceApi } from '@/lib/api/compliance'
import { taxonomiesApi, revisionesApi } from '@/lib/api/config'
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
  { ...BASE, id: 'r4', requirement_code: 'PESAJE_EJES', name: 'Pesaje de Ejes',
    target_entity: 'ASSET', is_active: true,
    applies_to_fleet_service_type_ids: ['t1', 't2'], applies_to_management_types: null,
    alcance: { alcanzadas: 60, universo: 118 } },
  { ...BASE, id: 'r5', requirement_code: 'SEGURO_EETT_TRACTO', name: 'Seguro EETT Tracto',
    target_entity: 'CARRIER', is_active: true,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: ['TRACTOREO'],
    alcance: { alcanzadas: 24, universo: 248 } },
  // Apagado y sin condición: el backend informa 248 de 248 porque `alcanzadas`
  // cuenta la condición, no la vigencia.
  { ...BASE, id: 'r3', requirement_code: 'SEGURO_EETT', name: 'Seguro EETT',
    target_entity: 'CARRIER', is_active: false,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 248, universo: 248 } },
]

// Los tipos de gestión salen del MISMO catálogo, identificados por su CÓDIGO
// estable: la etiqueta es sólo el nombre visible, y renombrarla no puede
// cambiar a quién alcanza una regla.
const GESTIONES = [
  { id: 'g1', label: 'Tractoreo', bg_color: '#fff', text_color: '#000', sort_order: 1, active: true, code: 'TRACTOREO' },
  { id: 'g2', label: 'Equipo Completo', bg_color: '#fff', text_color: '#000', sort_order: 2, active: true, code: 'EQUIPO_COMPLETO' },
]

const SUBTIPOS = [
  { id: 't1', label: 'Furgón Congelado', bg_color: '#fff', text_color: '#000', sort_order: 1, active: true, code: null },
  { id: 't2', label: 'Sider', bg_color: '#fff', text_color: '#000', sort_order: 2, active: true, code: null },
  { id: 't3', label: 'Rampla Plana', bg_color: '#fff', text_color: '#000', sort_order: 3, active: true, code: null },
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
  empujar.mockClear()
  vi.mocked(complianceApi.listRequirements).mockReset()
  vi.mocked(complianceApi.listRequirements).mockResolvedValue(REQS)
  vi.mocked(revisionesApi.list).mockReset()
  vi.mocked(revisionesApi.list).mockResolvedValue([])
  vi.mocked(revisionesApi.confirm).mockReset()
  vi.mocked(revisionesApi.confirm).mockResolvedValue({ revisado: true })
  vi.mocked(taxonomiesApi.list).mockReset()
  // Por dominio, no una respuesta única: la pantalla pide dos vocabularios
  // distintos y devolverle el mismo a los dos esconde cuál está usando.
  vi.mocked(taxonomiesApi.list).mockImplementation(async d =>
    (d === 'WEBCARGA_OPERATION_TYPE' ? GESTIONES : SUBTIPOS))
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

  // "Sólo 2 subtipos" cuando el catálogo tiene 3 SUBESTIMA la regla: se lee
  // como una restricción fuerte y en realidad excluye uno. El total sale del
  // catálogo de subtipos, no de un número escrito a mano.
  it('una regla de varios subtipos dice cuántos de cuántos', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('2 de 3 subtipos')).toBeInTheDocument())
  })

  // La etiqueta del tipo de gestión sale del CATÁLOGO, no de un mapa escrito
  // en el frontend. Estaba copiada en tres lugares más la función de Postgres:
  // renombrarla en Configuración dejaba a las cuatro diciendo cosas distintas.
  it('la frase nombra el tipo de gestión con la etiqueta del catálogo', async () => {
    vi.mocked(taxonomiesApi.list).mockImplementation(async d => (
      d === 'WEBCARGA_OPERATION_TYPE'
        ? [{ ...GESTIONES[0], label: 'Tractoreo (renombrado)' }, GESTIONES[1]]
        : SUBTIPOS))
    montar()
    await waitFor(() =>
      expect(screen.getByText('Sólo Tractoreo (renombrado)')).toBeInTheDocument())
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
    expect(filas[1]).toHaveTextContent('Pesaje de Ejes')
    expect(filas[2]).toHaveTextContent('Revisión Técnica')
    expect(filas[3]).toHaveTextContent('Seguro EETT')
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

  // El número del chip prometía filas que la búsqueda ya había descartado: con
  // "FRIO" escrito, "Con condición 2" llevaba a "Ningún documento coincide".
  it('el contador del chip cuenta sobre lo buscado, no sobre el catálogo entero', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /con condición/i }).textContent).toBe('Con condición3')
    expect(screen.getByRole('button', { name: /sin vigencia/i }).textContent).toBe('Sin vigencia1')

    fireEvent.change(screen.getByLabelText(/buscar documento/i), { target: { value: 'FRIO' } })

    expect(screen.getByRole('button', { name: /con condición/i }).textContent).toBe('Con condición1')
    expect(screen.getByRole('button', { name: /sin vigencia/i }).textContent).toBe('Sin vigencia0')
  })

  // El chip en cero sigue apretable: si se desactivara, el que está encendido
  // cuando la búsqueda lo deja en cero quedaría atrapado, sin forma de apagarlo.
  it('el chip en cero no queda deshabilitado', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sin vigencia/i }))
    fireEvent.change(screen.getByLabelText(/buscar documento/i), { target: { value: 'FRIO' } })

    const chip = screen.getByRole('button', { name: /sin vigencia/i })
    expect(chip.textContent).toBe('Sin vigencia0')
    expect(chip).toBeEnabled()
    fireEvent.click(chip)
    expect(screen.getByText('Mantención Cámara de Frío')).toBeInTheDocument()
  })

  // Una condición vacía significaba DOS cosas: "lo revisamos y va para todos"
  // y "nadie lo miró". Es la misma clase de defecto que apareció cinco veces
  // en el Tramo 3, y costó 16 remolques con cámara de frío exigida sin poder
  // tenerla.
  it('la fila dice si nadie revisó la regla', async () => {
    montar()
    await waitFor(() => expect(screen.getAllByText('Sin revisar').length).toBeGreaterThan(0))
  })

  it('la fila revisada dice quién y cuándo, en vez de la insignia', async () => {
    vi.mocked(revisionesApi.list).mockResolvedValue([
      { element_id: 'r1', reviewed_at: '2026-08-17T12:00:00Z', reviewed_by: 'Felipe' },
    ])
    montar()
    await waitFor(() => expect(screen.getByText(/Felipe/)).toBeInTheDocument())
    expect(screen.getByText(/Felipe/).textContent).toContain('17-08-2026')
  })

  it('el chip de sin revisar filtra, y cuenta', async () => {
    vi.mocked(revisionesApi.list).mockResolvedValue([
      { element_id: 'r1', reviewed_at: '2026-08-17T12:00:00Z', reviewed_by: 'Felipe' },
    ])
    montar()
    await waitFor(() => expect(screen.getByText('Mantención Cámara de Frío')).toBeInTheDocument())

    const chip = screen.getByRole('button', { name: /sin revisar/i })
    expect(chip.textContent).toBe('Sin revisar4')
    fireEvent.click(chip)

    // r1 es MANTENCION_FRIO, la única revisada: sale de la lista.
    expect(screen.queryByText('Mantención Cámara de Frío')).not.toBeInTheDocument()
    expect(screen.getByText('Revisión Técnica')).toBeInTheDocument()
  })

  // "Sin revisar" es un FILTRO, no un adorno: el número de la portada entra al
  // dominio con el filtro ya puesto.
  it('entrando desde la portada, el filtro viene puesto', async () => {
    urlActual = 'revision=pendiente'
    vi.mocked(revisionesApi.list).mockResolvedValue([
      { element_id: 'r1', reviewed_at: '2026-08-17T12:00:00Z', reviewed_by: 'Felipe' },
    ])
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    expect(screen.queryByText('Mantención Cámara de Frío')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sin revisar/i })).toHaveAttribute('aria-pressed', 'true')
  })

  // Si el parámetro quedara, la URL diría "estoy viendo lo pendiente" mientras
  // la pantalla muestra otra cosa: el mismo desajuste de la sección inventada.
  it('quitar el filtro limpia la URL', async () => {
    urlActual = 'revision=pendiente'
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /sin revisar/i }))
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/certification')
  })

  // El gesto vive en el PANEL y no en la fila: devolverle un botón a cada una
  // de las 37 filas sería volver a los controles que este rediseño vino a
  // sacar. Y sólo aparece sin cambios sin guardar: guardar ya cuenta como
  // revisar, y confirmar antes diría que se revisó una regla que todavía no es
  // la que está.
  it('desde el panel se confirma que la regla está bien así', async () => {
    urlActual = 'doc=REVISION_TECNICA'
    montar()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /está bien así/i }))

    await waitFor(() => expect(revisionesApi.confirm)
      .toHaveBeenCalledWith('certification', 'conditions', 'r2'))
  })

  it('una regla ya revisada no ofrece volver a confirmarla', async () => {
    urlActual = 'doc=REVISION_TECNICA'
    vi.mocked(revisionesApi.list).mockResolvedValue([
      { element_id: 'r2', reviewed_at: '2026-08-17T12:00:00Z', reviewed_by: 'Felipe' },
    ])
    montar()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /está bien así/i })).not.toBeInTheDocument())
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
    // `push` y no `replace`: abrir el panel deja una entrada en el historial,
    // asi el boton de atras del navegador lo CIERRA en vez de sacar de la
    // pantalla entera.
    expect(empujar).toHaveBeenCalledWith(
      '/dashboard/admin/settings/certification?doc=REVISION_TECNICA')
  })

  it('abrir un documento no pierde el resto de la URL', async () => {
    urlActual = 'section=conditions'
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /editar revisión técnica/i }))
    expect(empujar).toHaveBeenCalledWith(
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

  // Una columna sin nombre accesible es una columna que un lector de pantalla
  // no puede anunciar: la de acciones no tiene texto visible, asi que el
  // nombre tiene que estar puesto a mano.
  it('la columna de acciones tiene nombre accesible', async () => {
    montar()
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /acciones/i })).toBeInTheDocument())
  })

  it('avisa cuando el catálogo no carga, y deja reintentar', async () => {
    vi.mocked(complianceApi.listRequirements).mockRejectedValue(new Error('sin red'))
    montar()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument())
  })

  // Los subtipos son la mitad de la frase: sin ellos, "Sólo Furgón Congelado"
  // se convierte en "Sólo un subtipo dado de baja" y la fila miente sin avisar
  // ni ofrecer reintentar. La pantalla vieja miraba los dos errores.
  it('avisa cuando fallan los subtipos, en vez de inventar la frase', async () => {
    vi.mocked(taxonomiesApi.list).mockRejectedValue(new Error('sin red'))
    montar()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument())
    expect(screen.getByText(/no se pudieron cargar los subtipos/i)).toBeInTheDocument()
    expect(screen.queryByText(/dado de baja/i)).not.toBeInTheDocument()
  })

  it('reintentar vuelve a pedir las dos consultas', async () => {
    vi.mocked(taxonomiesApi.list).mockRejectedValue(new Error('sin red'))
    montar()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument())
    const pedidosCatalogo = vi.mocked(complianceApi.listRequirements).mock.calls.length
    const pedidosSubtipos = vi.mocked(taxonomiesApi.list).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() => {
      expect(vi.mocked(complianceApi.listRequirements).mock.calls.length).toBeGreaterThan(pedidosCatalogo)
      expect(vi.mocked(taxonomiesApi.list).mock.calls.length).toBeGreaterThan(pedidosSubtipos)
    })
  })

  // Mientras los subtipos viajan, la frase todavía no se puede escribir: el
  // respaldo diría "dado de baja" de un subtipo que existe perfectamente.
  it('mientras los subtipos cargan no dibuja ninguna fila', async () => {
    vi.mocked(taxonomiesApi.list).mockReturnValue(new Promise(() => {}))
    montar()
    // El catálogo YA llegó —lo único pendiente son los subtipos—, así que sin
    // esperarlo el test pasaría sin probar nada.
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(screen.queryByText('Revisión Técnica')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cargando')).toBeInTheDocument()
  })

  // Cerrar es `replace` y no `push`: si cerrar tambien empujara, abrir y cerrar
  // dos veces dejaria cuatro entradas en el historial y el boton de atras
  // recorreria un ida y vuelta que el usuario nunca hizo.
  it('cerrar el panel no ensucia el historial', async () => {
    urlActual = 'section=conditions&doc=MANTENCION_FRIO'
    montar()
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /cámara de frío/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

    expect(reemplazar).toHaveBeenCalledWith(
      '/dashboard/admin/settings/certification?section=conditions')
    expect(empujar).not.toHaveBeenCalled()
  })
})
