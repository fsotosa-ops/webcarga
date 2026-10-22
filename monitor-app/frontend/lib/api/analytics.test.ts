import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }),
}))

import { analyticsApi, ExportTooLargeError, queryParams } from './analytics'

beforeEach(() => vi.restoreAllMocks())

const Q = {
  dataset: 'trips' as const, period: { preset: 'custom' as const, from: '2026-10-01', to: '2026-10-07' },
  dateField: 'delivered' as const,
  view: { filters: { client_name: ['Walmart', 'Lider, Express'] }, q: 'HFVP', sort: { column: 'trip_code', dir: 'desc' as const } },
  page: 2, size: 100,
}

describe('analyticsApi', () => {
  it('traduce la consulta a los parámetros de la API', () => {
    const p = queryParams(Q, '2026-10-22')
    expect(Object.fromEntries(p)).toEqual({
      dataset: 'trips', from: '2026-10-01', to: '2026-10-07', date: 'delivered',
      'f.client_name': 'Walmart,Lider%2C%20Express', q: 'HFVP', sort: 'trip_code:desc', page: '2', size: '100',
    })
  })

  it('un período relativo se resuelve con el día de hoy', () => {
    const p = queryParams({ ...Q, period: { preset: 'last_7d' } }, '2026-10-22')
    expect([p.get('from'), p.get('to')]).toEqual(['2026-10-16', '2026-10-22'])
  })

  it('una descarga de más de 50.000 filas lanza ExportTooLargeError con el total', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { total: 61234 } }),
      { status: 413, headers: { 'content-type': 'application/json' } })))
    const error = await analyticsApi.export(Q, ['trip_code'], '2026-10-22').catch(e => e)
    expect(error).toBeInstanceOf(ExportTooLargeError)
    expect(error.total).toBe(61234)
  })

  it('la descarga devuelve el archivo con su nombre', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toContain('/api/v1/analytics/export?')
      expect(url).toContain('columns=trip_code%2Cclient_name')
      return new Response('x', { status: 200 })
    }))
    const { filename } = await analyticsApi.export(Q, ['trip_code', 'client_name'], '2026-10-22')
    expect(filename).toBe('analitica_trips_2026-10-01_2026-10-07.xlsx')
  })
})
