import type { Profile, UserRole } from '@/lib/types'
import { apiFetch } from './client'


export type UserPatch = {
  role?:      UserRole
  active?:    boolean
  full_name?: string
}

export const usersApi = {
  list: () =>
    apiFetch<Profile[]>('/api/v1/users'),

  patch: (id: string, body: UserPatch) =>
    apiFetch<Profile>(`/api/v1/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}
