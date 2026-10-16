/** Las direcciones de Seguros (Seguros E2): Pólizas, Cuotas y la ficha de una póliza. */
export const POLICIES = '/dashboard/insurance'
export const INSTALLMENTS = '/dashboard/insurance/installments'

export const policyHref = (id: string, returnTo?: string) =>
  `${POLICIES}/policies/${id}${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ''}`
