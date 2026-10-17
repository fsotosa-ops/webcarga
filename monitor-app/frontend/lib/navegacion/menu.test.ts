import { describe, it, expect } from 'vitest'
import type { PermissionCode } from '@/lib/authz/permisos.generated'
import { NAV, MOBILE_DESTINATIONS, activeHref, isGroup, mobileBar, mobileProfile, visibleNav } from './menu'

const TODO = ['documents.review'] as PermissionCode[]
const hojas = NAV.flatMap(e => (isGroup(e) ? e.items : [e]))
const hrefs = (bar: ReturnType<typeof mobileBar>) => bar.map(b => b.leaf.href)

describe('el perfil del teléfono sale de los roles (N2)', () => {
  it('gana el área de nivel más alto', () => {
    expect(mobileProfile(['certification_supervisor', 'operations_operator'])).toBe('certification')
  })
  it('a igual nivel, el orden de las áreas', () => {
    expect(mobileProfile(['operations_operator', 'insurance_operator'])).toBe('operations')
  })
  it('sin un rol de área, el perfil es General', () => {
    expect(mobileProfile(['reader'])).toBe('general')
    expect(mobileProfile(['owner', 'admin'])).toBe('general')
  })
})

describe('la barra de cada perfil (N3)', () => {
  it('Operaciones: Monitor, Cierre, Empresas y Conductores', () => {
    expect(hrefs(mobileBar({ roles: ['operations_supervisor'], permissions: TODO }))).toEqual([
      '/dashboard/operations/monitor', '/dashboard/operations/closures', '/dashboard/carriers', '/dashboard/drivers',
    ])
  })
  it('un destino sin permiso se salta y no deja hueco', () => {
    const bar = mobileBar({ roles: ['certification_operator'], permissions: [] })
    expect(hrefs(bar)).not.toContain('/dashboard/compliance/inbox')
    expect(bar).toHaveLength(3)
  })
  it('nunca más de 4 destinos', () => {
    for (const roles of [['operations_supervisor'], ['certification_supervisor'], ['insurance_supervisor'],
                         ['commercial_supervisor'], ['owner']]) {
      expect(mobileBar({ roles, permissions: TODO }).length).toBeLessThanOrEqual(4)
    }
  })
})

describe('el dato de la navegación', () => {
  it('todo destino del teléfono es una entrada del menú', () => {
    const existentes = new Set(hojas.map(h => h.href))
    for (const lista of Object.values(MOBILE_DESTINATIONS)) for (const h of lista) expect(existentes).toContain(h)
  })
  it('la etiqueta corta cabe en la barra (12 caracteres)', () => {
    for (const h of hojas) expect((h.short ?? h.label).length, h.label).toBeLessThanOrEqual(12)
  })
  it('una entrada con permiso no aparece sin él', () => {
    const conPermiso = visibleNav(TODO).flatMap(e => (isGroup(e) ? e.items : [e])).map(h => h.href)
    const sinPermiso = visibleNav([]).flatMap(e => (isGroup(e) ? e.items : [e])).map(h => h.href)
    expect(conPermiso).toContain('/dashboard/compliance/inbox')
    expect(sinPermiso).not.toContain('/dashboard/compliance/inbox')
  })
})

describe('la entrada activa', () => {
  const todas = hojas.map(h => h.href)
  it('el prefijo más largo: el histórico del Cierre marca el Cierre', () => {
    expect(activeHref('/dashboard/operations/closures/history', todas)).toBe('/dashboard/operations/closures')
  })
  it('una pantalla interna marca su entrada: el detalle de un viaje marca el Monitor', () => {
    expect(activeHref('/dashboard/operations/monitor/trips/x', todas)).toBe('/dashboard/operations/monitor')
  })
  it('un prefijo de texto no es una ruta: /dashboard/compliance-x no marca Certificación', () => {
    expect(activeHref('/dashboard/compliance-x', todas)).toBeNull()
  })
})
