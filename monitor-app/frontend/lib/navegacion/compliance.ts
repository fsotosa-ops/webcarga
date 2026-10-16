/** Las direcciones de Certificación › Documentos exigidos (Configuración, Parte 2). */
import { withReturn } from './retorno'

export const REQUIREMENTS = '/dashboard/compliance/requirements'

export const requirementHref = (id: string, returnTo?: string) => withReturn(`${REQUIREMENTS}/${id}`, returnTo)

const PENDING = '/dashboard/compliance/pending'

/** Pendientes con un documento elegido: quiénes no cumplen ese documento. */
export const pendingDocumentHref = (code: string) => `${PENDING}?doc=${encodeURIComponent(code)}`
