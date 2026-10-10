'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Loader2, Undo2 } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'
import { CLAVES_AFECTADAS, mensajeDeRechazo } from '@/hooks/useAnularViajes'

interface Props {
  trip:     Trip
  /** Después de anular o revertir, además de refrescar el listado y el detalle
   *  (CLAVES_AFECTADAS). */
  onCambio?: () => void
}

/** Anular un viaje manual con motivo, o deshacer la anulación, desde su detalle.
 *
 *  Confirma en el mismo lugar, como la barra de selección del Monitor. El viaje no
 *  se borra: queda con quién, cuándo y por qué. Sólo aparece si el backend dice que
 *  quien mira puede (`can_void` / `can_revert_void`). */
export function AnularViaje({ trip, onCambio }: Props) {
  const queryClient = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!trip.can_void && !trip.can_revert_void) return null

  async function correr(accion: () => Promise<unknown>) {
    setOcupado(true)
    setError(null)
    try {
      await accion()
      setConfirmando(false)
      setMotivo('')
      await Promise.all(CLAVES_AFECTADAS.map(queryKey => queryClient.invalidateQueries({ queryKey })))
      onCambio?.()
    } catch (e) {
      setError(mensajeDeRechazo(e))
    } finally {
      setOcupado(false)
    }
  }

  const boton = 'flex items-center gap-1.5 text-etiqueta font-semibold text-white/60 hover:text-white transition-colors rounded px-1.5 py-1 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40'

  return (
    <span className="flex items-center gap-2 shrink-0">
      {error && <span role="alert" className="text-etiqueta text-white bg-status-incidente rounded px-1.5 py-0.5 max-w-[260px] truncate" title={error}>{error}</span>}
      {trip.can_revert_void ? (
        <button type="button" disabled={ocupado} onClick={() => correr(() => tripsApi.revertVoid([trip.id]))} className={boton}>
          {ocupado ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Deshacer anulación
        </button>
      ) : confirmando ? (
        <>
          <label className="flex items-center gap-1.5 text-etiqueta text-white/70">
            Motivo
            <input
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              autoFocus
              className="rounded bg-white/10 px-2 py-1 text-etiqueta text-white focus:outline-none focus:ring-2 focus:ring-white/40"
            />
          </label>
          <button
            type="button"
            disabled={ocupado || !motivo.trim()}
            onClick={() => correr(() => tripsApi.voidTrips([trip.id], motivo.trim()))}
            className="flex items-center gap-1 text-etiqueta font-bold bg-status-incidente hover:bg-status-incidente/90 disabled:opacity-60 text-white rounded px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {ocupado && <Loader2 size={11} className="animate-spin" />}
            Sí, anular
          </button>
          <button type="button" disabled={ocupado} onClick={() => setConfirmando(false)} className="text-etiqueta font-semibold text-white/60 hover:text-white transition-colors">
            Cancelar
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirmando(true)} className={boton}>
          <Ban size={12} /> Anular viaje
        </button>
      )}
    </span>
  )
}
