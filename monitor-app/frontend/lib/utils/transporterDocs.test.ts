// lib/utils/transporterDocs.test.ts
import { describe, it, expect } from 'vitest'
import {
  driverGovernanceToChecklistItems, vehicleGovernanceToChecklistItems,
  withDriverGovernanceField, withVehicleGovernanceField,
} from './transporterDocs'
import type { TransporterDriver, TransporterVehicle } from '@/lib/types'

const DRIVER: TransporterDriver = {
  id: 'd1', rut: '11111111-1', name: 'Juan Pérez',
  governance: {
    id_expiry: '2026-01-01', license_expiry: '2026-02-01',
    anexo_3_gc: 'ok', epp: null, das_odi: 'pendiente', hoja_de_vida: 'ok',
    cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
    creacion_gc_driver: 'ok', avance_total: 90,
  },
}

const VEHICLE: TransporterVehicle = {
  id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
  governance: {
    year: 2020, circ_permit_expiry: '2026-01-01', tech_inspection_expiry: '2026-02-01',
    gas_emissions_expiry: '2026-03-01', soap_insurance_expiry: '2026-04-01',
    padron: 'ok', poliza_rc: null, gps: 'ok', seguro_carga: 'pendiente',
    mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
  },
}

describe('driverGovernanceToChecklistItems', () => {
  it('produces one item per documentation field (not the expiry dates)', () => {
    const items = driverGovernanceToChecklistItems(DRIVER)
    expect(items).toHaveLength(8)
    expect(items.map(i => i.doc_code)).not.toContain('id_expiry')
    expect(items.map(i => i.doc_code)).not.toContain('license_expiry')
  })

  it('maps status and label correctly, with has_expiry always false', () => {
    const items = driverGovernanceToChecklistItems(DRIVER)
    const anexo = items.find(i => i.doc_code === 'anexo_3_gc')!
    expect(anexo.label).toBe('Anexo 3 GC')
    expect(anexo.status).toBe('ok')
    expect(anexo.has_expiry).toBe(false)
    expect(anexo.expiry_date).toBeNull()
    const epp = items.find(i => i.doc_code === 'epp')!
    expect(epp.status).toBeNull()
  })

  it('handles a driver with no governance at all', () => {
    const items = driverGovernanceToChecklistItems({ ...DRIVER, governance: null })
    expect(items).toHaveLength(8)
    expect(items.every(i => i.status === null)).toBe(true)
  })
})

describe('vehicleGovernanceToChecklistItems', () => {
  it('produces one item per documentation field (not the expiry dates)', () => {
    const items = vehicleGovernanceToChecklistItems(VEHICLE)
    expect(items).toHaveLength(6)
    expect(items.map(i => i.doc_code)).not.toContain('circ_permit_expiry')
  })

  it('maps status correctly', () => {
    const items = vehicleGovernanceToChecklistItems(VEHICLE)
    expect(items.find(i => i.doc_code === 'padron')!.status).toBe('ok')
    expect(items.find(i => i.doc_code === 'poliza_rc')!.status).toBeNull()
  })
})

describe('withDriverGovernanceField', () => {
  it('sets one field while preserving the rest', () => {
    const updated = withDriverGovernanceField(DRIVER.governance, 'epp', 'ok')
    expect(updated.epp).toBe('ok')
    expect(updated.anexo_3_gc).toBe('ok')
    expect(updated.id_expiry).toBe('2026-01-01')
  })

  it('works when current governance is null', () => {
    const updated = withDriverGovernanceField(null, 'epp', 'pendiente')
    expect(updated.epp).toBe('pendiente')
  })
})

describe('withVehicleGovernanceField', () => {
  it('sets one field while preserving the rest', () => {
    const updated = withVehicleGovernanceField(VEHICLE.governance, 'poliza_rc', 'ok')
    expect(updated.poliza_rc).toBe('ok')
    expect(updated.padron).toBe('ok')
    expect(updated.circ_permit_expiry).toBe('2026-01-01')
  })
})
