import { describe, it, expect } from 'vitest'
import { legacyPoliciesHref } from './insurance'

const href = (qs: string) => legacyPoliciesHref(new URLSearchParams(qs))

// Hasta el 17/10, /dashboard/insurance era Pólizas (con `state`, `page` y `group`). Ahora es
// Empresas: un marcador o un enlace viejo tiene que seguir llegando a lo que mostraba.
describe('legacyPoliciesHref', () => {
  it('un enlace viejo de Pólizas va a Pólizas con su filtro, su página y su búsqueda', () => {
    expect(href('state=EXPIRED&page=2&q=SURA')).toBe('/dashboard/insurance/policies?state=EXPIRED&page=2&q=SURA')
    expect(href('group=policy')).toBe('/dashboard/insurance/policies')
  })

  it('el modo viejo "por empresa" es Empresas, sin los parámetros que ya no existen', () => {
    expect(href('group=carrier&state=NO_POLICY')).toBe('/dashboard/insurance')
    expect(href('group=carrier&q=77104928')).toBe('/dashboard/insurance?q=77104928')
  })

  it('un enlace de hoy no se toca: ?q=RUT (la ficha de empresa) y la vista de la tabla', () => {
    expect(href('')).toBeNull()
    expect(href('q=77104928-1')).toBeNull()
    expect(href('f.standing=Al+d%C3%ADa')).toBeNull()
    expect(href('view=all')).toBeNull()
  })
})
