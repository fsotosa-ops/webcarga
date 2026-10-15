import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CertificationFunnel } from './CertificationFunnel'
import type { CertificationStatusRow } from '@/lib/types'
import type { ComplianceSummary } from '@/lib/states'

const RESUMEN: ComplianceSummary = {
  worst_state: 'MISSING', can_operate: false,
  own: { overdue: 0, expiring: 0, missing: 2 }, fleet: { overdue: 1, expiring: 0, missing: 3 },
  blocking: { own: 2, fleet: 4 },
}

function fila(over: Partial<CertificationStatusRow> = {}): CertificationStatusRow {
  return {
    entity_id: 'c1', entity_name: 'Transportes Charlotte Spa',
    carrier_id: 'c1', carrier_name: 'Transportes Charlotte Spa',
    operational_status: 'ACTIVE',
    total_count: 93, satisfied_count: 3, pending_count: 90,
    pending_mandatory: 88, unclassified_count: 0,
    management_types: ['TRACTOREO'], trips_30d: 0,
    funnel_bucket: 'not_enabled', compliance_summary: RESUMEN,
    ...over,
  }
}

type Props = Parameters<typeof CertificationFunnel>[0]

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    rows: [fila()],
    catalogRows: [],
    catalogEstado: 'sin-pedir' as const,
    onExpandCatalog: vi.fn(),
    ...over,
  }
  render(<CertificationFunnel {...props} />)
  return props
}

describe('CertificationFunnel', () => {
  // E2-3 (Entrega 2 de fichas): la lista se lee como tabla, con el encabezado del kit.
  it('E2-3: la lista tiene encabezados de columna, en texto normal', () => {
    setup()
    const empresa = screen.getByText('Empresa', { selector: 'span' })
    const encabezado = empresa.parentElement!
    expect(Array.from(encabezado.children).map(c => c.textContent).filter(Boolean))
      .toEqual(['Empresa', 'Tipo', 'Viajes 30 días', 'Avance', 'Pendientes'])
    expect(encabezado.className).not.toMatch(/uppercase/)
  })

  it('agrupa las empresas activas por su balde y nombra la cantidad', () => {
    setup({ rows: [
      fila({ entity_id: 'a', entity_name: 'Nogales', funnel_bucket: 'not_enabled' }),
      fila({ entity_id: 'b', entity_name: 'Charlotte', funnel_bucket: 'expiring' }),
      fila({ entity_id: 'c', entity_name: 'Parras', funnel_bucket: 'expiring' }),
    ] })
    expect(within(screen.getByTestId('grupo-expiring')).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByTestId('grupo-not_enabled')).getByText('1')).toBeInTheDocument()
  })

  // Spec §3: los baldes hablan el glosario. Ninguno nombra el ciclo de vida.
  it('los grupos usan las palabras del glosario y ninguno es "No activas"', () => {
    setup({ rows: [] })
    for (const titulo of ['No habilitada', 'Por vencer', 'Al día']) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(titulo) })).toBeInTheDocument()
    }
    for (const viejo of ['No activas', 'Sin documentos', 'Incompletas', 'Con vencimientos']) {
      expect(screen.queryByText(viejo)).not.toBeInTheDocument()
    }
  })

  it('primero lo que no deja operar, después lo que vence, al final lo que está al día', () => {
    setup({ rows: [fila({ funnel_bucket: 'up_to_date' })] })
    expect(screen.getAllByTestId(/^grupo-/).map(e => e.dataset.testid)).toEqual([
      'grupo-not_enabled', 'grupo-expiring', 'grupo-up_to_date',
    ])
  })

  // Conflicto 1 de la auditoría: el ciclo de vida es un filtro, no un balde.
  it('el ciclo de vida es un filtro con las pestañas del Directorio, y arranca en Activas', () => {
    setup()
    const filtro = screen.getByRole('group', { name: 'Ciclo de vida' })
    expect(within(filtro).getByRole('button', { name: /Activas/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(filtro).getByRole('button', { name: /En onboarding/ })).toBeInTheDocument()
    expect(within(filtro).getByRole('button', { name: /Dadas de baja/ })).toBeInTheDocument()
    expect(screen.queryByTestId('grupo-catalogo')).not.toBeInTheDocument()
  })

  // R-E2: una no activa con archivos sin clasificar llega en el alcance activo,
  // pero nunca cae en "No habilitada".
  it('una empresa no activa nunca cae en un balde, aunque llegue en el alcance activo', () => {
    setup({ rows: [
      fila({ entity_id: 'x', entity_name: 'Baja Con Archivos', operational_status: 'INACTIVE',
             funnel_bucket: 'not_enabled', unclassified_count: 3 }),
    ] })
    expect(screen.queryByText('Baja Con Archivos')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('grupo-not_enabled')).getByText('0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dadas de baja/ }))
    expect(screen.getByText('Baja Con Archivos')).toBeInTheDocument()
  })

  // R-E2: ONBOARDING sigue en el alcance activo (decisión del usuario), sin balde.
  it('una empresa en onboarding se ve en su pestaña sin pedir el catálogo, y nunca en un balde', () => {
    const p = setup({ rows: [
      fila({ entity_id: 'o', entity_name: 'Recién Creada', operational_status: 'ONBOARDING', funnel_bucket: null }),
    ] })
    expect(screen.queryByText('Recién Creada')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /En onboarding/ })).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: /En onboarding/ }))
    expect(screen.getByText('Recién Creada')).toBeInTheDocument()
    expect(p.onExpandCatalog).not.toHaveBeenCalled()
  })

  it('elegir Dadas de baja pide el catálogo, y si falla lo dice y deja reintentar', () => {
    const p = setup({ catalogEstado: 'error' })
    fireEvent.click(screen.getByRole('button', { name: /Dadas de baja/ }))
    expect(p.onExpandCatalog).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo cargar/)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(p.onExpandCatalog).toHaveBeenCalledTimes(2)
  })

  it('el catálogo sin pedir no inventa un cero en su pestaña', () => {
    setup()
    expect(screen.getByRole('button', { name: /Dadas de baja/ })).not.toHaveTextContent(/\d/)
  })

  // Spec §3: la empresa no activa se muestra en gris y con su ciclo de vida.
  it('en Dadas de baja la fila dice su ciclo de vida y la habilitación va en gris', () => {
    setup({ catalogEstado: 'listo', catalogRows: [
      fila({ entity_id: 'v', entity_name: 'Vieja Ltda', operational_status: 'LEGACY_INACTIVE', funnel_bucket: null }),
    ] })
    fireEvent.click(screen.getByRole('button', { name: /Dadas de baja/ }))
    const enlace = screen.getByRole('link', { name: /Vieja Ltda/ })
    expect(within(enlace).getByText('Dada de baja')).toBeInTheDocument()
    expect(enlace.innerHTML).not.toMatch(/status-incidente/)
  })

  // Spec §1: las cifras de la empresa son las de Pendientes, lo propio más la flota.
  it('las cifras de la fila salen de compliance_summary, propias más flota', () => {
    setup({ rows: [fila()] })
    const enlace = screen.getByRole('link', { name: /Transportes Charlotte Spa/ })
    expect(within(enlace).getByTestId('counts-overdue')).toHaveTextContent('1')
    expect(within(enlace).getByTestId('counts-expiring')).toHaveTextContent('0')
    expect(within(enlace).getByTestId('counts-missing')).toHaveTextContent('5')
  })

  it('"Al día" arranca plegado y los otros dos abiertos', () => {
    setup()
    expect(screen.getByTestId('grupo-up_to_date')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('grupo-not_enabled')).toHaveAttribute('aria-expanded', 'true')
  })

  it('la barra se pinta de resuelto solo con el balde Al día, no recalcula pendientes', () => {
    setup({ rows: [fila({ funnel_bucket: 'up_to_date', pending_count: 5 })] })
    fireEvent.click(screen.getByTestId('grupo-up_to_date'))
    expect(screen.getByRole('link').innerHTML).toMatch(/bg-resuelto/)
  })

  it('muestra el avance de cada empresa', () => {
    setup({ rows: [fila({ satisfied_count: 3, total_count: 93 })] })
    expect(screen.getByText('3 de 93')).toBeInTheDocument()
  })

  // Spec §9: el rojo #b00020 tiene UN significado, "hay archivos esperando".
  // El mockup del brainstorming pintaba "opera · N viajes" en rojo; se
  // descarta a proposito, porque si todo tiene color el color deja de avisar.
  it('la marca de actividad no usa el rojo reservado a los archivos que esperan', () => {
    setup({ rows: [fila({ trips_30d: 14, unclassified_count: 0 })] })

    // Desde la Entrega 2 de fichas el número va bajo la columna "Viajes 30 días".
    const marca = screen.getByTestId('viajes-c1')
    expect(marca).toHaveTextContent('14')
    expect(marca.className).not.toMatch(/red|espera/)
  })

  it('los archivos esperando si van en rojo, y dicen cuantos', () => {
    setup({ rows: [fila({ unclassified_count: 12 })] })
    const marca = screen.getByTestId('espera-c1')
    expect(marca.textContent).toContain('12')
  })

  it('no inventa actividad cuando no hay viajes', () => {
    setup({ rows: [fila({ trips_30d: 0 })] })
    expect(screen.getByTestId('viajes-c1')).toBeEmptyDOMElement()
  })

  it('muestra el tipo de gestion de la empresa', () => {
    setup({ rows: [fila({ management_types: ['TRACTOREO'] })] })
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })

  // Hay 1 empresa mixta real y el spec pide mostrarla como tal, no esconder
  // una de las dos.
  it('la empresa mixta muestra las dos gestiones', () => {
    setup({ rows: [fila({ management_types: ['TRACTOREO', 'EQUIPO_COMPLETO'] })] })
    expect(screen.getByText('Tractoreo + Equipo Completo')).toBeInTheDocument()
  })

  it('sin gestion declarada ni flota no muestra marca', () => {
    setup({ rows: [fila({ management_types: null })] })
    expect(screen.queryByText(/tractoreo/i)).not.toBeInTheDocument()
  })

  // La fila NAVEGA a la ficha, asi que es un enlace: mientras fue un
  // `role="button"` con `aria-expanded`, un lector de pantalla anunciaba
  // "boton, contraido" y activarlo sacaba de la pantalla.
  it('la fila es un enlace a la ficha, no un desplegable', () => {
    setup()

    const enlace = screen.getByRole('link', { name: /Transportes Charlotte Spa/ })
    expect(enlace).toHaveAttribute('href', '/dashboard/carriers/c1?tab=documentos')
    expect(enlace).not.toHaveAttribute('aria-expanded')
  })

  it('sin coincidencias activas, los baldes siguen y dicen que no hay ninguna', () => {
    setup({ rows: [] })
    expect(screen.getAllByText('Ninguna').length).toBeGreaterThan(0)
  })
})
