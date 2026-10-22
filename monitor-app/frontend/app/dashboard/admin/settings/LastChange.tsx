'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { changesApi } from '@/lib/api/config'

/** Desde cuándo hay registro de cambios en Configuración (puesta en marcha del
 *  registro, spec 2026-10-22 §3.3). Antes de esa fecha no hay historia: se dice. */
export const CHANGES_SINCE = '2026-10-22'

export interface LastChangeInfo { actorName: string | null; changedAt: string }

const diaDeChile = (iso: string) => new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date(iso)).replace(/-/g, '/')

/** El último cambio de cada elemento de una sección. */
export function useLastChanges(area: string, section: string) {
  const qc = useQueryClient()
  const key = useMemo(() => ['config-changes', area, section], [area, section])
  const q = useQuery({ queryKey: key, queryFn: () => changesApi.list(area, section) })
  const porElemento = useMemo(
    () => new Map((q.data ?? []).map(c => [c.element_id, { actorName: c.actor_name, changedAt: c.changed_at }])),
    [q.data])
  const of = useCallback((elementId: string): LastChangeInfo | undefined => porElemento.get(elementId), [porElemento])
  const invalidate = useCallback(() => { void qc.invalidateQueries({ queryKey: key }) }, [qc, key])
  return { of, isPending: q.isPending, invalidate }
}

/** "Última modificación: persona, fecha". Mientras carga no afirma nada. */
export function LastChange({ change, pending }: { change: LastChangeInfo | undefined; pending: boolean }) {
  if (pending) return null
  return (
    <p className="text-etiqueta text-informativo">
      {change
        ? `Última modificación: ${change.actorName ?? 'Sistema'}, ${diaDeChile(change.changedAt)}`
        : `Sin cambios registrados desde el ${diaDeChile(`${CHANGES_SINCE}T12:00:00-03:00`)}`}
    </p>
  )
}
