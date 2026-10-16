'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tablePreferencesApi } from '@/lib/api/tablePreferences'
import type { ColumnPrefs } from './useDataTable'

export type TablePreferences = {
  columns: ColumnPrefs | null
  save: (columns: ColumnPrefs) => void
  reset: () => void
  ready?: boolean
}

/** Qué columnas ve cada persona y en qué orden (spec §4.3). Guardar se ve al
 *  instante (se escribe en la caché antes de que vuelva la API): mover una columna
 *  no puede esperar la red. Si la API falla, se vuelve a leer lo guardado. */
export function useTablePreferences(tableKey: string): TablePreferences {
  const qc = useQueryClient()
  const key = ['table-preferences', tableKey]
  const q = useQuery({ queryKey: key, queryFn: () => tablePreferencesApi.get(tableKey), staleTime: Infinity })
  const save = useMutation({
    mutationFn: (columns: ColumnPrefs) => tablePreferencesApi.save(tableKey, columns),
    onMutate: columns => { qc.setQueryData(key, columns) },
    onError: () => { qc.invalidateQueries({ queryKey: key }) },
  })
  const reset = useMutation({
    mutationFn: () => tablePreferencesApi.reset(tableKey),
    onMutate: () => { qc.setQueryData(key, null) },
    onError: () => { qc.invalidateQueries({ queryKey: key }) },
  })
  return {
    columns: q.data ?? null,
    save: columns => save.mutate(columns),
    reset: () => reset.mutate(),
    ready: !q.isPending,
  }
}
