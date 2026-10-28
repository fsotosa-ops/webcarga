import type { ReactNode } from 'react'
import { configApi, taxonomiesApi, type Direccion, type TaxonomyDomain, type TaxonomyRow, type TripStatusRow } from '@/lib/api/config'
import type { AlertThresholdMeta, MonitorAlertRules, TemperatureRangeMeta } from '@/lib/types'
import { taxonomyKey } from '@/lib/queries/taxonomies'
import { TRIP_STAGES, tripStageStyle } from '@/lib/states'
import { StatusChip } from '@/components/ui/StatusChip'

/** Un campo del panel de un elemento. */
export type SettingsField =
  | { key: string; label: string; kind: 'text'; help?: string }
  | { key: string; label: string; kind: 'number'; min?: number; help?: string }
  | { key: string; label: string; kind: 'select'; options: { id: string; label: string }[]; help?: string }

export type SettingsValues = Record<string, string | number | null | undefined>

/** De dónde sale y cómo se edita una sección de Configuración (Parte 1).
 *  `SettingsList` dibuja todas igual: lista de lectura + panel. Lo único propio de
 *  cada sección es esto. */
export interface SettingsSource<Row extends { id: string }> {
  /** Área y sección: `area/section` es la clave del permiso (secciones.ts). */
  area:        string
  section:     string
  queryKey:    readonly unknown[]
  list:        () => Promise<Row[]>
  /** Cómo se llama el elemento en el panel. */
  title:       (row: Row) => string
  /** Las columnas de la tabla del kit: `value` filtra, busca y ordena; `cell` dibuja
   *  (por defecto, el valor). */
  columns:     { id: string; header: string; value: (row: Row) => string | null; cell?: (row: Row) => ReactNode }[]
  /** Cómo se dibuja la sección (spec 2026-10-22 §3.1): `list`, una tabla con panel;
   *  `form`, valores sueltos en un formulario. Por defecto, lista. */
  kind?:       'list' | 'form'
  /** Los campos del panel; sin `row`, los del alta. */
  fields:      (row: Row | undefined) => SettingsField[]
  values:      (row: Row) => SettingsValues
  /** Un error que impide guardar, antes de enviar. */
  validate?:   (values: SettingsValues, row?: Row) => string | null
  save:        (row: Row, changes: SettingsValues) => Promise<unknown>
  /** Una nota fija del panel (por qué no se crea, qué afecta). */
  note?:       ReactNode
  /** Mover arriba o abajo; se aplica al instante. */
  move?:       (row: Row, direction: Direccion) => Promise<unknown>
  create?:     { noun: string; run: (values: SettingsValues) => Promise<unknown> }
  /** Desactivar (un vocabulario) o borrar (un rango); se confirma en el panel.
   *  `en_uso_por`: cuántas reglas de documento lo seguían usando. */
  deactivate?: { label: string; confirm: string; run: (row: Row) => Promise<{ en_uso_por?: number } | unknown> }
  emptyText:   string
}

const conTono = (label: string, group: string | null | undefined) =>
  <StatusChip tone={tripStageStyle(group).tone}>{label || '—'}</StatusChip>

/** Estados del viaje (`app.trip_statuses`): los define el TMS; aquí se ajusta su
 *  nombre visible, su columna (que da el tono) y su orden. */
export const tripStatusSource: SettingsSource<TripStatusRow> = {
  area: 'operations', section: 'tms-statuses',
  queryKey: ['tms-statuses'],
  list: () => configApi.getStatuses(),
  title: s => s.label,
  columns: [
    { id: 'label', header: 'Cómo se ve', value: s => s.label, cell: s => conTono(s.label, s.group) },
    { id: 'tms', header: 'Nombre en el TMS', value: s => s.id,
      cell: s => <span className="font-mono text-etiqueta text-informativo">{s.id}</span> },
    { id: 'stage', header: 'Etapa', value: s => tripStageStyle(s.group).label },
  ],
  fields: () => [
    { key: 'label', label: 'Nombre visible', kind: 'text' },
    { key: 'group', label: 'Etapa', kind: 'select', options: TRIP_STAGES,
      help: 'Define en qué etapa del viaje cae el estado y con qué tono se ve.' },
  ],
  values: s => ({ label: s.label, group: s.group }),
  save: (s, c) => configApi.patchStatus(s.id, c as Partial<Pick<TripStatusRow, 'label' | 'group'>>),
  note: 'Este nombre lo define el TMS: los estados no se crean ni se borran desde la app.',
  move: (s, d) => configApi.moveStatus(s.id, d),
  emptyText: 'No hay estados del TMS todavía.',
}

/** A quién se le ofrece un motivo de baja o de reactivación (backend:
 *  GRUPOS_POR_DOMINIO; services/lifecycle.py filtra por esto). */
const APLICA_A = {
  label: 'Aplica a', porDefecto: 'all',
  help: 'A quién se le ofrece este motivo al dar de baja o reactivar.',
  options: [
    // "A todos" y no "Todos": el filtro de la lista ya tiene un "Todos" (el total).
    { id: 'all', label: 'A todos' }, { id: 'carrier', label: 'Empresas' },
    { id: 'driver', label: 'Conductores' }, { id: 'asset', label: 'Equipos' },
  ],
}

const SI_NO = [{ id: 'no', label: 'No' }, { id: 'si', label: 'Sí' }]

/** Los vocabularios de `app.status_taxonomies`: un registro, una fuente. */
const VOCABULARIOS: Record<TaxonomyDomain, {
  area: string; section: string; noun: string; columna: string
  grupo?: { label: string; help: string; options: { id: string; label: string }[]; porDefecto: string; conTono?: boolean }
  /** Los motivos de baja llevan además "Baja definitiva" (28/10). */
  definitiva?: true
}> = {
  OPERATIONAL_STATE: {
    area: 'operations', section: 'operational-statuses', noun: 'estado', columna: 'Estado',
    grupo: { label: 'Etapa', help: 'Define en qué etapa del viaje cae el estado y con qué tono se ve.',
             options: TRIP_STAGES, porDefecto: 'otro', conTono: true },
  },
  EQUIPMENT_STATE: {
    area: 'operations', section: 'equipment-statuses', noun: 'estado', columna: 'Estado',
  },
  DRIVER_REASON: {
    area: 'operations', section: 'driver-reasons', noun: 'motivo', columna: 'Motivo',
    grupo: { label: 'Qué significa', porDefecto: 'no_trabajando',
             help: 'Define si el conductor cuenta como No trabajando o como No asignado (trabajó sin carga) en el Cierre.',
             options: [{ id: 'no_trabajando', label: 'No trabajó' }, { id: 'trabajando_sin_asignacion', label: 'Trabajó sin asignación' }] },
  },
  TRIP_UNASSIGNED_REASON: {
    area: 'operations', section: 'unassigned-reasons', noun: 'motivo', columna: 'Motivo',
  },
  TRIP_VOID_REASON: {
    area: 'operations', section: 'void-reasons', noun: 'motivo', columna: 'Motivo',
  },
  FLEET_SERVICE_TYPE: {
    area: 'fleet', section: 'subtypes', noun: 'subtipo', columna: 'Subtipo',
  },
  WEBCARGA_OPERATION_TYPE: {
    area: 'fleet', section: 'operation-types', noun: 'tipo de operación', columna: 'Tipo de operación',
  },
  DEACTIVATION_REASON: {
    area: 'directory', section: 'deactivation-reasons', noun: 'motivo', columna: 'Motivo',
    grupo: APLICA_A, definitiva: true,
  },
  REACTIVATION_REASON: {
    area: 'directory', section: 'reactivation-reasons', noun: 'motivo', columna: 'Motivo',
    grupo: APLICA_A,
  },
  // Solo empresas (onboarding): no lleva "Aplica a".
  ACTIVATION_EXCEPTION_REASON: {
    area: 'directory', section: 'activation-exception-reasons', noun: 'motivo', columna: 'Motivo',
  },
  // Solo empresas: no lleva "Aplica a".
  RETURN_TO_ONBOARDING_REASON: {
    area: 'directory', section: 'return-to-onboarding-reasons', noun: 'motivo', columna: 'Motivo',
  },
}

/** La sección de Configuración que edita cada vocabulario (la revisión y el
 *  buscador la necesitan). */
export const SECCION_DE_TAXONOMIA = Object.fromEntries(
  Object.entries(VOCABULARIOS).map(([d, v]) => [d, [v.area, v.section]]),
) as Record<TaxonomyDomain, [area: string, section: string]>

export function vocabularySource(domain: TaxonomyDomain): SettingsSource<TaxonomyRow> {
  const v = VOCABULARIOS[domain]
  const grupo = v.grupo
  const etiquetaDe = (id: string | null | undefined) => grupo?.options.find(o => o.id === id)?.label ?? '—'
  return {
    area: v.area, section: v.section,
    queryKey: taxonomyKey(domain),
    list: () => taxonomiesApi.list(domain),
    title: r => r.label,
    columns: [
      { id: 'label', header: v.columna, value: r => r.label,
        cell: r => (grupo?.conTono ? conTono(r.label, r.group) : r.label) },
      ...(grupo ? [{ id: 'group', header: grupo.label, value: (r: TaxonomyRow) => etiquetaDe(r.group) }] : []),
      ...(v.definitiva ? [{ id: 'blocks_reactivation', header: 'Baja definitiva',
        value: (r: TaxonomyRow) => (r.blocks_reactivation ? 'Sí' : 'No') }] : []),
    ],
    fields: () => [
      { key: 'label', label: 'Nombre', kind: 'text' },
      ...(grupo ? [{ key: 'group', label: grupo.label, kind: 'select' as const, options: grupo.options, help: grupo.help }] : []),
      ...(v.definitiva ? [{ key: 'blocks_reactivation', label: 'Baja definitiva', kind: 'select' as const, options: SI_NO,
        help: 'Una baja con este motivo solo la puede revertir Administración.' }] : []),
    ],
    // Sin grupo (llegó así) se muestra vacío y se pide elegirlo: mostrar el de
    // por defecto haría que elegirlo no contara como cambio.
    values: r => ({
      label: r.label,
      ...(grupo ? { group: r.group ?? '' } : {}),
      ...(v.definitiva ? { blocks_reactivation: r.blocks_reactivation ? 'si' : 'no' } : {}),
    }),
    save: (r, c) => {
      const { blocks_reactivation, ...rest } = c as { label?: string; group?: string; blocks_reactivation?: string }
      return taxonomiesApi.patch(r.id, {
        ...rest, ...(blocks_reactivation !== undefined ? { blocks_reactivation: blocks_reactivation === 'si' } : {}),
      })
    },
    move: (r, d) => taxonomiesApi.move(r.id, d),
    create: {
      noun: v.noun,
      run: vals => taxonomiesApi.create({ domain, label: String(vals.label ?? ''), ...(grupo ? { group: String(vals.group ?? grupo.porDefecto) } : {}) }),
    },
    deactivate: { label: 'Desactivar', confirm: 'Sí, desactivar', run: r => taxonomiesApi.deactivate(r.id) },
    emptyText: `No hay ${v.noun === 'tipo de operación' ? 'tipos de operación' : `${v.noun}s`} todavía.`,
  }
}


// ── Parámetros ────────────────────────────────────────────────────────────────

const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`

/** Un umbral de vencimiento, en su área (backend: vencimientos.UMBRALES). */
const AREA_DEL_UMBRAL: Record<string, string> = {
  documento_por_vencer: 'certification',
  poliza_por_vencer:    'insurance',
}

type ThresholdRow = AlertThresholdMeta & { id: string }

export function thresholdSource(docType: string): SettingsSource<ThresholdRow> {
  return {
    area: AREA_DEL_UMBRAL[docType], section: 'expiry-alerts', kind: 'form',
    queryKey: ['config', 'alert-thresholds', docType],
    list: () => configApi.getAlertThresholds()
      .then(rows => rows.filter(r => r.doc_type === docType).map(r => ({ ...r, id: r.doc_type }))),
    title: r => r.label,
    columns: [
      { id: 'label', header: 'Umbral', value: r => r.label },
      { id: 'warning', header: 'Aviso', value: r => `${dias(r.warning_days)} antes` },
      { id: 'error', header: 'Crítico', value: r => (r.error_days ? `${dias(r.error_days)} antes` : 'Al vencer') },
    ],
    fields: () => [
      { key: 'warning_days', label: 'Aviso (días antes)', kind: 'number', min: 1 },
      { key: 'error_days', label: 'Crítico (días antes)', kind: 'number', min: 0,
        help: 'Un tramo dentro del aviso: tiene que ser menor que el aviso. 0 = al vencer.' },
    ],
    values: r => ({ warning_days: r.warning_days, error_days: r.error_days }),
    validate: v => (v.warning_days == null || v.error_days == null ? 'Completa los dos plazos.'
      : Number(v.error_days) >= Number(v.warning_days) ? 'El crítico tiene que ser menor que el aviso.' : null),
    save: (r, c) => configApi.patchAlertThreshold(r.doc_type, c as { warning_days?: number; error_days?: number }),
    emptyText: 'Este umbral no está en la base.',
  }
}

type TemperatureRow = TemperatureRangeMeta & { id: string }

export const temperatureRangeSource: SettingsSource<TemperatureRow> = {
  area: 'operations', section: 'temperature-ranges',
  queryKey: ['config', 'temperature-ranges'],
  list: () => configApi.getTemperatureRanges().then(rows => rows.map(r => ({ ...r, id: r.cargo_type }))),
  title: r => r.label,
  columns: [
    { id: 'label', header: 'Tipo de carga', value: r => r.label },
    { id: 'range', header: 'Rango', value: r => `${r.min_c} a ${r.max_c} °C` },
  ],
  fields: row => [
    ...(row ? [] : [{ key: 'cargo_type', label: 'Código', kind: 'text' as const, help: 'Como lo informa el TMS; no se cambia después.' }]),
    { key: 'label', label: 'Nombre', kind: 'text' },
    { key: 'min_c', label: 'Mínimo (°C)', kind: 'number' },
    { key: 'max_c', label: 'Máximo (°C)', kind: 'number' },
  ],
  values: r => ({ label: r.label, min_c: r.min_c, max_c: r.max_c }),
  validate: v => (v.min_c == null || v.max_c == null ? 'Completa el mínimo y el máximo.'
    : Number(v.min_c) >= Number(v.max_c) ? 'El mínimo tiene que ser menor que el máximo.' : null),
  save: (r, c) => configApi.patchTemperatureRange(r.cargo_type, c as Partial<Pick<TemperatureRangeMeta, 'label' | 'min_c' | 'max_c'>>),
  create: {
    noun: 'rango',
    run: v => configApi.createTemperatureRange({
      cargo_type: String(v.cargo_type ?? ''), label: String(v.label ?? ''), min_c: Number(v.min_c), max_c: Number(v.max_c),
    }),
  },
  deactivate: { label: 'Borrar', confirm: 'Sí, borrar', run: r => configApi.deleteTemperatureRange(r.cargo_type) },
  emptyText: 'No hay rangos de temperatura todavía.',
}

/** Las reglas del Monitor que se editan aquí (dwell_hours sigue en la base pero ya
 *  no es una alerta: lo reemplazó el semáforo del local, Hito 14). */
const REGLAS_DEL_MONITOR: { id: keyof MonitorAlertRules; label: string; unit: string; help: string; optional?: boolean }[] = [
  { id: 'stale_report_hours', label: 'Sin actualización del TMS', unit: 'horas',
    help: 'Horas sin actualización del TMS en un viaje abierto para encender la alerta.' },
  { id: 'tms_dropped_hours', label: 'Ya no está en el TMS', unit: 'horas',
    help: 'Horas que el TMS puede seguir corriendo sin traer un viaje abierto antes de darlo por ausente.' },
  { id: 'dwell_yellow_min', label: 'Semáforo del local: amarillo', unit: 'min', help: 'Minutos en la parada activa para pasar de verde a amarillo.' },
  { id: 'dwell_orange_min', label: 'Semáforo del local: naranja', unit: 'min', help: 'Minutos en la parada activa para pasar a naranja.' },
  { id: 'dwell_red_min', label: 'Semáforo del local: rojo', unit: 'min', help: 'Minutos en la parada activa para pasar a rojo.' },
  { id: 'in_progress_idle_days', label: 'Días sin movimiento para salir de En curso', unit: 'días',
    help: 'Tras esos días sin llegadas ni salidas, un viaje activo deja de verse en En curso (sigue en el Historial y en el Cierre).' },
  { id: 'stale_trip_days', label: 'Viaje entregado sin cierre del TMS', unit: 'días', optional: true,
    help: 'Días desde la última entrega tras los cuales un viaje que el TMS no cerró sale del cierre del día. Vacío: no ocultar ninguno.' },
]

type RuleRow = { id: string; label: string; unit: string; help: string; optional: boolean; value: number | null }

export const monitorRulesSource: SettingsSource<RuleRow> = {
  area: 'operations', section: 'alert-thresholds', kind: 'form',
  queryKey: ['config', 'monitor-alert-rules'],
  list: () => configApi.getMonitorAlertRules().then(r => REGLAS_DEL_MONITOR.map(x => ({
    id: x.id, label: x.label, unit: x.unit, help: x.help, optional: !!x.optional,
    value: (r[x.id] as number | null | undefined) ?? null,
  }))),
  title: r => r.label,
  columns: [
    { id: 'label', header: 'Regla', value: r => r.label },
    { id: 'value', header: 'Valor', value: r => (r.value == null ? 'Sin límite' : `${r.value} ${r.unit}`) },
  ],
  fields: row => [{ key: 'value', label: row ? `Valor (${row.unit})` : 'Valor', kind: 'number', min: 0, help: row?.help }],
  values: r => ({ value: r.value }),
  validate: (v, row) => (v.value == null && !row?.optional ? 'Completa el valor.' : null),
  save: (r, c) => configApi.patchMonitorAlertRules({ [r.id]: c.value ?? null } as Partial<MonitorAlertRules>),
  emptyText: 'No hay reglas del Monitor.',
}

