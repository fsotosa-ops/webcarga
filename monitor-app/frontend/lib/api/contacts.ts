import type { Contact } from '@/lib/types'
import { apiFetch } from './client'

export type ContactPatchBody = {
  contact_role?: string
  first_name?:   string
  last_name?:    string
  job_title?:    string
  email?:        string
  phone?:        string
  is_primary?:   boolean
  is_active?:    boolean
}

export const contactsApi = {
  patch: (id: string, body: ContactPatchBody) =>
    apiFetch<Contact>(`/api/v1/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/contacts/${id}`, { method: 'DELETE' }),
}
