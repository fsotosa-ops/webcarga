'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { useRowFeedback, SaveRowButton } from '@/app/dashboard/admin/configuracion/shared'
import type { RequirementConditions, RequirementConditionsPatchResult, ManagementType } from '@/lib/types'

interface Props {
  requisito: RequirementConditions
  subtipos:  { id: string; label: string }[]
  /** El padre (la pestaña que lista los requisitos) recibe la fila devuelta
   *  por el PATCH y la propaga de vuelta como prop nuevo — así este panel
   *  no necesita creer que lo que mandó ya quedó guardado, lo confirma
   *  contra el dato real. Sin este canal, "dirty" no tiene forma de
   *  apagarse después de un guardado exitoso. */
  onSaved?: (patch: RequirementConditionsPatchResult) => void
}

const GESTIONES: { id: ManagementType; label: string }[] = [
  { id: 'TRACTOREO',       label: 'Tractoreo' },
  { id: 'EQUIPO_COMPLETO', label: 'Equipo Completo' },
]

/** Comparación por conjunto: el orden en que se tildaron las casillas no es
 *  significativo, así que comparar por índice (como haría `===` sobre el
 *  array) daría falsos "sucio". */
function mismoConjunto(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every(x => setB.has(x))
}

/** Configurar a quién se le exige un documento.
 *
 *  Guardar la regla y aplicarla son dos actos distintos, a propósito: cambiar
 *  una condición puede crear o quitar cientos de registros, y nadie debería
 *  descubrirlo después. Pero guardar la regla es TAMBIÉN un acto explícito,
 *  no automático: los triggers de siembra (`reconcile_new_asset`,
 *  `reconcile_new_carrier`) leen `applies_to_*` en el instante del alta, sin
 *  caché — cada tilde que se autoguardara sería una regla a medio escribir,
 *  vigente hasta el próximo clic. Por eso este panel reusa el mismo patrón
 *  que sus seis pestañas hermanas (`estados-tabs.tsx`, `umbrales-tabs.tsx`):
 *  borrador local + botón "Guardar" explícito + error visible por fila. */
export function RequirementConditionsPanel({ requisito, subtipos, onSaved }: Props) {
  const canEdit = useCanAdmin()
  const qc = useQueryClient()
  const fb = useRowFeedback()

  const [marcadosSubtipos, setMarcadosSubtipos] = useState<string[]>(
    requisito.applies_to_fleet_service_type_ids ?? [])
  const [marcadosGestiones, setMarcadosGestiones] = useState<ManagementType[]>(
    requisito.applies_to_management_types ?? [])
  const [verPreview, setVerPreview] = useState(false)

  // Si el prop cambia -- ya sea porque el guardado de ESTE panel propagó la
  // fila nueva, o porque el padre recargó la lista ("Reintentar" en
  // LoadState) -- el borrador local tiene que resincronizarse. Sin esto la
  // pantalla sigue mostrando lo viejo con datos frescos abajo: la misma
  // clase de bug que ya apareció en ContactCard y TransporterDocumentsPanel.
  useEffect(() => {
    setMarcadosSubtipos(requisito.applies_to_fleet_service_type_ids ?? [])
    setMarcadosGestiones(requisito.applies_to_management_types ?? [])
  }, [requisito.id, requisito.applies_to_fleet_service_type_ids, requisito.applies_to_management_types])

  const esAsset   = requisito.target_entity === 'ASSET'
  const esCarrier = requisito.target_entity === 'CARRIER'
  const tieneCondicionEditable = esAsset || esCarrier

  const dirty = esAsset
    ? !mismoConjunto(marcadosSubtipos, requisito.applies_to_fleet_service_type_ids ?? [])
    : esCarrier
    ? !mismoConjunto(marcadosGestiones, requisito.applies_to_management_types ?? [])
    : false

  // GET /config/taxonomies filtra active=true: un subtipo dado de baja que
  // siga en la condición guardada no aparece como casilla, y la regla se
  // vería como "0 marcas" sin serlo. El ID sigue viajando en `marcados` (no
  // se pierde al togglear otro), pero sin esto nadie lo vería.
  const marcasOcultasSubtipos = marcadosSubtipos.filter(
    id => !subtipos.some(t => t.id === id)).length

  async function guardar() {
    await fb.run(requisito.id, async () => {
      const body = esAsset
        ? { applies_to_fleet_service_type_ids: marcadosSubtipos }
        : { applies_to_management_types: marcadosGestiones }
      const patch = await requirementsApi.patchConditions(requisito.id, body)
      onSaved?.(patch)
      qc.invalidateQueries({ queryKey: ['recalc-preview', requisito.id] })
    })
  }

  const preview = useQuery({
    queryKey: ['recalc-preview', requisito.id],
    queryFn: () => requirementsApi.recalcPreview(requisito.id),
    enabled: verPreview,
  })

  const aplicar = useMutation({
    mutationFn: () => requirementsApi.recalc(requisito.id),
    onSuccess: () => {
      setVerPreview(false)
      qc.invalidateQueries({ queryKey: ['recalc-preview', requisito.id] })
      qc.invalidateQueries({ queryKey: ['certification-status'] })
      qc.invalidateQueries({ queryKey: ['compliance-pending-drawer'] })
    },
  })

  function confirmarAplicar() {
    const crear = preview.data?.crear ?? 0
    const quitar = preview.data?.quitar ?? 0
    const ok = window.confirm(
      `¿Aplicar esta regla? Se van a crear ${crear} y quitar ${quitar} registros de cumplimiento. `
      + 'Esta acción no se puede deshacer.',
    )
    if (!ok) return
    aplicar.mutate()
  }

  return (
    <div className="border border-border rounded-xl bg-white p-4 space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-semibold text-text-primary">{requisito.name}</span>
        {!requisito.is_active && (
          <span className="text-[10.5px] text-gray-500">no está vigente</span>
        )}
      </div>

      {esAsset && (
        <fieldset>
          <legend className="text-[11px] text-gray-500 pb-1">Se exige a estos vehículos</legend>
          <div className="flex flex-wrap gap-3">
            {subtipos.map(t => (
              <label key={t.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={t.label}
                  disabled={!canEdit}
                  checked={marcadosSubtipos.includes(t.id)}
                  onChange={() => setMarcadosSubtipos(m =>
                    m.includes(t.id) ? m.filter(x => x !== t.id) : [...m, t.id])}
                  className="accent-accent cursor-pointer"
                />
                {t.label}
              </label>
            ))}
          </div>
          {!marcadosSubtipos.length && (
            <p className="text-[10.5px] text-gray-400 pt-1">
              Sin marcas: aplica a todos los vehículos.
            </p>
          )}
          {marcasOcultasSubtipos > 0 && (
            <p className="text-[10.5px] text-amber-700 pt-1" title="Corresponden a un subtipo de flota dado de baja">
              +{marcasOcultasSubtipos} marca{marcasOcultasSubtipos > 1 ? 's' : ''} de un subtipo dado de baja, no visible acá.
            </p>
          )}
        </fieldset>
      )}

      {esCarrier && (
        <fieldset>
          <legend className="text-[11px] text-gray-500 pb-1">Se exige a estos tipos de gestión</legend>
          <div className="flex flex-wrap gap-3">
            {GESTIONES.map(g => (
              <label key={g.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={g.label}
                  disabled={!canEdit}
                  checked={marcadosGestiones.includes(g.id)}
                  onChange={() => setMarcadosGestiones(m =>
                    m.includes(g.id) ? m.filter(x => x !== g.id) : [...m, g.id])}
                  className="accent-accent cursor-pointer"
                />
                {g.label}
              </label>
            ))}
          </div>
          {!marcadosGestiones.length && (
            <p className="text-[10.5px] text-gray-400 pt-1">
              Sin marcas: aplica a todos los tipos de gestión.
            </p>
          )}
        </fieldset>
      )}

      {!tieneCondicionEditable && (
        <p className="text-[11px] text-gray-500">Se exige a todos los conductores.</p>
      )}

      {canEdit && tieneCondicionEditable && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <SaveRowButton dirty={dirty} saving={fb.saving === requisito.id}
            saved={!!fb.savedAt[requisito.id]} onClick={guardar} />
          <button
            type="button"
            onClick={() => setVerPreview(true)}
            disabled={dirty || fb.saving === requisito.id}
            className="text-[11.5px] font-semibold text-accion hover:opacity-70 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
          >
            Ver qué cambia
          </button>
          {verPreview && preview.data && (
            <button
              type="button"
              onClick={confirmarAplicar}
              disabled={aplicar.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {aplicar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Aplicar
            </button>
          )}
        </div>
      )}

      {canEdit && tieneCondicionEditable && dirty && (
        <p className="text-[10.5px] text-gray-400">Guarda la regla antes de ver qué cambia.</p>
      )}
      {fb.errors[requisito.id] && (
        <p className="text-[10.5px] text-red-600">{fb.errors[requisito.id]}</p>
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
