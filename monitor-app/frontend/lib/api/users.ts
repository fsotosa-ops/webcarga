import type { Profile, UserRole } from '@/lib/types'
import { apiFetch } from './client'


export type UserPatch = {
  role?:      UserRole
  active?:    boolean
  full_name?: string
}

export type UserCreate = {
  email:     string
  full_name: string
  role:      UserRole
  /** Sin contraseña: entra con su Google o Microsoft del mismo email. */
  password?: string
}

export const usersApi = {
  list: () =>
    apiFetch<Profile[]>('/api/v1/users'),

  // Alta y baja van por la API con require_admin (09/10): antes eran una
  // server action con la clave de servicio que no verificaba quién llamaba.
  create: (body: UserCreate) =>
    apiFetch<Profile>('/api/v1/users', { method: 'POST', body: JSON.stringify(body) }),

  remove: (id: string) =>
    apiFetch<void>(`/api/v1/users/${id}`, { method: 'DELETE' }),

  patch: (id: string, body: UserPatch) =>
    apiFetch<Profile>(`/api/v1/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}
