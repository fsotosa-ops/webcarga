import { apiFetch } from './client'

/** El ciclo de vida del Directorio (plan 2026-10-21): el estado no se edita por
 *  PATCH, cambia con una acción. Cada acción pide su permiso y su motivo; la regla
 *  vive en el backend (schemas/states.LIFECYCLE_TRANSITIONS). */
export type LifecycleScope = 'carrier' | 'driver' | 'asset'
export type LifecycleAction = 'activate' | 'deactivate' | 'reactivate' | 'return_to_onboarding'

/** El motivo (Configuración › Directorio) y, con «Otro», el comentario. Al
 *  reactivar una empresa, la flota que vuelve con ella. */
export type LifecycleBody = {
  /** Sin motivo solo al activar una empresa que cumple. */
  reason_id?:       string
  note?:            string
  driver_ids?:      string[]
  asset_ids?:       string[]
  /** Desde qué día rige (AAAA-MM-DD, plan 2026-10-28). Sin fecha: activar rige desde
   *  mañana; lo demás, desde hoy. */
  effective_date?:  string
  /** Solo en una activación como excepción: hasta qué día la carpeta tiene que quedar completa. */
  exception_until?: string
}

/** Lo que responde una acción: el estado de hoy y desde cuándo rige el nuevo. Al
 *  reactivar una empresa con la carpeta incompleta, `operational_status` es ONBOARDING. */
export type LifecycleResult = { operational_status?: string; effective_date?: string }

const PATH: Record<LifecycleScope, string> = { carrier: 'carriers', driver: 'drivers', asset: 'assets' }

function post<T>(scope: LifecycleScope, id: string, action: LifecycleAction, body: object) {
  return apiFetch<T>(`/api/v1/${PATH[scope]}/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) })
}

export const lifecycleApi = {
  /** Saca a una empresa del onboarding (→ Activa) cuando cumple los obligatorios. Si
   *  todavía no tiene RUT, va aquí. Con `reason_id` es una activación como excepción
   *  (no cumple): la hace Certificación. Sin cumplir y sin motivo, 409
   *  ONBOARDING_INCOMPLETE con lo que falta. */
  activateCarrier: (id: string, body: LifecycleBody & { tax_id?: string } = {}) =>
    post<LifecycleResult>('carrier', id, 'activate', body),

  deactivate: (scope: LifecycleScope, id: string, body: LifecycleBody) =>
    post<LifecycleResult>(scope, id, 'deactivate', body),

  /** Una empresa dada de baja vuelve según su carpeta (28/10): completa, activa;
   *  incompleta, en onboarding. Una baja definitiva pide directory.reinstate (403). */
  reactivate: (scope: LifecycleScope, id: string, body: LifecycleBody) =>
    post<LifecycleResult>(scope, id, 'reactivate', body),

  /** Una empresa activa vuelve a onboarding, con motivo (activada antes de tiempo). */
  returnToOnboarding: (id: string, body: LifecycleBody) =>
    apiFetch<LifecycleResult>(`/api/v1/carriers/${id}/return-to-onboarding`, { method: 'POST', body: JSON.stringify(body) }),
}
