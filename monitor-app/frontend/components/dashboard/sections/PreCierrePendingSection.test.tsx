import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PreCierrePendingSection } from './PreCierrePendingSection'
import type { DailyClosureStatus } from '@/lib/types'
import { ApiError } from '@/lib/api/client'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: {
    create: vi.fn(), patch: vi.fn(), assignDriver: vi.fn(), fleetDriverGap: vi.fn().mockResolvedValue({ rows: [] }),
    listDrivers: vi.fn().mockResolvedValue([{ id: 'd1', full_name: 'Juan Pérez' }]), listAssets: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/api/lifecycle', () => ({ lifecycleApi: { activateCarrier: vi.fn(), reactivate: vi.fn() } }))
vi.mock('@/lib/api/config', async orig => {
  const real = await orig<typeof import('@/lib/api/config')>()
  return { ...real, taxonomiesApi: { ...real.taxonomiesApi, list: vi.fn().mockResolvedValue([
    { id: 'r-vuelve', label: 'Retoma la relación comercial', group: 'all', code: 'RELATIONSHIP_RESUMED' }]) } }
})

vi.mock('@/lib/api/drivers', () => ({ driversApi: { create: vi.fn() } }))
vi.mock('@/lib/api/locations', () => ({ locationsApi: { list: vi.fn().mockResolvedValue({ data: [] }) } }))

// La vista vive en la URL (spec §4.2): una URL en memoria que se vuelve a dibujar.
vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
vi.mock('@/lib/api/tablePreferences', () => ({
  tablePreferencesApi: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), reset: vi.fn() },
}))
import { memoryUrl } from '@/lib/testing/inMemoryNavigation'

const permisos = vi.hoisted(() => ({ negados: new Set<string>() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: (p: string) => !permisos.negados.has(p) }))

function status(overrides: Partial<DailyClosureStatus['pre_cierre']> = {}): DailyClosureStatus {
  return {
    business_date: '2026-08-04', closed: false, closure: null,
    total_drivers: 0, assigned_count: 0, unassigned_count: 0, mismatch_count: 0, pending_count: 0,
    drivers: [],
    pre_cierre: {
      auto_resolved: [],
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
      },
      ...overrides,
    },
  }
}

type Props = Parameters<typeof PreCierrePendingSection>[0]
function renderSection(props: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PreCierrePendingSection fecha="2026-08-04" alcance="tractoreo" tripHref={id => `/viaje/${id}`} {...props} />
    </QueryClientProvider>,
  )
}

const fila = (texto: string | RegExp) => screen.getByText(texto).closest('tr')!

beforeEach(async () => {
  memoryUrl.reset('/dashboard/operations/closures?tab=pending')
  permisos.negados = new Set()
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  const { carriersApi } = await import('@/lib/api/carriers')
  vi.mocked(dailyClosuresApi.get).mockReset()
  vi.mocked(carriersApi.create).mockReset()
  vi.mocked(carriersApi.patch).mockReset()
  vi.mocked(carriersApi.assignDriver).mockReset().mockResolvedValue({ ok: true } as never)
  vi.mocked(carriersApi.fleetDriverGap).mockReset().mockResolvedValue({ rows: [] } as never)
})

describe('PreCierrePendingSection', () => {
  it('sin directory.edit el pre-cierre no ofrece lo que la API rechazaría (Review Focus 5)', async () => {
    permisos.negados = new Set(['directory.edit', 'directory.delete'])
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [{ tractor_plate: 'ZZZZ11', reason: 'La patente no existe en public.assets' }],
        EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [{ driver_rut: '8245112-9', driver_name_tms: 'JAIME VIDAL' }],
        EMPRESA_ONBOARDING: [{ carrier_id: 'c9', carrier_name: 'Transportes Nueva', operational_status: 'ONBOARDING' }],
        SIN_TIPO_OPERACION: [],
        CONDUCTOR_SIN_EMPRESA: [{
          driver_id: 'd1', driver_name: 'Gerson Ferrada Zapata',
          carrier_id: 'c1', carrier_name: 'Transportes Juan Ramirez Spa', viajes: 25,
        }],
      },
    }))
    renderSection()
    expect((await screen.findAllByText(/Transportes Nueva/)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Activar empresa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear empresa nueva' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dar de alta a este conductor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Asignar a Transportes Juan Ramirez Spa/i })).not.toBeInTheDocument()
    // Una por fila: patente, conductor no registrado, empresa en alta y conductor sin empresa.
    expect(screen.getAllByText('Lo resuelve un supervisor desde el Directorio.')).toHaveLength(4)
  })

  it('una empresa en ONBOARDING se activa con directory.edit; una dada de baja pide directory.delete', async () => {
    permisos.negados = new Set(['directory.delete'])
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [
          { carrier_id: 'c9', carrier_name: 'Transportes Nueva', operational_status: 'ONBOARDING' },
          { carrier_id: 'c8', carrier_name: 'Transportes Baja', operational_status: 'INACTIVE' },
        ],
        SIN_TIPO_OPERACION: [],
      },
    }))
    renderSection()
    await screen.findAllByText(/Transportes Baja/)
    expect(screen.getAllByRole('button', { name: 'Activar empresa' })).toHaveLength(1)
    expect(screen.getAllByText('Lo resuelve un supervisor desde el Directorio.')).toHaveLength(1)
  })

  it('muestra las resoluciones automáticas (Tipo A)', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      auto_resolved: [{ type: 'PATENTE_EMPRESA', message: "Se actualizó la empresa de la patente ABCD12." }],
    }))
    renderSection()
    expect(await screen.findByText('1 resuelta automáticamente')).toBeInTheDocument()
    expect(screen.getByText('Se actualizó la empresa de la patente ABCD12.')).toBeInTheDocument()
  })

  it('PATENTE_NO_REGISTRADA: "Crear empresa nueva" monta NewCarrierPanel inline', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [{ tractor_plate: 'ZZZZ11', reason: 'La patente no existe en public.assets' }],
        EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [], EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
      },
    }))
    renderSection()
    expect(await screen.findByText(/ZZZZ11/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa nueva' }))

    expect(screen.getByText('Nueva empresa')).toBeInTheDocument()
  })

  it('una patente sin empresa dice que no bloquea y en qué empresa la informa el TMS (GPRZ30, 01/10)', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [{
          tractor_plate: 'GPRZ30', reason: 'La patente existe pero no tiene empresa asignada',
          tms_carrier_name: 'TRANSPORTE VICENTE BUGARIN SPA',
        }],
        EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [], EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
      },
    }))
    renderSection()

    expect(await screen.findByText(/El TMS la informa en "TRANSPORTE VICENTE BUGARIN SPA"/)).toBeInTheDocument()
    expect(screen.getByText(/No bloquea el cierre/)).toBeInTheDocument()

    // Crear la empresa parte con el nombre que informa el TMS.
    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa nueva' }))
    expect(screen.getByDisplayValue('TRANSPORTE VICENTE BUGARIN SPA')).toBeInTheDocument()
  })

  it('EMPRESA_ONBOARDING: "Activar empresa" usa la acción de activar', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { lifecycleApi } = await import('@/lib/api/lifecycle')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [{ carrier_id: 'c9', carrier_name: 'Transportes Nueva' }],
        SIN_TIPO_OPERACION: [],
      },
    }))
    vi.mocked(lifecycleApi.activateCarrier).mockResolvedValue({ operational_status: 'ACTIVE' })
    renderSection()
    await screen.findAllByText(/Transportes Nueva/)

    fireEvent.click(screen.getByRole('button', { name: 'Activar empresa' }))

    await waitFor(() => expect(lifecycleApi.activateCarrier).toHaveBeenCalledWith('c9', {}))
  })

  it('EMPRESA_ONBOARDING de una dada de baja: reactiva con motivo y su flota, no con un atajo', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { lifecycleApi } = await import('@/lib/api/lifecycle')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [{ carrier_id: 'c8', carrier_name: 'Transportes Baja', operational_status: 'INACTIVE' }],
        SIN_TIPO_OPERACION: [],
      },
    }))
    vi.mocked(lifecycleApi.reactivate).mockResolvedValue({})
    renderSection()
    await screen.findAllByText(/Transportes Baja/)
    expect(screen.queryByRole('button', { name: 'Activar empresa' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reactivar empresa' }))
    await screen.findByRole('option', { name: 'Retoma la relación comercial' })
    expect(screen.getByRole('checkbox', { name: 'Juan Pérez' })).toBeChecked()
    fireEvent.change(screen.getByRole('combobox', { name: 'Motivo' }), { target: { value: 'r-vuelve' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))

    await waitFor(() => expect(lifecycleApi.reactivate).toHaveBeenCalledWith(
      'carrier', 'c8', { reason_id: 'r-vuelve', note: undefined, driver_ids: ['d1'], asset_ids: [] }))
  })

  it('EMPRESA_ONBOARDING: si falla (sin RUT), ofrece completar el RUT inline', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { lifecycleApi } = await import('@/lib/api/lifecycle')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [{ carrier_id: 'c9', carrier_name: 'Transportes Nueva' }],
        SIN_TIPO_OPERACION: [],
      },
    }))
    vi.mocked(lifecycleApi.activateCarrier).mockRejectedValueOnce(new Error('No se puede activar una empresa sin RUT/tax_id'))
    renderSection()
    await screen.findAllByText(/Transportes Nueva/)
    fireEvent.click(screen.getByRole('button', { name: 'Activar empresa' }))
    await screen.findByText('No se puede activar una empresa sin RUT/tax_id')

    fireEvent.change(screen.getByLabelText('RUT de Transportes Nueva'), { target: { value: '11.111.111-1' } })
    vi.mocked(lifecycleApi.activateCarrier).mockResolvedValueOnce({ operational_status: 'ACTIVE' })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar RUT y activar' }))

    await waitFor(() => expect(lifecycleApi.activateCarrier).toHaveBeenLastCalledWith(
      'c9', { tax_id: '11.111.111-1' },
    ))
  })

  it('SIN_TIPO_OPERACION: link directo a la ficha de la empresa', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [{ carrier_id: 'c5', carrier_name: 'Rios Ltda', tractor_plate: 'HKXW55' }],
      },
    }))
    renderSection()
    await screen.findByText(/Rios Ltda/)
    const link = screen.getByRole('link', { name: 'Ir a la ficha de la empresa' })
    expect(link).toHaveAttribute('href', '/dashboard/carriers/c5?tab=equipos')
  })

  it('sin pendientes lo dice en una línea', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status())
    renderSection()
    expect(await screen.findByText('Nada pendiente para el cierre')).toBeInTheDocument()
  })

  // ── El patrón del Cierre (C9, C14, D6) ───────────────────────────────────

  it('una tabla con la barra del kit y "Tipo de aviso" filtrable, y la dotación es un tipo más (C9)', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { carriersApi } = await import('@/lib/api/carriers')
    vi.mocked(carriersApi.fleetDriverGap).mockResolvedValue({ rows: [
      { carrier_id: 'c7', business_name: 'Hasa Spa', n_tractos: 4, n_conductores: 2, gap: 2 },
    ] } as never)
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [{ tractor_plate: 'ZZZZ11', reason: 'La patente no existe en public.assets' }],
        EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [], EMPRESA_ONBOARDING: [],
        SIN_TIPO_OPERACION: [{ carrier_id: 'c5', carrier_name: 'Rios Ltda', tractor_plate: 'HKXW55' }],
      },
    }))
    renderSection()
    expect(await screen.findByRole('table', { name: 'Avisos del cierre' })).toBeInTheDocument()
    expect(await screen.findByText('Faltan 2 conductores · 4 tractos / 2 conductores')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /buscar/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Tipo de aviso' }))
    expect(screen.getByRole('checkbox', { name: 'Desbalance de dotación, 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sin tipo de operación, 1' }))
    expect(screen.getByText('HKXW55')).toBeInTheDocument()
    expect(screen.queryByText('ZZZZ11')).toBeNull()
    expect(screen.queryByText('Hasa Spa')).toBeNull()
  })

  it('no dibuja avisos mientras falta el desbalance de dotación, y si falla lo dice (revisión final)', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { carriersApi } = await import('@/lib/api/carriers')
    let fallar: (e: Error) => void = () => {}
    vi.mocked(carriersApi.fleetDriverGap).mockReturnValue(new Promise((_, rechazar) => { fallar = rechazar }) as never)
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [{ tractor_plate: 'ZZZZ11', reason: 'La patente no existe en public.assets' }],
        EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [], EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
      },
    }))
    renderSection()
    await waitFor(() => expect(dailyClosuresApi.get).toHaveBeenCalled())
    // Una lista a medias cambiaría de número al llegar la dotación.
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByText('ZZZZ11')).toBeNull()
    fallar(new Error('500'))
    expect(await screen.findByText('ZZZZ11')).toBeInTheDocument()
    expect(screen.getByText(/No se pudo cargar el desbalance de dotación/)).toBeInTheDocument()
  })

  it('Conductor sin empresa muestra sus Nº de viaje, cada uno con su enlace (C14)', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
        CONDUCTOR_SIN_EMPRESA: [{ ...PROPUESTA, viajes: 2, trips: [{ id: 't1', code: '2033000' }, { id: 't2', code: '2033001' }] }],
      },
    }))
    renderSection()
    const propia = await screen.findByText('Gerson Ferrada Zapata')
    expect(within(propia.closest('tr')!).getByRole('link', { name: 'Ver viaje 2033000' })).toHaveAttribute('href', '/viaje/t1')
    expect(within(propia.closest('tr')!).getByRole('link', { name: 'Ver viaje 2033001' })).toHaveAttribute('href', '/viaje/t2')
    expect(screen.getByRole('button', { name: 'Filtrar por Nº viaje' })).toBeInTheDocument()
  })

  it('un aviso con viajes dice la zona de sus destinos, y la zona filtra', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [{ tractor_plate: 'ZZZZ11', reason: 'Sin empresa' }],
        EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [], EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
        CONDUCTOR_SIN_EMPRESA: [{ ...PROPUESTA, viajes: 2,
          trips: [{ id: 't1', code: '2033000', zone: 'RM' }, { id: 't2', code: '2033001', zone: 'Z0' }] }],
      },
    }))
    renderSection()
    const fila = (await screen.findByText('Gerson Ferrada Zapata')).closest('tr')!
    expect(within(fila).getByText('RM, Z0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Zona' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Z0, 1' }))
    expect(screen.queryByText('ZZZZ11')).toBeNull()
    expect(screen.getByText('Gerson Ferrada Zapata')).toBeInTheDocument()
  })

  it('el alcance filtra los avisos; los de empresa se ven en los dos (D6)', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [
          { tractor_plate: 'TRAC11', reason: 'Sin empresa', scope: 'tractoreo' },
          { tractor_plate: 'EQCO11', reason: 'Sin empresa', scope: 'equipo_completo' },
        ],
        EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [], SIN_TIPO_OPERACION: [],
        EMPRESA_ONBOARDING: [{ carrier_id: 'c9', carrier_name: 'Transportes Nueva', scope: null }],
      },
    }))
    renderSection({ alcance: 'equipo_completo' })
    expect(await screen.findByText('EQCO11')).toBeInTheDocument()
    expect(screen.queryByText('TRAC11')).toBeNull()
    expect(screen.getAllByText('Transportes Nueva').length).toBeGreaterThan(0)
  })

  // ── La propuesta de empresa (caso Gerson Ferrada, minuta del 25/08) ───────
  // El cierre recorre el padron y el viaje resuelve por lo que reporta el TMS.
  // Cuando el padron esta en silencio y todos sus viajes apuntan a la misma
  // empresa, la app PROPONE y una persona confirma.
  const PROPUESTA = {
    driver_id: 'd1', driver_name: 'Gerson Ferrada Zapata',
    carrier_id: 'c1', carrier_name: 'Transportes Juan Ramirez Spa', viajes: 25,
  }

  it('propone la empresa del tracto, y dice lo que cuesta no tenerla', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [], CONDUCTOR_SIN_EMPRESA: [PROPUESTA],
      },
    }))
    renderSection()

    expect(await screen.findByText('Gerson Ferrada Zapata')).toBeInTheDocument()
    expect(within(fila('Gerson Ferrada Zapata')).getByText(/25 viajes con un tracto de Transportes Juan Ramirez Spa/)).toBeInTheDocument()
    expect(within(fila('Gerson Ferrada Zapata')).getByText(/no aparece en el cierre del día/i)).toBeInTheDocument()
  })

  it('confirmar la propuesta escribe la asignacion, que es lo que lee Certificacion', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { carriersApi } = await import('@/lib/api/carriers')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [], CONDUCTOR_SIN_EMPRESA: [PROPUESTA],
      },
    }))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Asignar a Transportes Juan Ramirez Spa/i }))

    await waitFor(() => expect(carriersApi.assignDriver).toHaveBeenCalledWith('c1', 'd1'))
  })

  it('ofrece una salida cuando la propuesta esta equivocada', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [], CONDUCTOR_SIN_EMPRESA: [PROPUESTA],
      },
    }))
    renderSection()

    expect(await screen.findByRole('link', { name: /Es otra empresa/i }))
      .toHaveAttribute('href', '/dashboard/compliance?vista=conductores')
  })

  // Backend y frontend se despliegan por separado. Antes del guarda, una clave
  // que el backend todavia no manda rompia la seccion ENTERA, incluidas las
  // escalaciones que si llegaron.
  it('si el backend todavia no manda la clave, la seccion sigue funcionando', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [],
        CONDUCTOR_NO_REGISTRADO: [{ driver_rut: '8245112-9', driver_name_tms: 'JAIME VIDAL' }],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
      },
    }))
    renderSection()

    expect(await screen.findByText(/8245112-9/)).toBeInTheDocument()
  })
  it('SIN_TIPO_OPERACION nombra la patente y dice que bloquea el cierre, no que "no puede clasificarse"', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [],
        SIN_TIPO_OPERACION: [{ carrier_id: 'c5', carrier_name: 'Rios Ltda', tractor_plate: 'HKXW55' }],
      },
    }))
    renderSection()

    // La patente, porque la acción es sobre un vehículo y no sobre la empresa.
    expect(await screen.findByText('HKXW55')).toBeInTheDocument()
    // Y la consecuencia real, que es que el día no se cierra.
    expect(screen.getByText(/bloquea el cierre del día/)).toBeInTheDocument()
  })

  // El pendiente busca el RUT igual que el alta: un 409 solo ocurre si alguien
  // registró a esa persona con la pantalla abierta. La salida relee el cierre
  // (y el pendiente desaparece); "asignar" no tendría sentido acá.
  it('CONDUCTOR_NO_REGISTRADO: si el RUT ya existe, ofrece actualizar el cierre y lo relee', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { driversApi } = await import('@/lib/api/drivers')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
        CONDUCTOR_NO_REGISTRADO: [{ driver_rut: '8245112-9', driver_name_tms: 'JAIME VIDAL' }],
      },
    }))
    vi.mocked(driversApi.create).mockRejectedValue(new ApiError('Jaime Vidal ya está registrado con el RUT 8245112-9.', 409, {
      code: 'CONDUCTOR_YA_EXISTE', driver_id: 'd-jv', full_name: 'Jaime Vidal',
      message: 'Jaime Vidal ya está registrado con el RUT 8245112-9.',
    }))
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Dar de alta a este conductor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const salida = await screen.findByRole('button', { name: 'Ya está registrado: actualizar el cierre' })
    expect(screen.queryByRole('button', { name: /^Asignar a/ })).not.toBeInTheDocument()
    const lecturas = vi.mocked(dailyClosuresApi.get).mock.calls.length
    fireEvent.click(salida)
    await waitFor(() => expect(vi.mocked(dailyClosuresApi.get).mock.calls.length).toBeGreaterThan(lecturas))
  })
})
