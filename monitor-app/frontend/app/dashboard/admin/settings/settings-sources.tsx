import type { ReactNode } from 'react'
import { configApi, taxonomiesApi, type Direccion, type TaxonomyDomain, type TaxonomyRow, type TripStatusRow } from '@/lib/api/config'
import { taxonomyKey } from '@/lib/queries/taxonomies'
import { BOARD_COLUMNS, boardColumnStyle } from '@/lib/states'
import { StatusChip } from '@/components/ui/StatusChip'
import type { ClaveDeSeccion } from './secciones'

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
  area:        string
  section:     ClaveDeSeccion
  description: string
  queryKey:    readonly unknown[]
  list:        () => Promise<Row[]>
  /** Cómo se llama el elemento en el panel. */
  title:       (row: Row) => string
  columns:     { header: string; cell: (row: Row) => ReactNode }[]
  fields:      SettingsField[]
  values:      (row: Row) => SettingsValues
  save:        (row: Row, changes: SettingsValues) => Promise<unknown>
  /** Una nota fija del panel (por qué no se crea, qué afecta). */
  note?:       ReactNode
  /** Mover arriba o abajo; se aplica al instante. */
  move?:       (row: Row, direction: Direccion) => Promise<unknown>
  create?:     { noun: string; run: (values: SettingsValues) => Promise<unknown> }
  /** Devuelve cuántas reglas de documento lo seguían usando. */
  deactivate?: (row: Row) => Promise<{ en_uso_por: number }>
  filters?:    (rows: Row[]) => { id: string; label: string; match: (row: Row) => boolean }[]
  emptyText:   string
}

const conTono = (label: string, group: string | null | undefined) =>
  <StatusChip tone={boardColumnStyle(group).tone}>{label || '—'}</StatusChip>

const porColumna = <Row extends { group?: string | null }>(rows: Row[]) =>
  BOARD_COLUMNS.filter(c => rows.some(r => r.group === c.id))
    .map(c => ({ id: c.id, label: c.label, match: (r: Row) => r.group === c.id }))

/** Estados del tablero (`app.trip_statuses`): los define el TMS; aquí se ajusta su
 *  nombre visible, su columna (que da el tono) y su orden. */
export const boardStatusSource: SettingsSource<TripStatusRow> = {
  area: 'operations', section: 'tms-statuses',
  description: 'Cómo se ve cada estado del TMS y en qué columna del tablero aparece.',
  queryKey: ['tms-statuses'],
  list: () => configApi.getStatuses(),
  title: s => s.label,
  columns: [
    { header: 'Cómo se ve', cell: s => conTono(s.label, s.group) },
    { header: 'Nombre en el TMS', cell: s => <span className="font-mono text-etiqueta text-informativo">{s.id}</span> },
    { header: 'Columna', cell: s => boardColumnStyle(s.group).label },
  ],
  fields: [
    { key: 'label', label: 'Nombre visible', kind: 'text' },
    { key: 'group', label: 'Columna del tablero', kind: 'select', options: BOARD_COLUMNS,
      help: 'Define en qué columna del tablero aparecen sus viajes y con qué tono se ve.' },
  ],
  values: s => ({ label: s.label, group: s.group }),
  save: (s, c) => configApi.patchStatus(s.id, c as Partial<Pick<TripStatusRow, 'label' | 'group'>>),
  note: 'Este nombre lo define el TMS: los estados no se crean ni se borran desde la app.',
  move: (s, d) => configApi.moveStatus(s.id, d),
  filters: porColumna,
  emptyText: 'No hay estados del TMS todavía.',
}

/** Los vocabularios de `app.status_taxonomies`: un registro, una fuente. */
const VOCABULARIOS: Record<TaxonomyDomain, {
  area: string; section: ClaveDeSeccion; noun: string; description: string; columna: string
  grupo?: { label: string; help: string; options: { id: string; label: string }[]; porDefecto: string; conTono?: boolean }
}> = {
  OPERATIONAL_STATE: {
    area: 'operations', section: 'operational-statuses', noun: 'estado', columna: 'Estado',
    description: 'El vocabulario que usa el equipo para un viaje.',
    grupo: { label: 'Columna del tablero', help: 'Define en qué columna del tablero aparecen sus viajes y con qué tono se ve.',
             options: BOARD_COLUMNS, porDefecto: 'otro', conTono: true },
  },
  EQUIPMENT_STATE: {
    area: 'operations', section: 'equipment-statuses', noun: 'estado', columna: 'Estado',
    description: 'El motivo cuando un equipo no sale.',
  },
  DRIVER_REASON: {
    area: 'operations', section: 'driver-reasons', noun: 'motivo', columna: 'Motivo',
    description: 'Por qué un conductor no está disponible. Lo usa el Cierre del día.',
    grupo: { label: 'Qué significa', porDefecto: 'no_trabajando',
             help: 'Define si el conductor cuenta como No trabajando o como No asignado (trabajó sin carga) en el Cierre.',
             options: [{ id: 'no_trabajando', label: 'No trabajó' }, { id: 'trabajando_sin_asignacion', label: 'Trabajó sin asignación' }] },
  },
  TRIP_UNASSIGNED_REASON: {
    area: 'operations', section: 'unassigned-reasons', noun: 'motivo', columna: 'Motivo',
    description: 'Por qué WebCarga no tomó una carga que le ofrecieron.',
  },
  TRIP_VOID_REASON: {
    area: 'operations', section: 'void-reasons', noun: 'motivo', columna: 'Motivo',
    description: 'Por qué se anula un viaje cargado en la app.',
  },
  FLEET_SERVICE_TYPE: {
    area: 'fleet', section: 'subtypes', noun: 'subtipo', columna: 'Subtipo',
    description: 'La carrocería de un equipo. Lo usan Certificación y Operaciones.',
  },
  WEBCARGA_OPERATION_TYPE: {
    area: 'fleet', section: 'operation-types', noun: 'tipo de operación', columna: 'Tipo de operación',
    description: 'Tractoreo o equipo completo. Lo usan Certificación y Operaciones.',
  },
}

/** La sección de Configuración que edita cada vocabulario (la revisión y el
 *  buscador la necesitan). */
export const SECCION_DE_TAXONOMIA = Object.fromEntries(
  Object.entries(VOCABULARIOS).map(([d, v]) => [d, [v.area, v.section]]),
) as Record<TaxonomyDomain, [area: string, section: ClaveDeSeccion]>

export function vocabularySource(domain: TaxonomyDomain): SettingsSource<TaxonomyRow> {
  const v = VOCABULARIOS[domain]
  const grupo = v.grupo
  const etiquetaDe = (id: string | null | undefined) => grupo?.options.find(o => o.id === id)?.label ?? '—'
  return {
    area: v.area, section: v.section, description: v.description,
    queryKey: taxonomyKey(domain),
    list: () => taxonomiesApi.list(domain),
    title: r => r.label,
    columns: [
      { header: v.columna, cell: r => (grupo?.conTono ? conTono(r.label, r.group) : r.label) },
      ...(grupo ? [{ header: grupo.label, cell: (r: TaxonomyRow) => etiquetaDe(r.group) }] : []),
    ],
    fields: [
      { key: 'label', label: 'Nombre', kind: 'text' },
      ...(grupo ? [{ key: 'group', label: grupo.label, kind: 'select' as const, options: grupo.options, help: grupo.help }] : []),
    ],
    values: r => (grupo ? { label: r.label, group: r.group ?? grupo.porDefecto } : { label: r.label }),
    save: (r, c) => taxonomiesApi.patch(r.id, c as { label?: string; group?: string }),
    move: (r, d) => taxonomiesApi.move(r.id, d),
    create: {
      noun: v.noun,
      run: vals => taxonomiesApi.create({ domain, label: String(vals.label ?? ''), ...(grupo ? { group: String(vals.group ?? grupo.porDefecto) } : {}) }),
    },
    deactivate: r => taxonomiesApi.deactivate(r.id),
    filters: grupo ? rows => grupo.options.filter(o => rows.some(r => r.group === o.id))
      .map(o => ({ id: o.id, label: o.label, match: (r: TaxonomyRow) => r.group === o.id })) : undefined,
    emptyText: `No hay ${v.noun === 'tipo de operación' ? 'tipos de operación' : `${v.noun}s`} todavía.`,
  }
}
