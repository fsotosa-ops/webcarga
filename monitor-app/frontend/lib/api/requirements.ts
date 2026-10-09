import { apiFetch } from './client'
import type { EfectoDelLote, ExigibleOn, LotePublicado, RequirementAlias, RequirementConditions, RequirementConditionsPatchResult, RequirementOption, RecalcPreview, RecalcResult, VistaPreviaDeVigencia } from '@/lib/types'
import type { Vigencia } from '@/lib/vigencia'

const BASE = '/api/v1/compliance-requirements'

/** Lo que se le cambia a un documento: el mismo cuerpo del PATCH de uno. */
export type CambiosDeRequisito = Partial<Pick<RequirementConditions,
  'is_active' | 'applies_to_fleet_service_type_ids' | 'applies_to_management_types'
  | 'name' | 'requirement_level'>> & {
  /** El tipo de vencimiento y sus parámetros, juntos (HU-C1, entrega 2b). */
  vigencia?: Vigencia
  exigible_on?: ExigibleOn
}

/** Un documento del borrador y lo que se le cambia. */
export type CambioEnLote = { requirement_id: string; patch: CambiosDeRequisito }

export const requirementsApi = {
  /** Cambia la regla, NO los registros: aplicarla es POST /recalc, un acto
   *  aparte. `null` no es un valor válido para `is_active` (columna NOT
   *  NULL) — el backend lo rechaza con 422. */
  patchConditions: (id: string, body: CambiosDeRequisito) =>
    apiFetch<RequirementConditionsPatchResult>(`${BASE}/${id}/conditions`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  /** Alta de un tipo de documento. NACE APAGADO: `reconcile_new_requirement()`
   *  siembra un registro por cada entidad que califique —87 conductores, hasta
   *  124 vehículos, sobre 5.121—, así que insertarlo vigente sería una
   *  escritura masiva disparada por un formulario. Se activa después, con la
   *  vista previa en medio.
   *
   *  `requirement_code` no se manda: lo deriva el backend del nombre. Es la
   *  llave del motor de match y de los alias. */
  create: (body: {
    name: string
    target_entity: 'CARRIER' | 'DRIVER' | 'ASSET'
    requirement_level?: 'LEGAL_MANDATORY' | 'CONDITIONAL_OPTIONAL'
    vigencia?: Vigencia
    exigible_on?: ExigibleOn
    shipper_id?: string | null
  }) => apiFetch<RequirementOption>(BASE, { method: 'POST', body: JSON.stringify(body) }),

  /** Las formas de escribir este documento en el nombre de un archivo. Sin
   *  alias, un documento nuevo es INVISIBLE para el clasificador. */
  aliases: (id: string) =>
    apiFetch<RequirementAlias[]>(`${BASE}/${id}/aliases`),

  addAlias: (id: string, alias: string, priority = 0) =>
    apiFetch<RequirementAlias>(`${BASE}/${id}/aliases`, {
      method: 'POST', body: JSON.stringify({ alias, priority }),
    }),

  removeAlias: (id: string, aliasId: string) =>
    apiFetch<void>(`${BASE}/${id}/aliases/${aliasId}`, { method: 'DELETE' }),

  /** Sólo lectura: qué pasaría si se aplicara la regla actual. */
  recalcPreview: (id: string) => apiFetch<RecalcPreview>(`${BASE}/${id}/recalc-preview`),

  recalc: (id: string) => apiFetch<RecalcResult>(`${BASE}/${id}/recalc`, { method: 'POST' }),

  /** Qué pasaría con los documentos de este tipo si se guardara esta
   *  vigencia. No guarda nada: el backend la prueba y revierte. */
  previewVigencia: (id: string, vigencia: Vigencia) =>
    apiFetch<VistaPreviaDeVigencia>(`${BASE}/${id}/expiration-rule/preview`, {
      method: 'POST', body: JSON.stringify(vigencia),
    }),

  /** Qué pasaría si se publicara el borrador entero. No guarda nada: el
   *  backend lo aplica en una transacción y la revierte. */
  verEfectoDelLote: (cambios: CambioEnLote[]) =>
    apiFetch<EfectoDelLote>(`${BASE}/batch-preview`, {
      method: 'POST', body: JSON.stringify({ cambios }),
    }),

  /** Guarda el borrador y siembra lo que cambió, todo o nada. */
  publicarLote: (cambios: CambioEnLote[]) =>
    apiFetch<LotePublicado>(`${BASE}/batch-update`, {
      method: 'POST', body: JSON.stringify({ cambios }),
    }),
}
