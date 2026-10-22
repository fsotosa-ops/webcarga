import { describe, it, expect, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect }))
import ReporteriaPage from './page'

describe('la Reportería pasó a Analítica (Flota por día, tabla dinámica)', () => {
  it('redirige con los conductores y el modo tabla dinámica', async () => {
    await ReporteriaPage({ searchParams: Promise.resolve({}) })
    expect(redirect).toHaveBeenCalledWith('/dashboard/analytics?dataset=fleet&mode=pivot&f.subject_type=DRIVER&period=this_month')
  })

  it('conserva el rango si llega', async () => {
    await ReporteriaPage({ searchParams: Promise.resolve({ desde: '2026-07-01', hasta: '2026-07-21' }) })
    expect(redirect).toHaveBeenLastCalledWith(
      '/dashboard/analytics?dataset=fleet&mode=pivot&f.subject_type=DRIVER&period=custom&from=2026-07-01&to=2026-07-21')
  })
})
