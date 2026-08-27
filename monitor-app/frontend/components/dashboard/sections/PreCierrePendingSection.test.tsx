import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PreCierrePendingSection } from './PreCierrePendingSection'
import type { DailyClosureStatus } from '@/lib/types'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { create: vi.fn(), patch: vi.fn(), assignDriver: vi.fn(), fleetDriverGap: vi.fn().mockResolvedValue({ rows: [] }) },
}))

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

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PreCierrePendingSection fecha="2026-08-04" />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  const { carriersApi } = await import('@/lib/api/carriers')
  vi.mocked(dailyClosuresApi.get).mockReset()
  vi.mocked(carriersApi.create).mockReset()
  vi.mocked(carriersApi.patch).mockReset()
  vi.mocked(carriersApi.assignDriver).mockReset().mockResolvedValue({ ok: true } as never)
})

describe('PreCierrePendingSection', () => {
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

  it('EMPRESA_ONBOARDING: "Activar empresa" llama a carriersApi.patch con operational_status ACTIVE', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { carriersApi } = await import('@/lib/api/carriers')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [{ carrier_id: 'c9', carrier_name: 'Transportes Nueva' }],
        SIN_TIPO_OPERACION: [],
      },
    }))
    vi.mocked(carriersApi.patch).mockResolvedValue({} as never)
    renderSection()
    await screen.findByText(/Transportes Nueva/)

    fireEvent.click(screen.getByRole('button', { name: 'Activar empresa' }))

    await waitFor(() => expect(carriersApi.patch).toHaveBeenCalledWith('c9', { operational_status: 'ACTIVE' }))
  })

  it('EMPRESA_ONBOARDING: si falla (sin RUT), ofrece completar el RUT inline', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { carriersApi } = await import('@/lib/api/carriers')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [{ carrier_id: 'c9', carrier_name: 'Transportes Nueva' }],
        SIN_TIPO_OPERACION: [],
      },
    }))
    vi.mocked(carriersApi.patch).mockRejectedValueOnce(new Error('No se puede activar una empresa sin RUT/tax_id'))
    renderSection()
    await screen.findByText(/Transportes Nueva/)
    fireEvent.click(screen.getByRole('button', { name: 'Activar empresa' }))
    await screen.findByText('No se puede activar una empresa sin RUT/tax_id')

    fireEvent.change(screen.getByLabelText('RUT de Transportes Nueva'), { target: { value: '11.111.111-1' } })
    vi.mocked(carriersApi.patch).mockResolvedValueOnce({} as never)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar RUT y activar' }))

    await waitFor(() => expect(carriersApi.patch).toHaveBeenLastCalledWith(
      'c9', { tax_id: '11.111.111-1', operational_status: 'ACTIVE' },
    ))
  })

  it('SIN_TIPO_OPERACION: link directo a la ficha de la empresa', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status({
      escalations: {
        PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
        EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [{ carrier_id: 'c5', carrier_name: 'Rios Ltda' }],
      },
    }))
    renderSection()
    await screen.findByText(/Rios Ltda/)
    const link = screen.getByRole('link', { name: 'Ir a la ficha de la empresa' })
    expect(link).toHaveAttribute('href', '/dashboard/carriers/c5?tab=equipos')
  })

  it('sin pendientes: no muestra el banner, igual monta FleetDriverGapCard', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(status())
    renderSection()
    await waitFor(() => expect(dailyClosuresApi.get).toHaveBeenCalled())
    expect(screen.queryByText('Requieren tu atención')).not.toBeInTheDocument()
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

    expect(await screen.findByText(/Gerson Ferrada Zapata/)).toBeInTheDocument()
    expect(screen.getByText(/25 viajes/)).toBeInTheDocument()
    expect(screen.getByText(/no aparece en el cierre del día/i)).toBeInTheDocument()
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
})
