'use client'

import { useReducer } from 'react'
import type { KpiId } from '@/lib/utils/kpis'

export type Tab        = 'en_curso' | 'historial'
export type BoolFilter = boolean | null
export type FlagField  = 'fActivo' | 'fTrabajando' | 'fAsignado' | 'fPrimeraVuelta'

export interface DiarioFilters {
  tab:            Tab
  fecha:          string
  q:              string
  fechaDesde:     string
  fechaHasta:     string
  /** 'default:id' o 'custom:id' */
  activeGroup:    string | null
  fActivo:        BoolFilter
  fTrabajando:    BoolFilter
  fAsignado:      BoolFilter
  fPrimeraVuelta: BoolFilter
  fTms:           string[]
  /** Filtro de excepción activo (KPI cards) — client-side sobre la data cargada */
  kpiFilter:      KpiId | null
  page:           number
}

export type DiarioFiltersAction =
  /** Cualquier cambio de filtro resetea page a 1, salvo que el patch traiga page explícito */
  | { type: 'patch'; patch: Partial<DiarioFilters> }
  | { type: 'toggleGroup'; key: string }
  | { type: 'toggleFlag'; field: FlagField }
  | { type: 'toggleTms'; id: string }
  | { type: 'toggleKpi'; kpi: KpiId }
  | { type: 'clear' }

function reducer(state: DiarioFilters, action: DiarioFiltersAction): DiarioFilters {
  switch (action.type) {
    case 'patch':
      return { ...state, page: 1, ...action.patch }
    case 'toggleGroup':
      return { ...state, page: 1, activeGroup: state.activeGroup === action.key ? null : action.key }
    case 'toggleFlag':
      return { ...state, page: 1, [action.field]: state[action.field] === true ? null : true }
    case 'toggleTms':
      return {
        ...state,
        page: 1,
        fTms: state.fTms.includes(action.id)
          ? state.fTms.filter(t => t !== action.id)
          : [...state.fTms, action.id],
      }
    case 'toggleKpi':
      return { ...state, page: 1, kpiFilter: state.kpiFilter === action.kpi ? null : action.kpi }
    case 'clear':
      return {
        ...state,
        q: '', fechaDesde: '', fechaHasta: '', activeGroup: null,
        fActivo: null, fTrabajando: null, fAsignado: null, fPrimeraVuelta: null,
        fTms: [], kpiFilter: null, page: 1,
      }
  }
}

export function countActiveFilters(f: DiarioFilters): number {
  return [
    f.q, f.fechaDesde, f.fechaHasta, f.activeGroup,
    f.fActivo, f.fTrabajando, f.fAsignado, f.fPrimeraVuelta,
    f.kpiFilter,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length
}

/** Filtros que viven dentro del popover "Filtros" (para su badge contador) */
export function countPopoverFilters(f: DiarioFilters): number {
  return [
    f.fechaDesde, f.fechaHasta,
    f.fActivo, f.fTrabajando, f.fAsignado, f.fPrimeraVuelta,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length
}

export function useDiarioFilters(initialFecha: string) {
  return useReducer(reducer, {
    tab: 'en_curso', fecha: initialFecha, q: '', fechaDesde: '', fechaHasta: '',
    activeGroup: null, fActivo: null, fTrabajando: null, fAsignado: null,
    fPrimeraVuelta: null, fTms: [], kpiFilter: null, page: 1,
  } satisfies DiarioFilters)
}
