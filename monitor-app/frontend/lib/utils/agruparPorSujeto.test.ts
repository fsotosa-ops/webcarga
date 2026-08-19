import { describe, it, expect } from 'vitest'
import { agruparPorSujeto } from './agruparPorSujeto'
import type { PendingComplianceRow } from '@/lib/types'

function fila(over: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Demo Spa', carrier_tax_id: '1-9',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_id: 'r1', requirement_code: 'F30', document_name: 'F30',
    status: 'MISSING', expiration_date: null,
    urgencia: 'FALTA', expiration_policy: 'NONE',
    ...over,
  } as PendingComplianceRow
}

describe('agruparPorSujeto', () => {
  it('agrupa la empresa antes que los conductores y los vehículos', () => {
    const sujetos = agruparPorSujeto([
      fila({ id: 'p3', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Conductor Uno' }),
      fila({ id: 'p1', entity_type: 'CARRIER', entity_id: 'c1', subject_name: null }),
    ])
    expect(sujetos.map(s => s.entityType)).toEqual(['CARRIER', 'DRIVER', 'ASSET'])
  })

  it('titula el sujeto CARRIER "De la empresa"', () => {
    const sujetos = agruparPorSujeto([fila({ entity_type: 'CARRIER', entity_id: 'c1' })])
    expect(sujetos[0].titulo).toBe('De la empresa')
  })

  it('junta las filas del mismo sujeto en un solo grupo', () => {
    const sujetos = agruparPorSujeto([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Conductor Uno' }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Conductor Uno', requirement_id: 'r2' }),
    ])
    expect(sujetos).toHaveLength(1)
    expect(sujetos[0].filas).toHaveLength(2)
  })
})
