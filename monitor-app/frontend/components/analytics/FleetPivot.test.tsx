import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { FleetPivot } from './FleetPivot'
import type { PivotRow } from '@/lib/utils/pivot'

// Las mismas filas que probaba la Reportería (ahora salen de analytics.fleet_daily).
const FILAS: PivotRow[] = [
  { carrier_name: 'Transportes Sur', client_names: ['Walmart'], status: 'ASSIGNED', unassigned_reason_label: null, business_date: '2026-07-20' },
  { carrier_name: 'Transportes Sur', client_names: [], status: 'UNASSIGNED', unassigned_reason_label: 'Pana', business_date: '2026-07-20' },
  { carrier_name: 'Rios Ltda', client_names: ['Sodimac'], status: 'MISMATCH', unassigned_reason_label: null, business_date: '2026-07-21' },
]

const pintar = () => render(<FleetPivot rows={FILAS} filename="tabla_dinamica.csv" />)

describe('FleetPivot (la tabla dinámica de la Reportería, ahora en Analítica)', () => {
  it('arma el pivot por defecto: Empresa (filas) x Estado (columnas)', () => {
    pintar()
    expect(screen.getByText('Transportes Sur')).toBeInTheDocument()
    expect(screen.getByText('Rios Ltda')).toBeInTheDocument()
    expect(screen.getByText('Asignado')).toBeInTheDocument()
    expect(screen.getByText('No asignado')).toBeInTheDocument()
  })

  it('Empresa × semana con las filas de ejemplo', () => {
    pintar()
    const columnas = screen.getByText('Columnas').closest('div')!
    fireEvent.click(within(columnas).getByRole('button', { name: 'Quitar Estado' }))
    fireEvent.change(within(columnas).getByText('+ Agregar campo').closest('select')!, { target: { value: 'date' } })
    fireEvent.change(within(columnas).getByRole('combobox', { name: 'Agrupar la fecha por' }), { target: { value: 'week' } })
    const fila = screen.getByText('Transportes Sur', { selector: 'td' }).closest('tr')!
    expect(within(fila).getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getByText('Semana del 2026-07-20')).toBeInTheDocument()
  })

  it('quita un campo de Filas con el botón de la chip', async () => {
    pintar()
    const filas = screen.getByText('Filas').closest('div')!
    fireEvent.click(within(filas).getByRole('button', { name: 'Quitar Empresa' }))
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByText('Total').length).toBeGreaterThan(0))
  })

  it('filtra por un valor de un campo agregado a Filtros', async () => {
    pintar()
    const filtros = screen.getByText('Filtros').closest('div')!
    fireEvent.change(within(filtros).getByText('+ Agregar filtro').closest('select')!, { target: { value: 'carrier' } })
    const casilla = within(filtros).getAllByRole('checkbox').find(cb => cb.closest('label')?.textContent?.includes('Rios Ltda'))!
    fireEvent.click(casilla)
    await waitFor(() => expect(screen.queryByText('Rios Ltda', { selector: 'td' })).not.toBeInTheDocument())
  })

  it('exporta CSV', () => {
    const click = vi.fn()
    const crear = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = crear(tag)
      if (tag === 'a') el.click = click
      return el
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
    pintar()
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }))
    expect(click).toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
