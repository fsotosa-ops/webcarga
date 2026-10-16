/** Las direcciones de Certificación › Documentos exigidos (Configuración, Parte 2). */
import { withReturn } from './retorno'

export const REQUIREMENTS = '/dashboard/compliance/requirements'

export const requirementHref = (id: string, returnTo?: string) => withReturn(`${REQUIREMENTS}/${id}`, returnTo)
