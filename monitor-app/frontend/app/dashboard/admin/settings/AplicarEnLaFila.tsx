'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'

/** "Ver qué cambia" y "Aplicar", en la fila que se acaba de editar.
 *
 *  ES LO QUE NO SE PIERDE al mover las reglas a las celdas. Guardar la regla y
 *  aplicarla son dos actos distintos, y esa separación es lo único que impide
 *  que tocar un interruptor en una tabla siembre hasta 124 registros sin que
 *  nadie vea el número.
 *
 *  Aparece SÓLO en las filas cuya regla se cambió en esta sesión. No es una
 *  limitación disfrazada: preguntarle a las 37 filas si tienen algo pendiente
 *  serían 37 consultas, y la vista previa siempre estuvo disponible a pedido —
 *  esto la ofrece justo cuando acaba de volverse interesante. */
export function AplicarEnLaFila({ requirementId, nombre, onAplicado }: {
  requirementId: string
  nombre: string
  onAplicado: () => void
}) {
  const qc = useQueryClient()
  const [viendo, setViendo] = useState(false)

  const preview = useQuery({
    queryKey: ['recalc-preview', requirementId],
    queryFn: () => requirementsApi.recalcPreview(requirementId),
    enabled: viendo,
  })

  const aplicar = useMutation({
    mutationFn: () => requirementsApi.recalc(requirementId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-requirements'] })
      qc.invalidateQueries({ queryKey: ['recalc-preview', requirementId] })
      onAplicado()
    },
  })

  if (!viendo) {
    return (
      <button
        type="button"
        onClick={() => setViendo(true)}
        className="text-etiqueta font-semibold text-accion hover:opacity-70
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
      >
        Ver qué cambia
      </button>
    )
  }

  if (preview.isPending) {
    return <Loader2 size={12} className="animate-spin text-informativo" aria-label="Calculando" />
  }

  if (preview.isError) {
    return <span className="text-etiqueta text-status-incidente">No se pudo calcular</span>
  }

  const { crear, quitar, bloqueados } = preview.data!
  const sinCambios = crear === 0 && quitar === 0

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-etiqueta text-informativo tabular-nums">
        {sinCambios
          ? 'No cambia nada'
          : `Se agregan ${crear} · se quitan ${quitar}`}
        {/* Los bloqueados se dicen aparte: son los que NO se van a quitar
            porque ya tienen documento cargado, y callarlos haría que el
            número de arriba prometa más de lo que va a pasar. */}
        {bloqueados > 0 && ` · ${bloqueados} con documento, no se tocan`}
      </span>
      {!sinCambios && (
        <button
          type="button"
          onClick={() => aplicar.mutate()}
          disabled={aplicar.isPending}
          aria-label={`Aplicar los cambios de ${nombre}`}
          className="inline-flex items-center gap-1 rounded bg-accion px-2 py-0.5 text-etiqueta
                     font-semibold text-white disabled:opacity-50 focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {aplicar.isPending && <Loader2 size={10} className="animate-spin" />}
          Aplicar
        </button>
      )}
      {aplicar.isError && (
        <span className="text-etiqueta text-status-incidente">No se pudo aplicar</span>
      )}
    </div>
  )
}
