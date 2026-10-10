import { describe, it, expect } from 'vitest'
import { clasificarRespuestaMe, destinoSinAcceso } from './respuestaMe'

// Solo un 403 de la API dice "no tienes acceso". Una caída (5xx, arranque en
// frío, red) NO es una negación: tratarla como tal cerraba la sesión de todos
// y les decía que pidieran una invitación (revisión final RBAC, hallazgo 1).
describe('clasificarRespuestaMe', () => {
  it('200 es acceso', () => {
    expect(clasificarRespuestaMe(200, null)).toBe('ok')
  })
  it('403 sin roles es sin acceso', () => {
    expect(clasificarRespuestaMe(403, 'Tu cuenta no tiene acceso. Pide a un administrador que te invite.')).toBe('sin-acceso')
  })
  it('403 de cuenta desactivada', () => {
    expect(clasificarRespuestaMe(403, 'Tu cuenta está desactivada')).toBe('desactivada')
  })
  it.each([500, 502, 503, 504, 429])('%i es servicio no disponible, no una negación', status => {
    expect(clasificarRespuestaMe(status, null)).toBe('no-disponible')
  })
  it('401 (token vencido entre el login y la llamada) tampoco es una negación', () => {
    expect(clasificarRespuestaMe(401, 'No autenticado')).toBe('sin-sesion')
  })
})

describe('destinoSinAcceso', () => {
  it('una caída va a "no disponible", sin cerrar la sesión', () => {
    expect(destinoSinAcceso('no-disponible')).toBe('/auth/no-disponible')
  })
  it('las negaciones van a su motivo', () => {
    expect(destinoSinAcceso('sin-acceso')).toBe('/auth/access-denied?reason=not-invited')
    expect(destinoSinAcceso('desactivada')).toBe('/auth/access-denied?reason=deactivated')
    expect(destinoSinAcceso('sin-sesion')).toBe('/login')
  })
})
