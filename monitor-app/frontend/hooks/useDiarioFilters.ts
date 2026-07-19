'use client'

import { useReducer } from 'react'
import type { AlertSignalId } from '@/lib/utils/alertSignals'

export type Tab = 'en_curso' | 'historial'

export interface DiarioFilters {
  tab:            Tab
  fecha:          string
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
  /** Clasificación RM/Zona Cero del origen (public.locations.operation_type)
   *  — reemplaza el filtro de región/ciudad de origen (Fase 2, Plan 7).
   *  Client-side: origin_operation_type ya viene resuelto en cada Trip de
   *  GET /trips, no hace falta ningún query param nuevo. */
  fOperationType: string[]
  page:           number
}

export type DiarioFiltersAction =
  /** Cualquier cambio de filtro resetea page a 1, salvo que el patch traiga page explícito */
  | { type: 'patch'; patch: Partial<DiarioFilters> }
  | { type: 'toggleGroup'; key: string }
  | { type: 'toggleSignal'; id: AlertSignalId }
  | { type: 'toggleTms'; id: string }
  | { type: 'toggleOperationType'; id: string }
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
    case 'clear':
      return {
        ...state,
        q: '', fechaDesde: '', fechaHasta: '', activeGroup: null,
        activeSignals: [], fTms: [], fOperationType: [], page: 1,
      }
  }
}

export function countActiveFilters(f: DiarioFilters): number {
  return [
    f.q, f.fechaDesde, f.fechaHasta, f.activeGroup,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length + f.activeSignals.length + f.fOperationType.length
}

/** Filtros que viven dentro del popover "Filtros" (para su badge contador) */
export function countPopoverFilters(f: DiarioFilters): number {
  return [
    f.fechaDesde, f.fechaHasta,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length + f.fOperationType.length
}

export function useDiarioFilters(initialFecha: string) {
  return useReducer(reducer, {
    tab: 'en_curso', fecha: initialFecha, q: '', fechaDesde: '', fechaHasta: '',
    activeGroup: null, activeSignals: [], fTms: [], fOperationType: [], page: 1,
  } satisfies DiarioFilters)
}
