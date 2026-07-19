import { describe, it, expect } from 'vitest'
import { TMS_LOGIN_URLS } from './tmsLinks'

describe('TMS_LOGIN_URLS', () => {
  it('maps the 3 known TMS sources to their public login URL', () => {
    expect(TMS_LOGIN_URLS.qanalytics).toBe('https://www.qanalytics.cl/qnew/#')
    expect(TMS_LOGIN_URLS.wingsuite).toBe('https://suite.wing.cl/web/core/inicio_sesion.php')
    expect(TMS_LOGIN_URLS.sodimac).toBe('https://tms.falabella.supply/login')
  })

  it('has no entry for manual (no TMS to link to)', () => {
    expect(TMS_LOGIN_URLS.manual).toBeUndefined()
  })
})
