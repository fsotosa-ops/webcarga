import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
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
  it('las etiquetas de la barra no se repiten en ningún perfil (un lector de pantalla no oye el ícono)', () => {
    for (const roles of [['operations_supervisor'], ['certification_supervisor'], ['insurance_supervisor'],
                         ['commercial_supervisor'], ['owner']]) {
      const etiquetas = mobileBar({ roles, permissions: TODO }).map(b => b.label)
      expect(new Set(etiquetas).size, roles.join()).toBe(etiquetas.length)
    }
    expect(mobileBar({ roles: ['owner'], permissions: TODO }).map(b => b.label))
      .toEqual(['Monitor', 'Empresas', 'Certificación', 'Seguros'])
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

describe('una sola definición del menú (N1)', () => {
  const RAIZ = join(__dirname, '..', '..')
  const recorrer = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const ruta = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) return []
    return statSync(ruta).isDirectory() ? recorrer(ruta) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [ruta] : []
  })
  it('las listas del menú solo se declaran en lib/navegacion/menu.ts', () => {
    const DECLARA = /\b(?:const|let)\s+(?:NAV|NAV_GROUPS|NAV_ITEMS|NAV_ORDEN|MOBILE_NAV_ITEMS|MOBILE_DESTINATIONS)\b/
    const fuera = ['app', 'components', 'lib', 'hooks'].flatMap(d => recorrer(join(RAIZ, d)))
      .filter(r => !r.endsWith(join('lib', 'navegacion', 'menu.ts')))
      .filter(r => DECLARA.test(readFileSync(r, 'utf8')))
      .map(r => relative(RAIZ, r))
    expect(fuera).toEqual([])
  })
})

describe('Analítica en el menú', () => {
  it('aparece solo con analytics.read, después de Seguros', () => {
    const etiquetas = (p: string[]) => visibleNav(p as never).map(e => ('items' in e ? e.label : e.label))
    expect(etiquetas(['analytics.read'])).toContain('Analítica')
    expect(etiquetas([])).not.toContain('Analítica')
    const orden = NAV.map(e => e.label)
    expect(orden.indexOf('Analítica')).toBe(orden.indexOf('Seguros') + 1)
  })
})
