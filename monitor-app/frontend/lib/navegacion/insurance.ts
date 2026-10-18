/** Las direcciones de Seguros: Empresas (la entrada, 17/10), Pólizas, Cuotas y la ficha
 *  de una póliza. */
export const INSURANCE = '/dashboard/insurance'
export const POLICIES = '/dashboard/insurance/policies'
export const INSTALLMENTS = '/dashboard/insurance/installments'

export const policyHref = (id: string, returnTo?: string) =>
  `${POLICIES}/${id}${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ''}`

/** Hasta el 17/10, `INSURANCE` era Pólizas (`state`, `page`, `group=policy|carrier`). Un
 *  marcador o enlace viejo sigue llegando a lo que mostraba: Pólizas con su filtro, o
 *  Empresas si era el modo "por empresa". `null`: es un enlace de hoy (`?q=RUT` de la
 *  ficha, la vista de la tabla). */
export function legacyPoliciesHref(params: URLSearchParams): string | null {
  const group = params.get('group')
  const legacy = group !== null || params.has('state') || params.has('page')
  if (!legacy) return null
  const keep = (keys: string[]) => {
    const out = new URLSearchParams()
    for (const k of keys) { const v = params.get(k); if (v) out.set(k, v) }
    const s = out.toString()
    return s ? `?${s}` : ''
  }
  return group === 'carrier' ? `${INSURANCE}${keep(['q'])}` : `${POLICIES}${keep(['state', 'page', 'q'])}`
}
