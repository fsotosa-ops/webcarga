import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(), useSearchParams: vi.fn(), usePathname: () => '/dashboard/compliance/requirements',
}))
const permisos = vi.hoisted(() => ({ editar: true }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => permisos.editar }))
vi.mock('@/app/dashboard/admin/settings/secciones', () => ({ usePuedeEditarSeccion: () => permisos.editar }))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: { listRequirements: vi.fn() } }))
vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn().mockResolvedValue([]) },
  revisionesApi: { list: vi.fn(), confirm: vi.fn() },
}))

import RequirementsPage from './page'
import { complianceApi } from '@/lib/api/compliance'
import { revisionesApi, taxonomiesApi } from '@/lib/api/config'
import type { ReglaDeVigencia, RequirementOption } from '@/lib/types'

const REGLA: ReglaDeVigencia = {
  validity_months: null, frequency_months: null, cutoff_day: null, period_offset_months: null, warning_days: null, grace_days: 0,
}

function req(over: Partial<RequirementOption>): RequirementOption {
  return {
    id: 'r', target_entity: 'ASSET', requirement_code: 'DOC', name: 'Doc',
    requirement_level: 'LEGAL_MANDATORY', expiration_policy: 'REQUIRED', vigencia: null,
    exigible_on: 'ON_ENTITY_START', is_active: true,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 122, universo: 122 }, aliases: [], cumplen: 97, exigidos: 122,
    ...over,
  }
}
const REVISION_TECNICA = req({ id: 'r1', name: 'Revisión Técnica', requirement_code: 'REVISION_TECNICA' })
const FRIO = req({
  id: 'r2', name: 'Mantención Cámara de Frío', requirement_code: 'MANTENCION_FRIO',
  requirement_level: 'CONDITIONAL_OPTIONAL', applies_to_fleet_service_type_ids: ['t1', 't2'],
  vigencia: { ...REGLA, warning_days: 15 }, cumplen: 31, exigidos: 37,
})
const F30 = req({
  id: 'r3', name: 'Formulario 30', requirement_code: 'F30', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: { ...REGLA, frequency_months: 1, cutoff_day: 18 },
})
// Vigente y no vence: no es "Sin vigencia".
const GPS = req({ id: 'r5', name: 'Certificado GPS', requirement_code: 'CERTIFICADO_GPS', expiration_policy: 'NONE',
  cumplen: 118, exigidos: 122 })
const APAGADO = req({ id: 'r4', name: 'Curso OS10', requirement_code: 'OS10', target_entity: 'DRIVER',
  is_active: false, expiration_policy: 'NONE', cumplen: 0, exigidos: 87 })

const push = vi.fn()
const replace = vi.fn()
function renderPage(query = '') {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><RequirementsPage /></QueryClientProvider>)
}

beforeEach(() => {
  permisos.editar = true
  push.mockReset(); replace.mockReset()
  vi.mocked(useRouter).mockReturnValue({ push, replace } as never)
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([REVISION_TECNICA, FRIO, F30, APAGADO, GPS])
  // FRIO está revisado; los demás no.
  vi.mocked(revisionesApi.list).mockReset().mockResolvedValue([
    { element_id: 'r2', reviewed_at: '2026-08-16T12:00:00Z', reviewed_by: 'F. S.' },
  ] as never)
})

describe('Certificación › Documentos exigidos (P2.1)', () => {
  it('las columnas: documento y código, a quién, vence, aviso, cumplen y revisión', async () => {
    renderPage()
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getAllByRole('columnheader').map(h => h.textContent))
      .toEqual(['Documento', 'Se exige a', 'Vence', 'Aviso', 'Cumplen', 'Revisión'])
    const fila = within(tabla).getByRole('link', { name: /Mantención Cámara de Frío/ }).closest('tr')!
    for (const t of ['MANTENCION_FRIO', 'Opcional', 'Fecha del documento', '15 días', '31 de 37', 'F. S. · 16-08-2026'])
      expect(within(fila).getByText(t)).toBeInTheDocument()
    const apagado = within(tabla).getByRole('link', { name: /Curso OS10/ }).closest('tr')!
    expect(within(apagado).getByText('No se exige')).toBeInTheDocument()
    expect(within(apagado).getByText('No vence')).toBeInTheDocument()
  })

  it('filtra por entidad y por estado, y cada filtro dice cuántos hay', async () => {
    renderPage()
    const entidad = await screen.findByRole('group', { name: 'Entidad' })
    const estado = screen.getByRole('group', { name: 'Estado' })
    await waitFor(() => expect(within(estado).getByRole('button', { name: /Sin revisar/ })).toHaveTextContent('Sin revisar4'))
    expect(within(entidad).getByRole('button', { name: /Equipo/ })).toHaveTextContent('Equipo3')
    expect(within(entidad).getByRole('button', { name: /Empresa/ })).toHaveTextContent('Empresa1')
    expect(within(estado).getByRole('button', { name: /Con condición/ })).toHaveTextContent('Con condición1')
    expect(within(estado).getByRole('button', { name: /Mensuales/ })).toHaveTextContent('Mensuales1')
    // "Sin vigencia" son los que no se exigen, no los que no vencen.
    expect(within(estado).getByRole('button', { name: /Sin vigencia/ })).toHaveTextContent('Sin vigencia1')

    fireEvent.click(within(estado).getByRole('button', { name: /Sin vigencia/ }))
    expect(replace).toHaveBeenCalledWith('/dashboard/compliance/requirements?state=sin-vigencia', { scroll: false })
  })

  it('con filtros en la dirección muestra solo lo que pasa los dos y cuenta sobre lo buscado', async () => {
    renderPage('entity=ASSET&state=con-condicion')
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getAllByRole('link').map(a => a.textContent)).toEqual(['Mantención Cámara de Frío'])
  })

  it('busca por nombre o por código', async () => {
    renderPage('q=f30')
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getAllByRole('link').map(a => a.textContent)).toEqual(['Formulario 30'])
  })

  it('sin cifras mientras la lista no llega', async () => {
    vi.mocked(complianceApi.listRequirements).mockReturnValue(new Promise(() => {}))
    renderPage()
    const estado = await screen.findByRole('group', { name: 'Estado' })
    expect(within(estado).getByRole('button', { name: /Sin vigencia/ })).toHaveTextContent(/Sin vigencia$/)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('"Nuevo documento" solo con certification.configure', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /Nuevo documento/ })).toBeInTheDocument()
  })

  it('sin certification.configure se lee y no hay "Nuevo documento"', async () => {
    permisos.editar = false
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /Nuevo documento/ })).toBeNull()
  })

  // Portados de condiciones-tabla.test.tsx (Parte 2): sin el catálogo de
  // subtipos la frase "Se exige a" se inventaría.
  it('mientras los subtipos cargan no dibuja ninguna fila', async () => {
    vi.mocked(taxonomiesApi.list).mockReturnValueOnce(new Promise(() => {}))
    renderPage()
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('si fallan los subtipos lo dice, en vez de inventar la frase', async () => {
    vi.mocked(taxonomiesApi.list).mockRejectedValueOnce(new Error('500'))
    renderPage()
    expect(await screen.findByText('No se pudieron cargar los documentos')).toBeInTheDocument()
  })

  it('en el teléfono, una tarjeta por documento con a quién, cómo vence y cuántos cumplen', async () => {
    renderPage()
    const tarjetas = await screen.findByRole('list', { name: 'Documentos exigidos' })
    const frio = within(tarjetas).getByRole('link', { name: /Mantención Cámara de Frío/ })
    expect(frio).toHaveTextContent('Fecha del documento · cumplen 31 de 37')
    expect(frio.getAttribute('href')).toBe('/dashboard/compliance/requirements/r2?next=%2Fdashboard%2Fcompliance%2Frequirements')
  })

  it('si la lista falla lo dice', async () => {
    vi.mocked(complianceApi.listRequirements).mockRejectedValue(new Error('500'))
    renderPage()
    expect(await screen.findByText('No se pudieron cargar los documentos')).toBeInTheDocument()
  })
})

describe('P2.2: la fila abre la ficha con la lista para volver', () => {
  it('el enlace lleva los filtros en next', async () => {
    renderPage('entity=ASSET&q=frio')
    const enlace = within(await screen.findByRole('table')).getByRole('link', { name: /Mantención Cámara de Frío/ })
    expect(enlace.getAttribute('href')).toBe(
      '/dashboard/compliance/requirements/r2?next=%2Fdashboard%2Fcompliance%2Frequirements%3Fentity%3DASSET%26q%3Dfrio')
  })

  it('la fila entera abre la ficha', async () => {
    renderPage()
    const fila = within(await screen.findByRole('table')).getByRole('link', { name: /Revisión Técnica/ }).closest('tr')!
    fireEvent.click(fila)
    expect(push).toHaveBeenCalledWith('/dashboard/compliance/requirements/r1?next=%2Fdashboard%2Fcompliance%2Frequirements')
  })
})

describe('P2.5: un enlace viejo de Configuración (?doc=CODIGO) abre la ficha', () => {
  it('el código lleva a la ficha de ese documento', async () => {
    renderPage('doc=MANTENCION_FRIO')
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/compliance/requirements/r2'))
  })

  it('un código que no existe deja la lista, sin el parámetro', async () => {
    renderPage('doc=NO_EXISTE&state=mensuales')
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/compliance/requirements?state=mensuales', { scroll: false }))
  })
})
