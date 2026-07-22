import { describe, it, expect } from 'vitest'
import { bucketDate, fieldValues, distinctFieldValues, applyFilters, buildPivot } from './pivot'
import type { DailyClosureReportRow } from '@/lib/types'

function row(overrides: Partial<DailyClosureReportRow> = {}): DailyClosureReportRow {
  return {
    driver_id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1',
    carrier_id: 'c1', carrier_name: 'Transportes Sur', status: 'ASSIGNED',
    unassigned_reason_id: null, unassigned_reason_label: null,
    client_names: [], business_date: '2026-07-21',
    ...overrides,
  }
}

describe('bucketDate', () => {
  it('day devuelve la fecha tal cual', () => {
    expect(bucketDate('2026-07-21', 'day')).toBe('2026-07-21')
  })
  it('week devuelve el lunes de esa semana', () => {
    // 2026-07-21 es martes
    expect(bucketDate('2026-07-21', 'week')).toBe('Semana del 2026-07-20')
  })
  it('month devuelve YYYY-MM', () => {
    expect(bucketDate('2026-07-21', 'month')).toBe('2026-07')
  })
  it('quarter devuelve el trimestre calendario', () => {
    expect(bucketDate('2026-07-21', 'quarter')).toBe('2026-T3')
    expect(bucketDate('2026-01-05', 'quarter')).toBe('2026-T1')
    expect(bucketDate('2026-12-31', 'quarter')).toBe('2026-T4')
  })
  it('semester devuelve el semestre calendario', () => {
    expect(bucketDate('2026-07-21', 'semester')).toBe('2026-S2')
    expect(bucketDate('2026-01-01', 'semester')).toBe('2026-S1')
    expect(bucketDate('2026-06-30', 'semester')).toBe('2026-S1')
  })
})

describe('fieldValues', () => {
  it('cliente sin cliente devuelve "Sin cliente"', () => {
    expect(fieldValues(row(), { field: 'client' })).toEqual(['Sin cliente'])
  })
  it('cliente multi-valor devuelve todos', () => {
    expect(fieldValues(row({ client_names: ['Walmart', 'Sodimac'] }), { field: 'client' })).toEqual(['Walmart', 'Sodimac'])
  })
  it('motivo solo aplica a UNASSIGNED', () => {
    expect(fieldValues(row({ status: 'ASSIGNED' }), { field: 'reason' })).toEqual(['—'])
    expect(fieldValues(row({ status: 'UNASSIGNED', unassigned_reason_label: 'Pana' }), { field: 'reason' })).toEqual(['Pana'])
    expect(fieldValues(row({ status: 'UNASSIGNED', unassigned_reason_label: null }), { field: 'reason' })).toEqual(['Sin especificar'])
  })
})

describe('distinctFieldValues', () => {
  it('deduplica valores', () => {
    const rows = [row({ carrier_name: 'A' }), row({ carrier_name: 'A' }), row({ carrier_name: 'B' })]
    expect(distinctFieldValues(rows, { field: 'carrier' })).toEqual(['A', 'B'])
  })
})

describe('applyFilters', () => {
  it('sin filtros devuelve todo', () => {
    const rows = [row({ carrier_name: 'A' }), row({ carrier_name: 'B' })]
    expect(applyFilters(rows, [])).toHaveLength(2)
  })
  it('filtra por valor permitido', () => {
    const rows = [row({ carrier_name: 'A' }), row({ carrier_name: 'B' })]
    const filtered = applyFilters(rows, [{ spec: { field: 'carrier' }, allowed: new Set(['A']) }])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].carrier_name).toBe('A')
  })
  it('un valor multi-valor pasa si AL MENOS uno matchea', () => {
    const rows = [row({ client_names: ['Walmart', 'Sodimac'] })]
    const filtered = applyFilters(rows, [{ spec: { field: 'client' }, allowed: new Set(['Sodimac']) }])
    expect(filtered).toHaveLength(1)
  })
})

describe('buildPivot', () => {
  it('sin filas ni columnas, todo cae en Total/Total', () => {
    const rows = [row(), row()]
    const pivot = buildPivot(rows, [], [])
    expect(pivot.grandTotal).toBe(2)
    expect(pivot.cells['Total']['Total']).toBe(2)
  })

  it('agrupa por una dimensión en filas, columnas fijas a Total', () => {
    const rows = [
      row({ carrier_name: 'A' }), row({ carrier_name: 'A' }), row({ carrier_name: 'B' }),
    ]
    const pivot = buildPivot(rows, [{ field: 'carrier' }], [])
    expect(pivot.rowTotals['A']).toBe(2)
    expect(pivot.rowTotals['B']).toBe(1)
    expect(pivot.grandTotal).toBe(3)
  })

  it('cruza empresa (filas) x estado (columnas)', () => {
    const rows = [
      row({ carrier_name: 'A', status: 'ASSIGNED' }),
      row({ carrier_name: 'A', status: 'UNASSIGNED' }),
      row({ carrier_name: 'B', status: 'ASSIGNED' }),
    ]
    const pivot = buildPivot(rows, [{ field: 'carrier' }], [{ field: 'status' }])
    expect(pivot.cells['A']['Asignado']).toBe(1)
    expect(pivot.cells['A']['No asignado']).toBe(1)
    expect(pivot.cells['B']['Asignado']).toBe(1)
    expect(pivot.colTotals['Asignado']).toBe(2)
  })

  it('un conductor con 2 clientes cuenta una vez por cada cliente', () => {
    const rows = [row({ client_names: ['Walmart', 'Sodimac'] })]
    const pivot = buildPivot(rows, [{ field: 'client' }], [])
    expect(pivot.rowTotals['Walmart']).toBe(1)
    expect(pivot.rowTotals['Sodimac']).toBe(1)
    expect(pivot.grandTotal).toBe(2) // por diseño: "por cliente" no es "por conductor"
  })

  it('múltiples campos en filas arman una clave compuesta', () => {
    const rows = [row({ carrier_name: 'A', status: 'ASSIGNED' })]
    const pivot = buildPivot(rows, [{ field: 'carrier' }, { field: 'status' }], [])
    expect(pivot.rowKeys).toEqual(['A / Asignado'])
  })
})
