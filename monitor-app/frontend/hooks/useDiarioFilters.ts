'use client'

import { useReducer } from 'react'
import type { KpiId } from '@/lib/utils/kpis'

export type Tab        = 'en_curso' | 'historial'
export type BoolFilter = boolean | null
export type FlagField  = 'fIsActive' | 'fIsWorking' | 'fIsAssigned' | 'fIsFirstLeg'

// Fase 3 del hardening del Diario (2026-07-18): antes vivía duplicado
// dentro de FilterPopover — ahora es la única fuente, usada tanto por los
// tiles de filtro sobre la tabla (page.tsx) como, si hiciera falta, por
// cualquier otro selector de estos 4 indicadores.
export const FLAGS: { label: string; field: FlagField }[] = [
  { label: 'Activo',     field: 'fIsActive'    },
  { label: 'Trabajando', field: 'fIsWorking'   },
  { label: 'Asignado',   field: 'fIsAssigned'  },
  { label: '1ra Vuelta', field: 'fIsFirstLeg'  },
]

export interface DiarioFilters {
  tab:            Tab
  fecha:          string
  q:              string
  fechaDesde:     string
  fechaHasta:     string
  /** 'default:id' o 'custom:id' */
  activeGroup:    string | null
  fIsActive:        BoolFilter
  fIsWorking:    BoolFilter
  fIsAssigned:      BoolFilter
  fIsFirstLeg: BoolFilter
  fTms:           string[]
  /** Ubicación de origen (dropdown región/ciudad de Chile) */
  fRegion:        string
  fCity:          string
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
        fIsActive: null, fIsWorking: null, fIsAssigned: null, fIsFirstLeg: null,
        fTms: [], fRegion: '', fCity: '', kpiFilter: null, page: 1,
      }
  }
}

export function countActiveFilters(f: DiarioFilters): number {
  return [
    f.q, f.fechaDesde, f.fechaHasta, f.activeGroup,
    f.fIsActive, f.fIsWorking, f.fIsAssigned, f.fIsFirstLeg,
    f.fRegion, f.fCity, f.kpiFilter,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length
}

/** Filtros que viven dentro del popover "Filtros" (para su badge contador) */
export function countPopoverFilters(f: DiarioFilters): number {
  return [
    f.fechaDesde, f.fechaHasta,
    f.fIsActive, f.fIsWorking, f.fIsAssigned, f.fIsFirstLeg,
    f.fRegion, f.fCity,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length
}

export function useDiarioFilters(initialFecha: string) {
  return useReducer(reducer, {
    tab: 'en_curso', fecha: initialFecha, q: '', fechaDesde: '', fechaHasta: '',
    activeGroup: null, fIsActive: null, fIsWorking: null, fIsAssigned: null,
    fIsFirstLeg: null, fTms: [], fRegion: '', fCity: '', kpiFilter: null, page: 1,
  } satisfies DiarioFilters)
}
