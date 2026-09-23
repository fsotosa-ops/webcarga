import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tripsApi } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import type { Trip } from '@/lib/types'

/** Tras eliminar, lo que puede haber cambiado: el listado, y el cierre de un
 *  día abierto (un viaje menos cuenta distinto). */
export const CLAVES_AFECTADAS = [['trips'], ['cierre-viajes'], ['daily-closure'], ['equipment-closures']]

/** El motivo por viaje, cuando el backend rechaza el lote entero. */
export function mensajeDeRechazo(e: unknown): string {
  if (!(e instanceof Error)) return 'No se pudo eliminar'
  const errores = e instanceof ApiError
    ? (e.detail as { errors?: { error: string }[] } | undefined)?.errors
    : undefined
  if (!errores?.length) return e.message
  const motivos = [...new Set(errores.map(x => x.error))]
  return `${e.message}: ${motivos.join(' · ')}`
}

/** Selección y eliminación de viajes manuales del Monitor.
 *
 *  Sólo se pueden marcar viajes con `can_delete` (la regla la decide el
 *  backend). Si un viaje marcado deja de estar a la vista —cambió el filtro o
 *  la página— se desmarca: eliminar algo que ya no se ve es justo el error
 *  que la barra existe para evitar. */
export function useEliminarViajes(visibles: Trip[]) {
  const queryClient = useQueryClient()
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eliminables = useMemo(() => visibles.filter(t => t.can_delete).map(t => t.id), [visibles])

  useEffect(() => {
    const vigentes = new Set(eliminables)
    setIds(prev => {
      const quedan = [...prev].filter(id => vigentes.has(id))
      return quedan.length === prev.size ? prev : new Set(quedan)
    })
  }, [eliminables])

  function onToggle(id: string) {
    setIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onToggleAll() {
    setIds(prev => (eliminables.every(id => prev.has(id)) ? new Set() : new Set(eliminables)))
  }

  async function eliminar(tripIds: string[]): Promise<boolean> {
    setOcupado(true)
    setError(null)
    try {
      await tripsApi.bulkRemove(tripIds)
      setIds(prev => new Set([...prev].filter(id => !tripIds.includes(id))))
      await Promise.all(CLAVES_AFECTADAS.map(queryKey => queryClient.invalidateQueries({ queryKey })))
      return true
    } catch (e) {
      setError(mensajeDeRechazo(e))
      return false
    } finally {
      setOcupado(false)
    }
  }

  return {
    seleccion: { ids, onToggle, onToggleAll },
    hayEliminables: eliminables.length > 0,
    limpiar: () => setIds(new Set()),
    eliminarSeleccion: () => eliminar([...ids]),
    eliminar,
    ocupado,
    error,
    limpiarError: () => setError(null),
  }
}
