import { readFile } from 'node:fs/promises'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CertificationStatusTable } from './CertificationStatusTable'
import type { CertificationStatusRow } from '@/lib/types'

const fila = (over: Partial<CertificationStatusRow> = {}): CertificationStatusRow => ({
  entity_id: 'c1', entity_name: 'Test Empresa Webcarga',
  carrier_id: 'c1', carrier_name: 'Test Empresa Webcarga', operational_status: 'ACTIVE',
  total_count: 12, satisfied_count: 9, pending_count: 3, pending_mandatory: 1,
  unclassified_count: 0, ...over,
})

describe('CertificationStatusTable', () => {
  it('muestra el avance de cada empresa', () => {
    render(<CertificationStatusTable rows={[fila()]} group="carrier" />)
    expect(screen.getByText('9 de 12')).toBeInTheDocument()
  })

  // Las dos mitades del trabajo en la misma fila: es lo que evita tener que
  // cruzar dos listas hermanas de memoria.
  it('muestra cuántos documentos llegaron sin clasificar', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ unclassified_count: 3 })]} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('marca al día a la empresa sin pendientes', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ satisfied_count: 12, pending_count: 0, pending_mandatory: 0 })]} />)
    expect(screen.getByText(/al día/i)).toBeInTheDocument()
  })

  it('avisa de los obligatorios por ley sin cubrir', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ pending_mandatory: 4 })]} />)
    expect(screen.getByTitle(/4 obligatorios por ley/i)).toBeInTheDocument()
  })

  it('no saca al usuario del modulo', () => {
    render(<CertificationStatusTable rows={[fila()]} group="carrier" />)
    expect(screen.getByText(/Test Empresa Webcarga/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('señala cuando la empresa no está activa', () => {
    render(<CertificationStatusTable group="carrier" rows={[fila({ operational_status: 'LEGACY_INACTIVE', unclassified_count: 2 })]} />)
    expect(screen.getByText(/no activa/i)).toBeInTheDocument()
  })

  it('no deja la tabla vacía sin explicación', () => {
    render(<CertificationStatusTable rows={[]} group="carrier" />)
    expect(screen.getByText(/no hay empresas/i)).toBeInTheDocument()
  })
})

// Un conductor o un vehículo sin la empresa a la que pertenece no dice nada.
describe('CertificationStatusTable — agrupada por conductor o vehículo', () => {
  const conductor = fila({
    entity_id: 'd1', entity_name: 'Juan Pérez',
    carrier_id: 'c9', carrier_name: 'Transportes Sur Spa',
  })

  it('muestra a qué empresa pertenece el conductor', () => {
    render(<CertificationStatusTable rows={[conductor]} group="driver" />)
    expect(screen.getByRole('columnheader', { name: 'Conductor' })).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Transportes Sur Spa')).toBeInTheDocument()
  })

  // La fuga que motivo la ronda: el unico gesto que la fila ofrecia era un
  // enlace a la ficha de Empresas, o sea que el modulo que existe para
  // reemplazar ese flujo empujaba de vuelta hacia el.
  it('el conductor abre su cajon acá, no navega a la ficha', () => {
    const alternar = vi.fn()
    render(<CertificationStatusTable
      rows={[conductor]} group="driver"
      onToggleRow={alternar}
      renderDrawer={() => <div data-testid="cajon">lo que le falta</div>}
    />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(alternar).toHaveBeenCalledWith('d1')
  })

  it('dibuja el cajon de la fila abierta, y solo de esa', () => {
    render(<CertificationStatusTable
      rows={[conductor, fila({ entity_id: 'd2', entity_name: 'Ana Soto', carrier_id: 'c9' })]}
      group="driver"
      openRowId="d1"
      onToggleRow={vi.fn()}
      renderDrawer={r => <div data-testid={`cajon-${r.entity_id}`}>falta</div>}
    />)
    expect(screen.getByTestId('cajon-d1')).toBeInTheDocument()
    expect(screen.queryByTestId('cajon-d2')).not.toBeInTheDocument()
  })

  // Sin empresa activa no hay a donde cargarle nada: el backend resuelve la
  // empresa por `driver_assignments` y no tiene ninguna. Darle cajon
  // prometeria una accion que no se puede completar.
  it('no abre cajon para quien no tiene empresa activa', () => {
    const alternar = vi.fn()
    render(<CertificationStatusTable
      rows={[fila({ entity_id: 'd3', entity_name: 'Sin Asignar', carrier_id: null, carrier_name: null })]}
      group="driver" onToggleRow={alternar} renderDrawer={() => <div>x</div>}
    />)
    fireEvent.click(screen.getByText('Sin Asignar'))
    expect(alternar).not.toHaveBeenCalled()
  })

  it('la columna Empresa navega dentro del modulo', () => {
    const irA = vi.fn()
    render(<CertificationStatusTable rows={[conductor]} group="driver" onIrAEmpresa={irA} />)
    fireEvent.click(screen.getByText('Transportes Sur Spa'))
    expect(irA).toHaveBeenCalledWith('c9')
  })

  it('avisa cuando el conductor no tiene empresa asignada', () => {
    render(<CertificationStatusTable
      rows={[fila({ entity_name: 'Sin Asignar', carrier_id: null, carrier_name: null })]}
      group="driver"
    />)
    expect(screen.getByText(/sin empresa/i)).toBeInTheDocument()
  })

  it('encabeza Vehículo al agrupar por patente', () => {
    render(<CertificationStatusTable rows={[fila({ entity_name: 'HKXW55' })]} group="asset" />)
    expect(screen.getByRole('columnheader', { name: 'Vehículo' })).toBeInTheDocument()
  })

  // Un documento de la bandeja pertenece a una empresa, no a un conductor.
  it('no muestra la columna de sin clasificar fuera de empresas', () => {
    render(<CertificationStatusTable rows={[conductor]} group="driver" />)
    expect(screen.queryByRole('columnheader', { name: /sin clasificar/i })).not.toBeInTheDocument()
  })
})

// ── Guardarraíl del 429 ────────────────────────────────────────────────────

// Esta tabla muestra hasta 200 filas. Sin `prefetch={false}`, Next.js
// prefetchea cada enlace que entra al viewport, cada prefetch ejecuta el
// layout del dashboard —que va a la API de Auth— y Supabase responde 429
// ("Many requests"). Medido en staging el 2026-08-15: 104 llamadas a /user
// en un solo minuto, con el usuario sin hacer un clic.
//
// El prop no llega al DOM, así que se verifica sobre el módulo: es la única
// forma de que su borrado accidental haga ruido.
describe('CertificationStatusTable · prefetch', () => {
  // Este test nacio por un 429 real: la tabla muestra hasta 200 filas, Next
  // prefetcheaba cada <Link> que entraba al viewport, cada prefetch ejecutaba
  // el layout del dashboard y Supabase devolvia "Many requests" (104 llamadas
  // a /user en un minuto). Ahora la tabla no enlaza a ningun lado, asi que la
  // afirmacion correcta es MAS fuerte y cubre lo mismo: sin enlaces no hay
  // prefetch, y de paso no hay fuga fuera del modulo.
  it('la tabla no enlaza fuera del modulo', async () => {
    const fuente = await readFile(
      'components/compliance/CertificationStatusTable.tsx', 'utf-8',
    )
    expect(fuente).not.toContain('dashboard/carriers')
    expect(fuente).not.toContain('<Link')
  })

})
