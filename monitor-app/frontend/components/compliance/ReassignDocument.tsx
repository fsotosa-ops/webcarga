'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Undo2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { PendingSlotPicker, type Slot } from './PendingSlotPicker'
import { clavesCertificacion } from '@/lib/queries/certificacion'

interface Props {
  /** El registro que hoy tiene el archivo mal puesto. */
  recordId:  string
  carrierId: string
  onDone:    () => void
}

/** HU-03 — corrige un documento cargado en el lugar equivocado.
 *
 *  Una sola superficie para las cuatro variantes de la HU: elegir otro hueco
 *  —de la misma entidad o de otra— o devolverlo a la bandeja. "A otra empresa"
 *  se compone: se devuelve a la bandeja y desde ahí se mueve, que es la
 *  operación que ya existe.
 *
 *  El archivo no se copia ni se borra: viaja la referencia. */
export function ReassignDocument({ recordId, carrierId, onDone }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pendientes = useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId),
    queryFn: () => complianceApi.listPending({ carrierId, limit: 200 }),
    enabled: abierto,
  })

  async function aplicar(body: Parameters<typeof complianceApi.reassign>[1]) {
    setGuardando(true)
    setError(null)
    try {
      await complianceApi.reassign(recordId, body)
      setAbierto(false)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reasignar')
    } finally {
      setGuardando(false)
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-[10px] font-semibold text-gray-500 hover:text-accent transition-colors cursor-pointer"
      >
        Reasignar
      </button>
    )
  }

  // Sin el registro que se está corrigiendo: reasignarlo a sí mismo no hace nada.
  const huecos = (pendientes.data?.rows ?? []).filter(r => r.id !== recordId)

  return (
    <div className="w-full mt-2 rounded-lg border border-border bg-gray-50 p-2.5 space-y-2">
      <p className="text-[11px] font-semibold text-slate-700">
        ¿A dónde va este documento?
      </p>

      {pendientes.isPending ? (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <Loader2 size={11} className="motion-safe:animate-spin" /> Cargando…
        </p>
      ) : (
        <PendingSlotPicker
          rows={huecos}
          selected={null}
          onPick={(s: Slot) => aplicar({
            target_entity_type:    s.entity_type,
            target_entity_id:      s.entity_id,
            target_requirement_id: s.requirement_id,
          })}
        />
      )}

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="flex items-center gap-3 pt-1 border-t border-border">
        {/* La cuarta variante, y también el camino para mandarlo a otra
            empresa: vuelve a la bandeja y desde ahí se mueve. */}
        <button
          type="button"
          disabled={guardando}
          onClick={() => aplicar({ to_tray: true })}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 hover:text-accent transition-colors disabled:opacity-50 cursor-pointer"
        >
          {guardando
            ? <Loader2 size={11} className="motion-safe:animate-spin" />
            : <Undo2 size={11} />}
          Devolver a sin clasificar
        </button>
        <button
          type="button"
          onClick={() => { setAbierto(false); setError(null) }}
          className="ml-auto text-[10px] text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
