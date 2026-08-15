'use client'

import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { CarrierSearchPicker } from '@/components/dashboard/CarrierSearchPicker'
import { cuantos } from '@/lib/utils/cuantos'

interface Props {
  targetIds:        string[]
  /** Empresa actual, sólo para excluirla del selector de destino. `null`
   *  cuando los archivos todavía no tienen empresa —lo normal en la bandeja
   *  global—: ahí no hay nada que excluir y se ofrecen todas. */
  currentCarrierId: string | null
  /** Recibe cuántos se movieron. Refrescar la bandeja es responsabilidad del
   *  Workbench, que tiene la lista completa de claves que quedan obsoletas. */
  onMoved:          (moved: number) => void
}

/** Corrige el error más probable del uso real: soltar cuarenta archivos en la
 *  empresa equivocada y darse cuenta al verlos.
 *
 *  Sólo mueve archivos SIN clasificar — no toca compliance_records, porque
 *  todavía no están aplicados a ningún requisito. */
export function MoveToCarrierBar({ targetIds, currentCarrierId, onMoved }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!targetIds.length) return null

  async function move(carrierId: string) {
    setError(null)
    try {
      const res = await documentIngestApi.moveItems(targetIds, carrierId)
      setOpen(false)
      setQuery('')
      // El refresco lo hace el Workbench en `onMoved`, con la MISMA lista de
      // claves que usan subir, clasificar, descartar y deshacer. Acá vivía un
      // conjunto propio de dos claves, que es justo el patrón que dejaba a
      // unas superficies contradiciendo a otras.
      onMoved(res.moved)
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
        Mover {cuantos(targetIds.length)} a otra empresa
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      <CarrierSearchPicker
        query={query}
        onQueryChange={setQuery}
        onPick={c => move(c.id)}
        excludeId={currentCarrierId ?? undefined}
        placeholder="Buscar empresa…"
        size="sm"
        autoFocus
      />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null) }}
        className="text-[10px] text-gray-500 hover:text-gray-600"
      >
        Cancelar
      </button>
    </div>
  )
}
