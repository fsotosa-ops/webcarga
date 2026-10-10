import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tripsApi } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import type { Trip } from '@/lib/types'
import type { EleccionDeMotivo } from '@/hooks/useMotivosDeAnulacion'

/** Tras anular o revertir, lo que puede haber cambiado: el listado, el detalle
 *  (la insignia "Anulado") y el cierre del día (un viaje menos cuenta distinto, y
 *  en un día firmado aparece como ajuste). */
export const CLAVES_AFECTADAS = [['trips'], ['trip'], ['cierre-viajes'], ['daily-closure'], ['equipment-closures']]

/** El motivo por viaje, cuando el backend rechaza el lote entero. */
export function mensajeDeRechazo(e: unknown): string {
  if (!(e instanceof Error)) return 'No se pudo anular'
  const errores = e instanceof ApiError
    ? (e.detail as { errors?: { error: string }[] } | undefined)?.errors
    : undefined
  if (!errores?.length) return e.message
  const motivos = [...new Set(errores.map(x => x.error))]
  return `${e.message}: ${motivos.join(' · ')}`
}

/** Selección y anulación con motivo de viajes manuales del Monitor.
 *
 *  Sólo se pueden marcar viajes con `can_void` (la regla la decide el
 *  backend). Si un viaje marcado deja de estar a la vista —cambió el filtro o
 *  la página— se desmarca: anular algo que ya no se ve es justo el error
 *  que la barra existe para evitar. */
export function useAnularViajes(visibles: Trip[]) {
  const queryClient = useQueryClient()
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const anulables = useMemo(() => visibles.filter(t => t.can_void).map(t => t.id), [visibles])

  useEffect(() => {
    const vigentes = new Set(anulables)
    setIds(prev => {
      const quedan = [...prev].filter(id => vigentes.has(id))
      return quedan.length === prev.size ? prev : new Set(quedan)
    })
  }, [anulables])

  function onToggle(id: string) {
    setIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onToggleAll() {
    setIds(prev => (anulables.every(id => prev.has(id)) ? new Set() : new Set(anulables)))
  }

  async function anular(tripIds: string[], eleccion: EleccionDeMotivo): Promise<boolean> {
    setOcupado(true)
    setError(null)
    try {
      await tripsApi.voidTrips(tripIds, eleccion.motivoId, eleccion.nota.trim() || undefined)
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
    hayAnulables: anulables.length > 0,
    limpiar: () => setIds(new Set()),
    anularSeleccion: (eleccion: EleccionDeMotivo) => anular([...ids], eleccion),
    anular,
    ocupado,
    error,
    limpiarError: () => setError(null),
  }
}
