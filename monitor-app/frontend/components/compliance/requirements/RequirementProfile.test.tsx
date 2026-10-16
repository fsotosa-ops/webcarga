import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: vi.fn(),
  usePathname: () => '/dashboard/compliance/requirements/r2',
}))
const permisos = vi.hoisted(() => ({ editar: true }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => permisos.editar }))
vi.mock('@/app/dashboard/admin/settings/secciones', () => ({ usePuedeEditarSeccion: () => permisos.editar }))
vi.mock('@/lib/api/requirements', () => ({ requirementsApi: { get: vi.fn(), aliases: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/api/config', () => ({
  GLOBAL_ALERT_THRESHOLD: 'documento_por_vencer',
  configApi: { getAlertThresholds: vi.fn().mockResolvedValue([{ doc_type: 'documento_por_vencer', label: 'Documentos', warning_days: 30, error_days: 0 }]) },
  taxonomiesApi: { list: vi.fn().mockResolvedValue([]) },
  revisionesApi: { list: vi.fn().mockResolvedValue([]), confirm: vi.fn() },
}))
// El panel tiene sus propios tests (CondicionPanel.test.tsx): aquí importa que se abra en su pregunta.
vi.mock('./CondicionPanel', () => ({
  CondicionPanel: ({ section }: { section?: string }) => <div role="dialog" aria-label="panel">{section ?? 'todas'}</div>,
}))

import { RequirementProfile } from './RequirementProfile'
import { requirementsApi } from '@/lib/api/requirements'
import { ApiError } from '@/lib/api/client'
import type { RequirementDetail } from '@/lib/types'

const FRIO: RequirementDetail = {
  id: 'r2', target_entity: 'ASSET', requirement_code: 'MANTENCION_FRIO', name: 'Mantención Cámara de Frío',
  requirement_level: 'CONDITIONAL_OPTIONAL', expiration_policy: 'ISSUE_PLUS_MONTHS',
  vigencia: { validity_months: 12, frequency_months: null, cutoff_day: null, period_offset_months: null, warning_days: null, grace_days: 0 },
  tiene_versiones: true, exigible_on: 'ON_ENTITY_START', is_active: true,
  applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
  alcance: { alcanzadas: 37, universo: 122 }, aliases: ['MANT CAMARA'], cumplen: 31, exigidos: 37,
  estados: { vencidos: 4, por_vencer: 1, al_dia: 31, falta: 2 },
  reglas: [
    { vigente_desde: '2026-09-01', validity_months: 12, frequency_months: null, cutoff_day: null, period_offset_months: null, warning_days: null, grace_days: 0 },
    { vigente_desde: null, validity_months: 24, frequency_months: null, cutoff_day: null, period_offset_months: null, warning_days: null, grace_days: 0 },
  ],
}

function renderProfile(query = '') {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><RequirementProfile id="r2" /></QueryClientProvider>)
}

const pregunta = (nombre: RegExp) => screen.getByRole('region', { name: nombre })

beforeEach(() => {
  permisos.editar = true
  vi.mocked(requirementsApi.get).mockReset().mockResolvedValue(FRIO)
})

describe('La ficha de un documento exigido (P2.3)', () => {
  it('responde las cinco preguntas en una frase', async () => {
    renderProfile()
    await screen.findByRole('heading', { name: 'Mantención Cámara de Frío' })
    expect(within(pregunta(/¿A quién se le exige\?/)).getByText('Todos los equipos')).toBeInTheDocument()
    expect(within(pregunta(/¿A quién se le exige\?/)).getByText('37 de 122 activos')).toBeInTheDocument()
    expect(within(pregunta(/¿Cuándo vence\?/)).getByText('Anual')).toBeInTheDocument()
    expect(within(pregunta(/¿Cuándo se exige\?/)).getByText('Al ingresar')).toBeInTheDocument()
    expect(await within(pregunta(/anticipación/)).findByText('La alerta general: 30 días')).toBeInTheDocument()
    expect(within(pregunta(/¿Qué cambia si edito la regla\?/)).getByText(/antes de guardar/i)).toBeInTheDocument()
  })

  it('el historial de la regla se despliega, de la más nueva a la original', async () => {
    renderProfile()
    const vence = await screen.findByRole('region', { name: /¿Cuándo vence\?/ })
    fireEvent.click(within(vence).getByRole('button', { name: /1 cambio de regla/ }))
    expect(within(vence).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Desde el 01-09-2026: Anual', 'Desde siempre: Bienal',
    ])
  })

  it('"Editar" abre el panel en su pregunta', async () => {
    renderProfile()
    const vence = await screen.findByRole('region', { name: /¿Cuándo vence\?/ })
    fireEvent.click(within(vence).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'panel' })).toHaveTextContent('vence')
    fireEvent.click(within(pregunta(/¿Cuándo se exige\?/)).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'panel' })).toHaveTextContent('cuando')
  })

  it('el aviso se edita con la vigencia', async () => {
    renderProfile()
    const aviso = await screen.findByRole('region', { name: /anticipación/ })
    fireEvent.click(within(aviso).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('dialog', { name: 'panel' })).toHaveTextContent('vence')
  })

  it('sin certification.configure se lee todo y no hay "Editar" ni "Más acciones"', async () => {
    permisos.editar = false
    renderProfile()
    await screen.findByRole('heading', { name: 'Mantención Cámara de Frío' })
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Más acciones' })).toBeNull()
    expect(within(pregunta(/¿Cuándo vence\?/)).getByText('Anual')).toBeInTheDocument()
  })

  it('"Más acciones" quita la vigencia en su panel', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quitar vigencia' }))
    expect(screen.getByRole('dialog', { name: 'panel' })).toHaveTextContent('vigencia')
  })

  it('al costado: quiénes no cumplen, con enlace a Pendientes de ese documento', async () => {
    renderProfile()
    const enlace = await screen.findByRole('link', { name: /6 no cumplen/ })
    expect(enlace.getAttribute('href')).toBe('/dashboard/compliance/pending?doc=MANTENCION_FRIO')
  })

  it('si nadie debe el documento lo dice, sin enlace a una cola vacía', async () => {
    vi.mocked(requirementsApi.get).mockResolvedValue({ ...FRIO, cumplen: 37, exigidos: 37 })
    renderProfile()
    expect(await screen.findByText('Todos cumplen.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /no cumplen/ })).toBeNull()
  })

  it('si la regla no alcanza a nadie no dice que todos cumplen', async () => {
    vi.mocked(requirementsApi.get).mockResolvedValue({ ...FRIO, cumplen: 0, exigidos: 0 })
    renderProfile()
    expect(await screen.findByText('Hoy no se le exige a nadie.')).toBeInTheDocument()
    expect(screen.queryByText('Todos cumplen.')).toBeNull()
  })

  it('un documento sin vigencia lo dice en el encabezado y ofrece ponerla', async () => {
    vi.mocked(requirementsApi.get).mockResolvedValue({ ...FRIO, is_active: false })
    renderProfile()
    expect(await screen.findByText('Sin vigencia')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    expect(screen.getByRole('menuitem', { name: 'Poner en vigencia' })).toBeInTheDocument()
  })

  it('volver lleva a la lista con sus filtros', async () => {
    renderProfile('next=%2Fdashboard%2Fcompliance%2Frequirements%3Fstate%3Dsin-vigencia')
    const volver = await screen.findByRole('link', { name: 'Volver a Documentos exigidos' })
    expect(volver.getAttribute('href')).toBe('/dashboard/compliance/requirements?state=sin-vigencia')
  })

  it('un documento que no existe lo dice y ofrece volver', async () => {
    vi.mocked(requirementsApi.get).mockRejectedValue(new ApiError('no existe', 404, null))
    renderProfile()
    expect(await screen.findByText('Este documento no existe')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a Documentos exigidos' }).getAttribute('href'))
      .toBe('/dashboard/compliance/requirements')
  })
})
