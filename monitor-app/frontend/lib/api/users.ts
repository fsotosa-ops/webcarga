import type { Profile } from '@/lib/types'
import { apiFetch } from './client'


/** Los roles se cambian aparte (PUT /users/{id}/roles, RBAC). */
export type UserPatch = {
  active?:    boolean
  full_name?: string
}

export type UserCreate = {
  email:     string
  full_name: string
  /** Códigos de rol (RBAC); la API rechaza dar permisos que quien invita no tiene. */
  roles:     string[]
  /** Sin contraseña: entra con su Google o Microsoft del mismo email. */
  password?: string
}

export const usersApi = {
  list: () =>
    apiFetch<Profile[]>('/api/v1/users'),

  // Alta y baja van por la API con require_admin (09/10): antes eran una
  // server action con la clave de servicio que no verificaba quién llamaba.
  create: (body: UserCreate) =>
    apiFetch<Profile & { invitation_sent: boolean }>('/api/v1/users', { method: 'POST', body: JSON.stringify(body) }),

  remove: (id: string) =>
    apiFetch<void>(`/api/v1/users/${id}`, { method: 'DELETE' }),

  patch: (id: string, body: UserPatch) =>
    apiFetch<Profile>(`/api/v1/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}
