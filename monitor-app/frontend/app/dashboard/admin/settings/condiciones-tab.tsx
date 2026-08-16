'use client'

import { useCallback } from 'react'
import { complianceApi } from '@/lib/api/compliance'
import { taxonomiesApi, type TaxonomyRow } from '@/lib/api/config'
import type { RequirementOption } from '@/lib/types'
import { RequirementConditionsPanel } from '@/components/admin/RequirementConditionsPanel'
import { LoadState, useConfigList } from './shared'

const ENTITY_LABEL: Record<RequirementOption['target_entity'], string> = {
  CARRIER: 'Empresas',
  DRIVER:  'Conductores',
  ASSET:   'Vehículos',
}

const GRUPOS: RequirementOption['target_entity'][] = ['CARRIER', 'DRIVER', 'ASSET']

export function CondicionesDocumentosTab() {
  const requisitosFetcher = useCallback(() => complianceApi.listRequirements(), [])
  const {
    items: requisitos, setItems: setRequisitos, loading: loadingReq, error: errorReq, reload: reloadReq,
  } = useConfigList<RequirementOption>(requisitosFetcher)

  const subtiposFetcher = useCallback(() => taxonomiesApi.list('FLEET_SERVICE_TYPE'), [])
  const {
    items: subtiposRaw, loading: loadingSub, error: errorSub, reload: reloadSub,
  } = useConfigList<TaxonomyRow>(subtiposFetcher)

  const loading = loadingReq || loadingSub
  const error = errorReq ?? errorSub
  const subtipos = subtiposRaw.map(t => ({ id: t.id, label: t.label }))

  return (
    <div className="p-4 md:p-5 space-y-5">
      <p className="text-xs text-gray-400">
        A quién se le exige cada documento del catálogo. Guarda la regla con el botón de cada
        tarjeta; aplicarla sobre los registros existentes es un paso aparte, con vista previa antes
        de confirmar.
      </p>
      <LoadState loading={loading} error={error} onRetry={() => { reloadReq(); reloadSub() }} />
      {!loading && !error && GRUPOS.map(entity => {
        const rows = requisitos.filter(r => r.target_entity === entity)
        if (!rows.length) return null
        return (
          <div key={entity} className="space-y-2">
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">
              {ENTITY_LABEL[entity]}
            </h2>
            <div className="space-y-2">
              {rows.map(r => (
                <RequirementConditionsPanel
                  key={r.id}
                  requisito={r}
                  subtipos={subtipos}
                  onSaved={patch => setRequisitos(items =>
                    items.map(item => (item.id === patch.id ? { ...item, ...patch } : item)))}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
