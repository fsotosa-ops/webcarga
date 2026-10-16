/** Datos de prueba de la Flota del día, compartidos por los tests del módulo
 *  (`flotaDelDia.test.ts`) y de la sección (`FlotaDelDiaSection.test.tsx`). */
import type {
  CategoriaDeLinea, DailyClosureStatus, DriverDayStatusValue, EquipmentClosureStatus, EquipmentDayStatusRow,
  UnassignedReasonMeta,
} from '@/lib/types'

/** Motivos de ejemplo, con la forma de `tripsMeta.unassigned_reasons` (un dato de
 *  prueba, no el catálogo: el catálogo real lo dan `/trips/meta` y Configuración). */
export const REASON_PANA: UnassignedReasonMeta = { id: 'pana', label: 'Pana', group: 'no_trabajando' }
export const REASON_WAITING: UnassignedReasonMeta = { id: 'esperando', label: 'Esperando carga', group: 'trabajando_sin_asignacion' }
export const REASONS: UnassignedReasonMeta[] = [REASON_PANA, REASON_WAITING]

/** Los estados de una línea tal como los manda la API: estado, categoría y motivo
 *  juntos y EXPLÍCITOS. La categoría la calcula el backend (`cierre_lineas.py`);
 *  aquí no se deriva con una copia de esa regla, se declara en cada ejemplo. */
export const LINE = {
  assigned:      { status: 'ASSIGNED', category: 'ASIGNADO', unassigned_reason_id: null, unassigned_reason_label: null },
  withoutReason: { status: 'UNASSIGNED', category: 'SIN_RESOLVER', unassigned_reason_id: null, unassigned_reason_label: null },
  notWorking:    { status: 'UNASSIGNED', category: 'NO_TRABAJANDO', unassigned_reason_id: REASON_PANA.id, unassigned_reason_label: REASON_PANA.label },
  workingUnassigned: {
    status: 'UNASSIGNED', category: 'TRABAJANDO_SIN_ASIGNACION',
    unassigned_reason_id: REASON_WAITING.id, unassigned_reason_label: REASON_WAITING.label,
  },
  toRegularize:  { status: 'MISMATCH', category: 'POR_REGULARIZAR', unassigned_reason_id: null, unassigned_reason_label: null },
} as const satisfies Record<string, {
  status: DriverDayStatusValue; category: CategoriaDeLinea; unassigned_reason_id: string | null; unassigned_reason_label: string | null
}>

type LineaDeConductor = DailyClosureStatus['drivers'][number]

/** Una línea de conductor; por defecto, sin motivo. Cada test pisa lo que necesita. */
export function driverRow(overrides: Partial<LineaDeConductor> = {}): LineaDeConductor {
  return {
    driver_id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1', carrier_id: 'c1', carrier_name: 'Transportes Sur',
    ...LINE.withoutReason,
    resolved_by: null, resolved_at: null, client_names: [], driver_pending_docs_critical: null,
    suggested_reason_id: null, trip_id: null, today_trip_id: null, today_trip_code: null, today_trip_origin: null,
    comentario: null, last_known_tractor_plate: null, last_known_operation_type: null,
    home_cd_id: null, home_cd_name: null, valid_until: null,
    ...overrides,
  }
}

/** Una línea de tracto; por defecto, sin motivo. */
export function equipmentRow(overrides: Partial<EquipmentDayStatusRow> = {}): EquipmentDayStatusRow {
  return {
    asset_id: 'a1', tractor_plate: 'XYZ111', carrier_id: 'c2', carrier_name: 'RPS Logística',
    fleet_service_type_label: null, requires_motivo: false,
    ...LINE.withoutReason,
    resolved_by: null, resolved_at: null, driver_id: null, driver_name: null,
    trip_id: null, trip_driver_id: null, trip_driver_name: null,
    today_trip_code: null, today_trip_origin: null, today_trip_client: null, comentario: null,
    home_cd_id: null, home_cd_name: null, valid_until: null,
    ...overrides,
  }
}

export const DRIVERS_STATUS: DailyClosureStatus = {
  business_date: '2026-08-04', closed: false, closure: null,
  total_drivers: 4, assigned_count: 1, unassigned_count: 2, mismatch_count: 1, pending_count: 2,
  pre_cierre: {
    auto_resolved: [],
    escalations: {
      PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
      EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
    },
  },
  drivers: [
    driverRow({ ...LINE.withoutReason, driver_id: 'd1', full_name: 'Ana Soto', carrier_name: 'Transportes Sur', last_known_tractor_plate: 'ABCD12', last_known_operation_type: 'Tractoreo' }),
    driverRow({ ...LINE.toRegularize, driver_id: 'd2', full_name: 'Luis Rojas', carrier_name: 'Transportes Norte', trip_id: 't1' }),
    driverRow({ ...LINE.assigned, driver_id: 'd3', full_name: 'Juan Pérez', carrier_name: 'Transportes Sur', today_trip_id: 't3', today_trip_code: '2045490', today_trip_origin: 'CD LO AGUIRRE' }),
    driverRow({ ...LINE.notWorking, driver_id: 'd4', full_name: 'Carla Díaz', carrier_name: 'Transportes Sur' }),
  ],
}

export const EQUIPMENT_STATUS: EquipmentClosureStatus = {
  business_date: '2026-08-04', closed: false, closure: null,
  // Reproduce en chico lo que el 03-09 traia en grande: tractos ASSIGNED con
  // conductor y tractos UNASSIGNED sin motivo. Los 43 de ese dia llegaban aca
  // y no los mostraba ninguna pestana.
  tractoreo: {
    summary: { total: 3, assigned: 2, unassigned: 1, utilization_pct: 66.7 },
    pending_count: 1,
    equipment: [
      equipmentRow({ ...LINE.assigned,
        asset_id: 'tr1', tractor_plate: 'FCCP42', carrier_name: 'Dankar Logistic Spa', requires_motivo: true, trip_id: 'tt1',
        driver_id: 'h1', driver_name: 'Brian Celis (habitual)',
        trip_driver_id: 'v1', trip_driver_name: 'Celis Huerta Brian' }),
      equipmentRow({ ...LINE.assigned,
        asset_id: 'tr2', tractor_plate: 'HKXW55', carrier_name: 'Comercializadora De Los Rios Ltda', requires_motivo: true, trip_id: 'tt2' }),
      equipmentRow({ ...LINE.withoutReason,
        asset_id: 'tr3', tractor_plate: 'DTBY52', carrier_id: 'cf', carrier_name: 'Transportes La Fortaleza Spa', requires_motivo: true }),
    ],
  },
  equipos_completos: {
    summary: { total: 2, assigned: 1, unassigned: 1, utilization_pct: 50.0 },
    by_carrier: [],
    equipment: [
      equipmentRow({ ...LINE.assigned,
        asset_id: 'a1', tractor_plate: 'XYZ111', carrier_name: 'RPS Logística',
        driver_id: 'e1', driver_name: 'Pedro Pérez', trip_id: 't2' }),
      equipmentRow({ ...LINE.withoutReason,
        asset_id: 'a2', tractor_plate: 'XYZ222', carrier_name: 'Equipos Sur',
        driver_id: null, driver_name: null }),
    ],
  },
}

