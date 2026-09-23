'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'
import { CLAVES_AFECTADAS, mensajeDeRechazo } from '@/hooks/useEliminarViajes'

interface Props {
  trip:        Trip
  /** Después de eliminar: el detalle de un viaje que ya no existe se cierra. */
  onEliminado: () => void
}

/** Eliminar un viaje manual desde su detalle.
 *
 *  Confirma en el mismo lugar, como la barra de selección del Monitor: el
 *  botón se convierte en "¿Eliminar? Sí / Cancelar". Sólo aparece si el
 *  backend dice que quien mira puede (`can_delete`). */
export function EliminarViaje({ trip, onEliminado }: Props) {
  const queryClient = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!trip.can_delete) return null

  async function eliminar() {
    setOcupado(true)
    setError(null)
    try {
      await tripsApi.remove(trip.id)
      // Primero se cierra el detalle y se olvida su caché: refrescar el
      // detalle de un viaje que ya no existe sólo produciría un 404.
      onEliminado()
      queryClient.removeQueries({ queryKey: ['trip', trip.id] })
      await Promise.all(CLAVES_AFECTADAS.map(queryKey => queryClient.invalidateQueries({ queryKey })))
    } catch (e) {
      setError(mensajeDeRechazo(e))
      setConfirmando(false)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <span className="flex items-center gap-2 shrink-0">
      {error && <span role="alert" className="text-etiqueta text-white bg-status-incidente rounded px-1.5 py-0.5 max-w-[260px] truncate" title={error}>{error}</span>}
      {confirmando ? (
        <>
          <span className="text-etiqueta text-white/70">Se elimina con sus paradas y notas</span>
          <button
            type="button"
            disabled={ocupado}
            onClick={eliminar}
            className="flex items-center gap-1 text-etiqueta font-bold bg-status-incidente hover:bg-status-incidente/90 disabled:opacity-60 text-white rounded px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {ocupado && <Loader2 size={11} className="animate-spin" />}
            Sí, eliminar
          </button>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => setConfirmando(false)}
            className="text-etiqueta font-semibold text-white/60 hover:text-white transition-colors"
          >
            Cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="flex items-center gap-1.5 text-etiqueta font-semibold text-white/60 hover:text-white transition-colors rounded px-1.5 py-1 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
        >
          <Trash2 size={12} /> Eliminar viaje
        </button>
      )}
    </span>
  )
}
