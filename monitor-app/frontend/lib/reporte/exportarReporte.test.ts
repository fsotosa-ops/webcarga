import { describe, it, expect } from 'vitest'
import type { ClosureScope, OperationTypeReport } from '@/lib/types'
import { hojaDeLaTabla, hojasDeLaSeccion, hojasDelReporte } from './exportarReporte'

function reporte(over: Partial<OperationTypeReport> = {}): OperationTypeReport {
  return {
    summary: { total: 3, assigned: 2, not_working: 1, utilization_pct: 66.7,
               by_client: [{ client_name: 'Walmart', assigned: 2 }],
               by_home_origin: [{ origin: 'CD Lo Aguirre', enrolled: 3, assigned: 2 }],
               multi_day: { total: 1, by_days_back: { '2': 1 } } },
    assigned: {
      rows: [
        { client_name: 'Walmart', origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', rm: 1, z0: 0, region: 0, unclassified: 0, total: 1,
          vehicles: [{ tractor_plate: 'ABCD12', driver_name: 'Juan Pérez', zone: 'rm', trips: [{ id: 't1', code: '2033000' }, { id: 't2', code: '2033001' }] }] },
        { client_name: 'Walmart', origin: 'CD Quilicura', carrier_name: 'Norte Spa', rm: 0, z0: 1, region: 0, unclassified: 0, total: 1,
          vehicles: [{ tractor_plate: 'EFGH34', driver_name: 'Ana Soto', zone: 'z0' }] },
      ],
      other_origin: [],
    },
    worked_without_assignment: { reasons: [], rows: [] },
    second_legs: [],
    not_working: { reasons: ['Panne'], by_reason: [{ origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', counts: { Panne: 1 }, total: 1 }],
                   detail: [{ name: 'Juan Pérez', carrier_name: 'Transportes Sur', home_origin: 'CD Lo Aguirre', reason: 'Panne', tractor_plate: 'ABCD12' }] },
    carriers: [{ carrier_name: 'Transportes Sur', enrolled: 3, assigned: 2, unassigned: 1, utilization_pct: 66.7 }],
    ...over,
  }
}

const POR_TIPO: Record<ClosureScope, OperationTypeReport> = { tractoreo: reporte(), equipo_completo: reporte() }
const negrita = (v: unknown) => typeof v === 'object' && v !== null && (v as { fontWeight?: string }).fontWeight === 'bold'
const valor = (v: unknown) => (typeof v === 'object' && v !== null ? (v as { value: unknown }).value : v)

describe('hojasDelReporte', () => {
  it('trae los dos tipos, una hoja por sección, y Dotación al final', () => {
    expect(hojasDelReporte(POR_TIPO, []).map(h => h.sheet)).toEqual([
      'Resumen · Tractoreo', 'Resumen · Eq. Completo',
      'Asignados · Tractoreo', 'Asignados · Eq. Completo',
      'Conductores · Tractoreo', 'Conductores · Eq. Completo',
      'Segundas vueltas · Tractoreo', 'Segundas vueltas · Eq. Completo',
      'No trabajaron · Tractoreo', 'No trabajaron · Eq. Completo',
      'Empresas · Tractoreo', 'Empresas · Eq. Completo',
      'Dotación',
    ])
  })

  it('ningún nombre de hoja pasa de 31 caracteres (Excel lo rechaza)', () => {
    for (const h of hojasDelReporte(POR_TIPO, [])) expect(h.sheet.length).toBeLessThanOrEqual(31)
  })

  it('Asignados sigue el CSV de Pablo: subtotales en negrita y total general al pie', () => {
    const hoja = hojasDelReporte(POR_TIPO, []).find(h => h.sheet === 'Asignados · Tractoreo')!
    expect(hoja.data[0].map(valor)).toEqual(['Cliente', 'Origen', 'Empresa', 'RM', 'Z0', 'Región', 'Sin clasificar', 'Total'])
    const cliente = hoja.data[1]
    expect(valor(cliente[0])).toBe('Walmart')
    expect(negrita(cliente[0]) && negrita(cliente[7])).toBe(true)
    expect(valor(cliente[7])).toBe(2)
    const empresa = hoja.data.find(f => f[2] === 'Transportes Sur')!
    expect(negrita(empresa[7])).toBe(false)
    const pie = hoja.data[hoja.data.length - 1]
    expect(pie.map(valor)).toEqual(['Total', null, null, 1, 1, 0, 0, 2])
    // Como el CSV de Pablo: hasta la empresa, sin los conductores.
    expect(JSON.stringify(hoja.data)).not.toContain('Juan Pérez')
  })

  it('No trabajaron dice "Conductor" en Tractoreo y "Equipo" en Equipo Completo', () => {
    const hojas = hojasDelReporte(POR_TIPO, [])
    const encabezados = (nombre: string) => hojas.find(h => h.sheet === nombre)!.data.map(f => valor(f[0]))
    expect(encabezados('No trabajaron · Tractoreo')).toContain('Conductor')
    expect(encabezados('No trabajaron · Eq. Completo')).toContain('Equipo')
  })

  it('el Resumen trae los viajes de varios días', () => {
    const hoja = hojasDelReporte(POR_TIPO, []).find(h => h.sheet === 'Resumen · Tractoreo')!
    const filas = hoja.data.map(f => f.map(valor))
    expect(filas).toContainEqual(['Viajes de varios días', 1])
    expect(filas).toContainEqual(['Hace 2 días', 1])
  })

  it('Dotación lista el desbalance por empresa', () => {
    const hoja = hojasDelReporte(POR_TIPO, [
      { carrier_id: 'c1', business_name: 'Transportes Sur', n_tractos: 3, n_conductores: 1, gap: 2 },
    ]).find(h => h.sheet === 'Dotación')!
    expect(hoja.data.map(f => f.map(valor))).toContainEqual(['Transportes Sur', 3, 1, 2])
  })

  it('los Nº de viaje entran al Excel: Conductores (de Asignados) y Segundas vueltas (C14)', () => {
    const conVueltas = { ...POR_TIPO, tractoreo: reporte({ second_legs: [{ tractor_plate: 'ABCD12', carrier_name: 'Transportes Sur',
      driver_name: 'Juan Pérez', origin: 'CD Lo Aguirre', destination_zone: 'RM', legs: 2,
      trips: [{ id: 't1', code: '2033000' }, { id: 't2', code: '2033001' }] }] }) }
    const hojas = hojasDelReporte(conVueltas, [])
    const conductores = hojas.find(h => h.sheet === 'Conductores · Tractoreo')!.data.map(f => f.map(valor))
    expect(conductores[0]).toEqual(['Cliente', 'Origen', 'Empresa', 'Conductor', 'Patente', 'Nº viaje'])
    expect(conductores).toContainEqual(['Walmart', 'CD Lo Aguirre', 'Transportes Sur', 'Juan Pérez', 'ABCD12', '2033000, 2033001'])
    const vueltas = hojas.find(h => h.sheet === 'Segundas vueltas · Tractoreo')!.data.map(f => f.map(valor))
    expect(vueltas[0]).toContain('Nº viaje')
    expect(vueltas[1]).toContain('2033000, 2033001')
  })
})

describe('lo que estás viendo (C13)', () => {
  it('una sección del informe: sus hojas del alcance a la vista, y arriba el recorte', () => {
    const hojas = hojasDeLaSeccion('assigned', POR_TIPO.tractoreo, 'tractoreo', 'Recorte: Tractoreo · Cliente: Walmart')
    expect(hojas.map(h => h.sheet)).toEqual(['Asignados · Tractoreo', 'Conductores · Tractoreo'])
    for (const h of hojas) expect(valor(h.data[0][0])).toBe('Recorte: Tractoreo · Cliente: Walmart')
  })

  it('una tabla: sus columnas visibles en su orden y sus filas, con el recorte arriba', () => {
    const hoja = hojaDeLaTabla('Segundas vueltas', 'Recorte: Tractoreo · 1 fila',
      [{ header: 'Patente' }, { header: 'Vueltas', numeric: true }], [['ABCD12', '2']])
    expect(hoja.data.map(f => f.map(valor))).toEqual([['Recorte: Tractoreo · 1 fila'], [], ['Patente', 'Vueltas'], ['ABCD12', 2]])
  })
})
