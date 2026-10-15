'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, UserX } from 'lucide-react'
import { assetsApi, type AssetPatchBody, type AssetType } from '@/lib/api/assets'
import { taxonomiesApi } from '@/lib/api/config'
import { taxonomyKey } from '@/lib/queries/taxonomies'
import { directoryKeys, invalidateDirectory } from '@/lib/queries/directorio'
import { useAssetTypes } from '@/hooks/useAssetTypes'
import type { Asset } from '@/lib/types'

const LABEL = 'text-etiqueta font-semibold text-informativo'
const INPUT = 'w-full rounded-lg border border-border bg-white px-3 py-1.5 text-dato focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60'

/** Editar los datos de un equipo, en el bloque Detalles de su ficha. Movido del
 *  panel de equipo (Entrega 1 de fichas, 15/10): tipo, año, tipo de operación y
 *  conductor habitual. El borrador sale de `asset` al montarse, y el bloque lo
 *  monta cada vez que se abre. */
export function AssetEditForm({ asset, carrierId, drivers, onSave, onClose }: {
  asset: Asset
  carrierId: string | null
  /** Los conductores de su empresa: de ahí sale el conductor habitual. */
  drivers: { id: string; full_name: string; operational_status: string }[]
  onSave: (body: AssetPatchBody) => Promise<void>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { types: assetTypes } = useAssetTypes()
  const [draft, setDraft] = useState<{ asset_type: AssetType; manufacture_year: string; webcarga_operation_type_id: string }>({
    asset_type: asset.asset_type,
    manufacture_year: asset.manufacture_year ? String(asset.manufacture_year) : '',
    webcarga_operation_type_id: asset.webcarga_operation_type_id ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [driverPick, setDriverPick] = useState('')
  const [assigningDriver, setAssigningDriver] = useState(false)

  const gestionesQuery = useQuery({
    queryKey: taxonomyKey('WEBCARGA_OPERATION_TYPE'),
    queryFn: () => taxonomiesApi.list('WEBCARGA_OPERATION_TYPE'),
    staleTime: 5 * 60_000,
  })
  const driverAssignmentQuery = useQuery({
    queryKey: directoryKeys.assetDriverAssignment(asset.id),
    queryFn: () => assetsApi.getDriverAssignment(asset.id),
  })

  // El valor actual siempre es una opción, aunque el catálogo todavía no haya
  // llegado o la fila se haya desactivado en Configuración: un <select> cuyo
  // value no está entre sus options se dibuja vacío, y un tracto clasificado
  // se vería "Sin clasificar" con el aviso de que bloquea el cierre debajo.
  const gestiones = (() => {
    const catalogo = gestionesQuery.data ?? []
    const actual = draft.webcarga_operation_type_id
    if (!actual || catalogo.some(g => g.id === actual)) return catalogo
    return [{ id: actual, label: asset.webcarga_operation_type_label ?? 'Tipo actual' }, ...catalogo]
  })()

  async function save() {
    setSaving(true); setErr(null)
    try {
      await onSave({
        asset_type: draft.asset_type,
        manufacture_year: draft.manufacture_year ? Number(draft.manufacture_year) : undefined,
        // "Sin clasificar" elegido sobre un equipo que tenía tipo lo quita (null,
        // D3); vacío sobre vacío no manda nada.
        webcarga_operation_type_id: draft.webcarga_operation_type_id || (asset.webcarga_operation_type_id ? null : undefined),
      })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function changeDriver(action: () => Promise<unknown>) {
    setAssigningDriver(true); setErr(null)
    try {
      await action()
      await invalidateDirectory(queryClient, { entity: 'asset', id: asset.id, type: 'assignment', carrierIds: [carrierId] })
      setDriverPick('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo cambiar el conductor habitual.')
    } finally {
      setAssigningDriver(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className={LABEL}>Tipo de equipo</span>
          <select aria-label="Tipo de equipo" value={draft.asset_type}
                  onChange={e => setDraft(d => ({ ...d, asset_type: e.target.value as AssetType }))} className={INPUT}>
            {assetTypes.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Año</span>
          <input type="number" aria-label="Año del vehículo" min={1950} max={2100} placeholder="—"
                 value={draft.manufacture_year}
                 onChange={e => setDraft(d => ({ ...d, manufacture_year: e.target.value }))} className={INPUT} />
        </label>
      </div>
      <div className="space-y-1">
        <label htmlFor="tipo-operacion" className={LABEL}>Tipo de operación</label>
        <select id="tipo-operacion" aria-label="Tipo de operación" value={draft.webcarga_operation_type_id}
                onChange={e => setDraft(d => ({ ...d, webcarga_operation_type_id: e.target.value }))} className={INPUT}>
          <option value="">Sin clasificar</option>
          {gestiones.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        {/* Sólo cuando ya sabemos que está sin clasificar: mientras el catálogo
            viaja, afirmar que bloquea el cierre sería mentir. */}
        {!draft.webcarga_operation_type_id && !gestionesQuery.isLoading && (
          <p className="text-etiqueta text-status-incidente">
            Sin esto el equipo cuenta como Tractoreo y bloquea el cierre del día hasta que alguien le ponga un motivo.
          </p>
        )}
      </div>

      {/* Conductor habitual (hardening del Diario, 18/07): el Monitor lo usa
          para resolver el conductor de los viajes nuevos de esta patente. Se
          guarda al elegirlo, no con "Guardar". */}
      <div className="space-y-1">
        <span className={LABEL}>Conductor habitual</span>
        {driverAssignmentQuery.isPending ? (
          <p className="text-dato text-informativo">Cargando…</p>
        ) : driverAssignmentQuery.data ? (
          <div className="flex items-center gap-2 text-dato">
            <span className="truncate">{driverAssignmentQuery.data.driver_name}</span>
            <button type="button" aria-label="Quitar conductor habitual" disabled={assigningDriver}
                    onClick={() => changeDriver(() => assetsApi.unassignDriver(asset.id))}
                    className="text-informativo hover:text-status-incidente disabled:opacity-50">
              {assigningDriver ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <UserX size={13} aria-hidden="true" />}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select aria-label="Asignar conductor habitual" value={driverPick}
                    onChange={e => setDriverPick(e.target.value)} className={INPUT}>
              <option value="">Sin asignar</option>
              {/* Solo los activos: la API rechaza a uno dado de baja (409). */}
              {drivers.filter(d => d.operational_status === 'ACTIVE').map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
            <button type="button" disabled={!driverPick || assigningDriver}
                    onClick={() => changeDriver(() => assetsApi.assignDriver(asset.id, driverPick))}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-dato font-medium text-accion disabled:opacity-50">
              Asignar
            </button>
          </div>
        )}
      </div>

      {err && <p role="alert" className="text-etiqueta text-status-incidente">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
          Guardar
        </button>
        <button type="button" onClick={onClose} disabled={saving}
                className="rounded-lg border border-border px-3 py-1.5 text-dato text-text-primary hover:bg-bg-main disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  )
}
