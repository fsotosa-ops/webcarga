/** Las direcciones de Seguros: Empresas (la entrada, 17/10), Pólizas, Cuotas y la ficha
 *  de una póliza. */
export const INSURANCE = '/dashboard/insurance'
export const POLICIES = '/dashboard/insurance/policies'
export const INSTALLMENTS = '/dashboard/insurance/installments'

export const policyHref = (id: string, returnTo?: string) =>
  `${POLICIES}/${id}${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ''}`
