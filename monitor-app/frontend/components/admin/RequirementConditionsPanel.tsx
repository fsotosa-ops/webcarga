'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import { useCanEdit } from '@/hooks/useCanEdit'
import type { RequirementConditions } from '@/lib/types'

interface Props {
  requisito: RequirementConditions
  subtipos:  { id: string; label: string }[]
}

/** Configurar a quién se le exige un documento.
 *
 *  Guardar la regla y aplicarla son dos actos distintos, a propósito: cambiar
 *  una condición puede crear o quitar cientos de registros, y nadie debería
 *  descubrirlo después. Marcar/desmarcar un subtipo guarda la regla al
 *  toque (PATCH /conditions) — lo que queda pendiente de un acto aparte es
 *  APLICARLA sobre los registros existentes (POST /recalc), no guardarla. */
export function RequirementConditionsPanel({ requisito, subtipos }: Props) {
  const canEdit = useCanEdit()
  const qc = useQueryClient()
  const [marcados, setMarcados] = useState<string[]>(
    requisito.applies_to_fleet_service_type_ids ?? [])
  const [verPreview, setVerPreview] = useState(false)

  // Persiste la condición apenas cambia una marca. Sin esto, tildar un
  // subtipo no tendría ningún efecto real: la vista previa y el recálculo
  // leen la regla GUARDADA en la base, no lo que está tildado en pantalla.
  const guardar = useMutation({
    mutationFn: (ids: string[]) =>
      requirementsApi.patchConditions(requisito.id, { applies_to_fleet_service_type_ids: ids }),
  })

  const preview = useQuery({
    queryKey: ['recalc-preview', requisito.id, marcados],
    queryFn: () => requirementsApi.recalcPreview(requisito.id),
    enabled: verPreview,
  })

  const aplicar = useMutation({
    mutationFn: () => requirementsApi.recalc(requisito.id),
    onSuccess: () => {
      setVerPreview(false)
      qc.invalidateQueries({ queryKey: ['certification-status'] })
      qc.invalidateQueries({ queryKey: ['compliance-pending-drawer'] })
    },
  })

  function toggleSubtipo(id: string) {
    const next = marcados.includes(id) ? marcados.filter(x => x !== id) : [...marcados, id]
    setMarcados(next)
    setVerPreview(false)
    guardar.mutate(next)
  }

  const sinRestriccion = !marcados.length

  return (
    <div className="border border-border rounded-xl bg-white p-4 space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-semibold text-text-primary">{requisito.name}</span>
        {!requisito.is_active && (
          <span className="text-[10.5px] text-gray-500">no está vigente</span>
        )}
      </div>

      {requisito.target_entity === 'ASSET' && (
        <fieldset>
          <legend className="text-[11px] text-gray-500 pb-1">Se exige a estos vehículos</legend>
          <div className="flex flex-wrap gap-3">
            {subtipos.map(t => (
              <label key={t.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={t.label}
                  disabled={!canEdit}
                  checked={marcados.includes(t.id)}
                  onChange={() => toggleSubtipo(t.id)}
                  className="accent-accent cursor-pointer"
                />
                {t.label}
              </label>
            ))}
          </div>
          {sinRestriccion && (
            <p className="text-[10.5px] text-gray-400 pt-1">
              Sin marcas: aplica a todos los vehículos.
            </p>
          )}
        </fieldset>
      )}

      {canEdit && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setVerPreview(true)}
            className="text-[11.5px] font-semibold text-accion hover:opacity-70 transition-opacity cursor-pointer"
          >
            Ver qué cambia
          </button>
          {verPreview && preview.data && (
            <button
              type="button"
              onClick={() => aplicar.mutate()}
              disabled={aplicar.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {aplicar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Aplicar
            </button>
          )}
        </div>
      )}

      {verPreview && preview.isPending && (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> Calculando…
        </p>
      )}

      {verPreview && preview.data && (
        <div className="rounded-lg border border-border bg-gray-50 px-3 py-2 text-[11.5px] space-y-1">
          <p>Se agregan {preview.data.crear} · <b>se quitan {preview.data.quitar}</b></p>
          {preview.data.bloqueados > 0 && (
            <p className="flex items-start gap-1.5 text-amber-700">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {preview.data.bloqueados} ya no corresponden según esta regla pero tienen documento
              cargado. No se tocan: hay que resolverlos de a uno.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
