'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { CarrierSearchPicker } from '@/components/dashboard/CarrierSearchPicker'

interface Props {
  targetIds:        string[]
  currentCarrierId: string
  onMoved:          () => void
}

/** Corrige el error más probable del uso real: soltar cuarenta archivos en la
 *  empresa equivocada y darse cuenta al verlos.
 *
 *  Sólo mueve archivos SIN clasificar — no toca compliance_records, porque
 *  todavía no están aplicados a ningún requisito. */
export function MoveToCarrierBar({ targetIds, currentCarrierId, onMoved }: Props) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!targetIds.length) return null

  async function move(carrierId: string) {
    setError(null)
    try {
      await documentIngestApi.moveItems(targetIds, carrierId)
      setOpen(false)
      setQuery('')
      // Por prefijo: la cola se cachea como ['ingest-queue', <empresa|'all'>] y
      // un movimiento cambia el grupo de origen Y el de destino. Invalidar
      // claves puntuales dejaba la lista stale — se vio en el click-through.
      qc.invalidateQueries({ queryKey: ['ingest-queue'] })
      qc.invalidateQueries({ queryKey: ['ingest-queue-count'] })
      onMoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo mover')
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 hover:text-accent transition-colors"
      >
        <ArrowRightLeft size={11} />
        Mover {targetIds.length} a otra empresa
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      <CarrierSearchPicker
        query={query}
        onQueryChange={setQuery}
        onPick={c => move(c.id)}
        excludeId={currentCarrierId}
        placeholder="Buscar empresa…"
        size="sm"
        autoFocus
      />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null) }}
        className="text-[10px] text-gray-400 hover:text-gray-600"
      >
        Cancelar
      </button>
    </div>
  )
}
