import { apiFetch } from './client'


export type FilterGroup = {
  id:         string
  name:       string
  statuses:   string[]
  color:      GroupColor
  created_at: string
  updated_at: string
}

export type GroupColor = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'teal' | 'amber' | 'pink' | 'slate'

export const filterGroupsApi = {
  list: () =>
    apiFetch<FilterGroup[]>('/api/v1/filter-groups'),

  create: (body: { name: string; statuses: string[]; color: GroupColor }) =>
    apiFetch<FilterGroup>('/api/v1/filter-groups', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name?: string; statuses?: string[]; color?: GroupColor }) =>
    apiFetch<FilterGroup>(`/api/v1/filter-groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/filter-groups/${id}`, { method: 'DELETE' }),
}
