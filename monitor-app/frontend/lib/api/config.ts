import { apiFetch } from './client'
import type { StatusMeta, OperationalStateMeta, AlertThresholdMeta, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'


export type TripStatusRow = StatusMeta & { sort_order: number }
export type OperationalStateRow = OperationalStateMeta & { sort_order: number; active: boolean }

export const configApi = {
  // ── TMS Statuses (edit only — IDs are fixed by TMS) ──────────────────────
  getStatuses: () =>
    apiFetch<TripStatusRow[]>('/api/v1/config/statuses'),

  patchStatus: (id: string, body: Partial<Pick<StatusMeta, 'label' | 'bg_color' | 'text_color' | 'group'>> & { sort_order?: number }) =>
    apiFetch<TripStatusRow>(`/api/v1/config/statuses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  // ── Operational states (CRUD) ─────────────────────────────────────────────
  getOperationalStates: () =>
    apiFetch<OperationalStateRow[]>('/api/v1/config/operational-states'),

  createOperationalState: (body: { label: string; bg_color: string; text_color: string; sort_order?: number; group?: string }) =>
    apiFetch<OperationalStateRow>('/api/v1/config/operational-states', {
      method: 'POST',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  patchOperationalState: (id: string, body: Partial<{ label: string; bg_color: string; text_color: string; sort_order: number; active: boolean; group: string }>) =>
    apiFetch<OperationalStateRow>(`/api/v1/config/operational-states/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  deleteOperationalState: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/config/operational-states/${id}`, {
      method: 'DELETE',
    }),

  // ── Alert thresholds ──────────────────────────────────────────────────────
  getAlertThresholds: () =>
    apiFetch<AlertThresholdMeta[]>('/api/v1/config/alert-thresholds'),

  patchAlertThreshold: (doc_type: string, body: { warning_days?: number; error_days?: number }) =>
    apiFetch<AlertThresholdMeta>(`/api/v1/config/alert-thresholds/${doc_type}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // ── Temperature ranges (CRUD — cargo_type is free text, not a fixed enum) ──
  getTemperatureRanges: () =>
    apiFetch<TemperatureRangeMeta[]>('/api/v1/config/temperature-ranges'),

  createTemperatureRange: (body: TemperatureRangeMeta) =>
    apiFetch<TemperatureRangeMeta>('/api/v1/config/temperature-ranges', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchTemperatureRange: (cargo_type: string, body: Partial<Pick<TemperatureRangeMeta, 'label' | 'min_c' | 'max_c'>>) =>
    apiFetch<TemperatureRangeMeta>(`/api/v1/config/temperature-ranges/${encodeURIComponent(cargo_type)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteTemperatureRange: (cargo_type: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/config/temperature-ranges/${encodeURIComponent(cargo_type)}`, {
      method: 'DELETE',
    }),

  // ── Reglas de alerta del monitor ──────────────────────────────────────────
  getMonitorAlertRules: () =>
    apiFetch<MonitorAlertRules>('/api/v1/config/monitor-alert-rules'),

  patchMonitorAlertRules: (body: Partial<MonitorAlertRules>) =>
    apiFetch<MonitorAlertRules>('/api/v1/config/monitor-alert-rules', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}
