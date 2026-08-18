'use client'

import { useReducer } from 'react'
import type { AlertSignalId } from '@/lib/utils/alertSignals'

export type Tab = 'en_curso' | 'historial'

/** Columnas ordenables de la tabla principal — mismos 7 alias que expone
 *  `_TRIP_SELECT` en el backend (trips.py), único allow-list real del
 *  `ORDER BY` server-side (2026-08-02). */
export type SortKey =
  | 'planning_date' | 'tractor_plate' | 'driver_name' | 'carrier_name'
  | 'client_name' | 'current_status' | 'source_system_trip_id'
  | 'status_reported_at'

export interface DiarioFilters {
  tab:            Tab
  q:              string
  fechaDesde:     string
  fechaHasta:     string
  /** 'default:id' o 'custom:id' */
  activeGroup:    string | null
  /** Unifica las 6 alertas KPI (OR entre sí) + los 4 flags operativos (AND
   *  entre sí) en un solo array — un único mecanismo de toggle sin importar
   *  el tipo de señal (Ronda 26, escalabilidad de filtros). */
  activeSignals:  AlertSignalId[]
  fTms:           string[]
  /** Clasificación RM/Zona Cero (public.locations.operation_type) — reemplaza
   *  el filtro de región/ciudad de origen (Fase 2, Plan 7). Filtra por las
   *  paradas DESTINATION del viaje, no por el origen (swap 2026-08-02, ítem
   *  12 de la minuta: los orígenes son casi siempre CD propios, sin
   *  clasificación posible; los destinos sí son locales de cliente
   *  catalogados, 94% de cobertura real). Client-side: TripStop.operation_type
   *  ya viene resuelto en cada Trip de GET /trips, no hace falta ningún query
   *  param nuevo. */
  fOperationType: string[]
  /** Cliente (shipper) — server-side, mismo parámetro `client` que ya
   *  soportaba el backend, ahora como lista (2026-08-02). */
  fClient:        string[]
  /** Tipo de carga (ej. FRIO/CONGELADO) — server-side, parámetro `cargo_type`. */
  fCargoType:     string[]
  /** Local de origen del viaje — server-side, parámetro `origin` (EXISTS
   *  contra app.trip_stops, ver trips.py). Elegido vía autocomplete
   *  (volumen de locales no escala como multi-select estático). */
  fOrigin:        string[]
  /** "No asignado por WebCarga" — server-side, parámetro `no_asignado_webcarga`
   *  (Task 8, plan 2026-08-18-cierre-paso-viajes). Pablo: "voy a poder ver
   *  todos los viajes que alguna vez nos ofrecieron y no asignamos". No mira
   *  is_active, así que vive junto al rango de fechas del historial. */
  fNoAsignadoWebcarga: boolean
  sortKey:        SortKey | null
  sortDir:        'asc' | 'desc'
  page:           number
}

export type DiarioFiltersAction =
  /** Cualquier cambio de filtro resetea page a 1, salvo que el patch traiga page explícito */
  | { type: 'patch'; patch: Partial<DiarioFilters> }
  | { type: 'toggleGroup'; key: string }
  | { type: 'toggleSignal'; id: AlertSignalId }
  | { type: 'toggleTms'; id: string }
  | { type: 'toggleOperationType'; id: string }
  | { type: 'toggleClient'; id: string }
  | { type: 'toggleCargoType'; id: string }
  | { type: 'toggleOrigin'; id: string }
  /** Mismo ciclo de 3 estados que ya tenía TripTable.tsx localmente: sin
   *  sort → asc → desc → sin sort — ahora dispara un fetch real al backend
   *  en vez de reordenar en memoria solo la página cargada. */
  | { type: 'toggleSort'; col: SortKey }
  | { type: 'clear' }

function reducer(state: DiarioFilters, action: DiarioFiltersAction): DiarioFilters {
  switch (action.type) {
    case 'patch':
      return { ...state, page: 1, ...action.patch }
    case 'toggleGroup':
      return { ...state, page: 1, activeGroup: state.activeGroup === action.key ? null : action.key }
    case 'toggleSignal':
      return {
        ...state,
        page: 1,
        activeSignals: state.activeSignals.includes(action.id)
          ? state.activeSignals.filter(s => s !== action.id)
          : [...state.activeSignals, action.id],
      }
    case 'toggleTms':
      return {
        ...state,
        page: 1,
        fTms: state.fTms.includes(action.id)
          ? state.fTms.filter(t => t !== action.id)
          : [...state.fTms, action.id],
      }
    case 'toggleOperationType':
      return {
        ...state,
        page: 1,
        fOperationType: state.fOperationType.includes(action.id)
          ? state.fOperationType.filter(t => t !== action.id)
          : [...state.fOperationType, action.id],
      }
    case 'toggleClient':
      return {
        ...state,
        page: 1,
        fClient: state.fClient.includes(action.id)
          ? state.fClient.filter(c => c !== action.id)
          : [...state.fClient, action.id],
      }
    case 'toggleCargoType':
      return {
        ...state,
        page: 1,
        fCargoType: state.fCargoType.includes(action.id)
          ? state.fCargoType.filter(c => c !== action.id)
          : [...state.fCargoType, action.id],
      }
    case 'toggleOrigin':
      return {
        ...state,
        page: 1,
        fOrigin: state.fOrigin.includes(action.id)
          ? state.fOrigin.filter(o => o !== action.id)
          : [...state.fOrigin, action.id],
      }
    case 'toggleSort':
      if (state.sortKey !== action.col) return { ...state, page: 1, sortKey: action.col, sortDir: 'asc' }
      if (state.sortDir === 'asc') return { ...state, page: 1, sortDir: 'desc' }
      return { ...state, page: 1, sortKey: null, sortDir: 'asc' }
    case 'clear':
      return {
        ...state,
        q: '', fechaDesde: '', fechaHasta: '', activeGroup: null,
        activeSignals: [], fTms: [], fOperationType: [],
        fClient: [], fCargoType: [], fOrigin: [], fNoAsignadoWebcarga: false, page: 1,
      }
  }
}

export function countActiveFilters(f: DiarioFilters): number {
  return [
    f.q, f.fechaDesde, f.fechaHasta, f.activeGroup,
  ].filter(v => v !== '' && v !== null).length
    + f.fTms.length + f.activeSignals.length + f.fOperationType.length
    + f.fClient.length + f.fCargoType.length + f.fOrigin.length
    + (f.fNoAsignadoWebcarga ? 1 : 0)
}

/** Filtros que viven dentro del popover "Filtros" (para su badge contador).
 *  Bug 5.2: Estado (activeGroup) se movió acá adentro; Cliente (fClient)
 *  salió — ahora vive en la barra principal. */
export function countPopoverFilters(f: DiarioFilters): number {
  return [
    f.fechaDesde, f.fechaHasta, f.activeGroup,
  ].filter(v => v !== '' && v !== null).length
    + f.fTms.length + f.fOperationType.length
    + f.fCargoType.length + f.fOrigin.length
    + (f.fNoAsignadoWebcarga ? 1 : 0)
}

export function useDiarioFilters() {
  return useReducer(reducer, {
    tab: 'en_curso', q: '', fechaDesde: '', fechaHasta: '',
    activeGroup: null, activeSignals: [], fTms: [], fOperationType: [],
    fClient: [], fCargoType: [], fOrigin: [], fNoAsignadoWebcarga: false,
    // sortKey null → page.tsx defaultea a status_reported_at (bug 5.6:
    // viaje más recientemente reportado por el TMS primero), sortDir desc
    // acompaña ese default — "más reciente arriba", no "más viejo arriba".
    sortKey: null, sortDir: 'desc', page: 1,
  } satisfies DiarioFilters)
}
