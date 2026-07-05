'use client'

import { useReducer } from 'react'

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
  fClient:        string
  page:           number
}

export type DiarioFiltersAction =
  /** Cualquier cambio de filtro resetea page a 1, salvo que el patch traiga page explícito */
  | { type: 'patch'; patch: Partial<DiarioFilters> }
  | { type: 'toggleGroup'; key: string }
  | { type: 'toggleFlag'; field: FlagField }
  | { type: 'toggleTms'; id: string }
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
    case 'clear':
      return {
        ...state,
        q: '', fechaDesde: '', fechaHasta: '', activeGroup: null,
        fActivo: null, fTrabajando: null, fAsignado: null, fPrimeraVuelta: null,
        fTms: [], fClient: '', page: 1,
      }
  }
}

export function countActiveFilters(f: DiarioFilters): number {
  return [
    f.q, f.fechaDesde, f.fechaHasta, f.activeGroup,
    f.fActivo, f.fTrabajando, f.fAsignado, f.fPrimeraVuelta,
    f.fClient,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length
}

export function useDiarioFilters(initialFecha: string) {
  return useReducer(reducer, {
    tab: 'en_curso', fecha: initialFecha, q: '', fechaDesde: '', fechaHasta: '',
    activeGroup: null, fActivo: null, fTrabajando: null, fAsignado: null,
    fPrimeraVuelta: null, fTms: [], fClient: '', page: 1,
  } satisfies DiarioFilters)
}
