import { apiFetch } from './client'

/** El ciclo de vida del Directorio (plan 2026-10-21): el estado no se edita por
 *  PATCH, cambia con una acción. Cada acción pide su permiso y su motivo; la regla
 *  vive en el backend (schemas/states.LIFECYCLE_TRANSITIONS). */
export type LifecycleScope = 'carrier' | 'driver' | 'asset'
export type LifecycleAction = 'activate' | 'deactivate' | 'reactivate'

/** El motivo (Configuración › Directorio) y, con «Otro», el comentario. Al
 *  reactivar una empresa, la flota que vuelve con ella. */
export type LifecycleBody = {
  reason_id:   string
  note?:       string
  driver_ids?: string[]
  asset_ids?:  string[]
}

const PATH: Record<LifecycleScope, string> = { carrier: 'carriers', driver: 'drivers', asset: 'assets' }

function post<T>(scope: LifecycleScope, id: string, action: LifecycleAction, body: object) {
  return apiFetch<T>(`/api/v1/${PATH[scope]}/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) })
}

export const lifecycleApi = {
  /** Saca a una empresa del onboarding (→ Activa) cuando cumple los obligatorios. Si
   *  todavía no tiene RUT, va aquí. Con `reason_id` es una activación como excepción
   *  (no cumple): la hace Certificación. Sin cumplir y sin motivo, 409
   *  ONBOARDING_INCOMPLETE con lo que falta. */
  activateCarrier: (id: string, body: { tax_id?: string; reason_id?: string; note?: string } = {}) =>
    post<{ operational_status: string }>('carrier', id, 'activate', body),

  deactivate: (scope: LifecycleScope, id: string, body: LifecycleBody) =>
    post<unknown>(scope, id, 'deactivate', body),

  reactivate: (scope: LifecycleScope, id: string, body: LifecycleBody) =>
    post<unknown>(scope, id, 'reactivate', body),
}
