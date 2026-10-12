// @vitest-environment node
/**
 * Lo que deja obsoleto un cambio del Directorio (bloque 0, 0.5).
 *
 * La lista de claves ya se perdió más de una vez sin que nada fallara (el
 * docstring de lib/queries/certificacion.ts cuenta dos). Una clave que nadie
 * invalida no rompe nada: deja una pantalla vieja que solo se nota mirándola.
 * Por eso estos tests miran el CÓDIGO FUENTE: una pantalla nueva que lee una
 * raíz sin clasificar, o una mutación nueva que no pasa por invalidateDirectory,
 * los hace fallar.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { entitySummaryKey } from '@/lib/api/entitySummary'
import type { DirectoryEntity } from '@/lib/types'
import { clavesCertificacion } from './certificacion'
import { CLOSURE_ROOTS, directoryKeys, invalidateDirectory, type DirectoryChange } from './directorio'

const RAIZ = join(__dirname, '..', '..')

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
      acc.push(ruta)
    }
  }
  return acc
}
const fuentes = () => ['app', 'components', 'hooks', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))

async function invalidadas(change: DirectoryChange) {
  const qc = new QueryClient()
  const espia = vi.spyOn(qc, 'invalidateQueries')
  await invalidateDirectory(qc, change)
  return espia.mock.calls.map(([f]) => ({
    key: JSON.stringify(f?.queryKey), refetchType: f?.refetchType,
  }))
}
const claves = async (change: DirectoryChange) => (await invalidadas(change)).map(c => c.key)
const raices = async (change: DirectoryChange) => new Set((await claves(change)).map(k => JSON.parse(k)[0] as string))

describe('invalidateDirectory', () => {
  it('una transferencia invalida el roster de origen y el de destino (Review Focus 2)', async () => {
    const k = await claves({ entity: 'driver', id: 'd1', type: 'assignment', carrierIds: ['origen', 'destino'] })
    expect(k).toContain(JSON.stringify(['carrier-drivers', 'origen']))
    expect(k).toContain(JSON.stringify(['carrier-drivers', 'destino']))
    expect(k).toContain(JSON.stringify(['carrier-detail', 'destino']))
    expect(k).toContain(JSON.stringify(['driver-detail', 'd1']))
  })

  it('un equipo invalida el roster de equipos, no el de conductores', async () => {
    const k = await claves({ entity: 'asset', id: 'a1', type: 'update', carrierIds: ['c1'] })
    expect(k).toContain(JSON.stringify(['carrier-assets-roster', 'c1']))
    expect(k).toContain(JSON.stringify(['asset-driver-assignment', 'a1']))
    expect(k).not.toContain(JSON.stringify(['carrier-drivers', 'c1']))
  })

  it('alcanza Certificación, el Monitor, la vista rápida y las cifras del Directorio', async () => {
    const k = await claves({ entity: 'carrier', id: 'c1', type: 'update' })
    for (const raiz of [['carriers'], ['carriers-count'], ['carriers-directorio'], ['directorio-buscar'],
      ['certification-status'], ['entity-summary'], ['available-drivers'], ['available-assets']]) {
      expect(k).toContain(JSON.stringify(raiz))
    }
  })

  it('el Cierre se marca viejo sin releer: el servidor recalcula en un minuto', async () => {
    const llamadas = await invalidadas({ entity: 'driver', id: 'd1', type: 'update', carrierIds: ['c1'] })
    for (const raiz of CLOSURE_ROOTS) {
      expect(llamadas).toContainEqual({ key: JSON.stringify(raiz), refetchType: 'none' })
    }
    // Y nada del Cierre se relee de inmediato desde fuera del Cierre.
    const cierre = new Set(CLOSURE_ROOTS.map(r => (r as string[])[0]))
    for (const l of llamadas) {
      if (cierre.has(JSON.parse(l.key)[0])) expect(l.refetchType).toBe('none')
    }
  })

  it('un contacto no toca el Cierre ni el Monitor', async () => {
    const r = await invalidateDirectory(new QueryClient(), { entity: 'carrier', id: 'c1', type: 'contact' })
    const k = await claves({ entity: 'carrier', id: 'c1', type: 'contact' })
    expect(r.affectsClosure).toBe(false)
    expect(k).not.toContain(JSON.stringify(['daily-closure']))
    expect(k).not.toContain(JSON.stringify(['available-drivers']))
  })

  it('la ficha de empresa tiene una sola clave (R11)', () => {
    expect(directoryKeys.carrierDetail('c1')).toEqual(['carrier-detail', 'c1'])
    const viejas: string[] = []
    for (const ruta of fuentes()) {
      if (/\[\s*'carriers'\s*,\s*'detail'/.test(readFileSync(ruta, 'utf8'))) viejas.push(relative(RAIZ, ruta))
    }
    expect(viejas).toEqual([])
  })
})

// Raíces que leen las pantallas y que NINGÚN cambio de empresa, conductor o
// equipo deja obsoletas. Una raíz nueva que no está aquí ni la toca
// invalidateDirectory hace fallar el test de abajo: hay que decidir.
const NO_DEPENDEN_DEL_DIRECTORIO = new Set([
  'trips', 'trip', 'trip-notes', 'trips-meta', 'trips-activos',      // el viaje, no el maestro
  'taxonomias', 'taxonomies', 'tms-statuses', 'origenes', 'shippers',  // catálogos
  'locations-picker', 'coverage-types',
  'compliance-requirements', 'recalc-preview', 'vigencia-preview',     // configuración
  'planilla-vencimientos', 'config-inventario', 'config-busqueda', 'solicitables',
  'config-revisiones',                                                 // configuración (revision.tsx, clave en variable)
  'compliance-record-file', 'driver-compliance-records', 'asset-compliance-records', // documentos de una ficha abierta
  'compliance-pending-drawer',                                         // invalidada en CondicionPanel, ninguna consulta la lee
  'driver-contacts',                                                   // la invalida su propio panel
  'carrier-policies', 'policy-detail',                                 // Seguros: no cambia con el maestro
  'carrier-shippers',                                                  // solo la escribe el pre-cierre (P10, D3)
  'tarifario-all', 'tarifario-pending',                                // Comercial
  'closure-signatures', 'daily-closures-report',                       // la firma es inmutable; el reporte se pide al abrir
  'ingest-preview',                                                    // la URL firmada de un archivo, no el maestro
])

// Las fábricas de claves: una pantalla que lee `directoryKeys.x(…)` lee la raíz
// que devuelve esa función, igual que una que escribe la clave a mano.
const FABRICAS: Record<string, Record<string, (...a: string[]) => readonly unknown[]>> = {
  directoryKeys: directoryKeys as unknown as Record<string, (...a: string[]) => readonly unknown[]>,
  clavesCertificacion: clavesCertificacion as unknown as Record<string, (...a: string[]) => readonly unknown[]>,
}

/** Toda raíz de caché que lee alguna pantalla, con el archivo que la lee. */
function raicesLeidas(): Map<string, string> {
  const leidas = new Map<string, string>()
  const anotar = (raiz: string, ruta: string) => { if (!leidas.has(raiz)) leidas.set(raiz, relative(RAIZ, ruta)) }
  for (const ruta of fuentes()) {
    if (ruta.includes(join('lib', 'queries'))) continue
    const texto = readFileSync(ruta, 'utf8')
    for (const m of texto.matchAll(/queryKey:\s*\[\s*'([^']+)'/g)) anotar(m[1], ruta)
    for (const m of texto.matchAll(/\b(directoryKeys|clavesCertificacion)\.(\w+)\(/g)) {
      const f = FABRICAS[m[1]][m[2]]
      if (typeof f !== 'function') throw new Error(`${m[1]}.${m[2]} no existe (${relative(RAIZ, ruta)})`)
      anotar(String(f('x', 'x', 'x')[0]), ruta)
    }
    if (/\bentitySummaryKey\(/.test(texto)) anotar(entitySummaryKey('driver', 'x')[0], ruta)
    // Una clave guardada en una variable: `const clave = ['x', …]` … `queryKey: clave`.
    for (const m of texto.matchAll(/const\s+(\w+)\s*=\s*\[\s*'([^']+)'/g)) {
      if (new RegExp(`queryKey:\\s*${m[1]}\\b`).test(texto)) anotar(m[2], ruta)
    }
  }
  return leidas
}

const MONITOR = ['available-drivers', 'available-assets', 'drivers', 'driver-candidates']
const CIERRE = CLOSURE_ROOTS.map(r => String((r as unknown[])[0]))

/** Raíces leídas que un cambio dado NO deja obsoletas, con su motivo. */
function noLasCambia(change: DirectoryChange): string[] {
  const fuera: string[] = []
  // La ficha de un conductor o un equipo no muestra datos de la empresa.
  if (change.entity === 'carrier') fuera.push('driver-detail', 'asset-detail', 'asset-driver-assignment')
  // Un conductor no aparece en la ficha de un equipo ni en el roster de equipos.
  if (change.entity === 'driver') fuera.push('asset-detail', 'carrier-assets-roster', 'carrier-assets')
  // Un equipo no aparece en la ficha de un conductor ni en el roster de conductores.
  if (change.entity === 'asset') fuera.push('driver-detail', 'carrier-drivers')
  // Alguien recién creado no tiene ficha propia en caché.
  if (change.type === 'create' && change.entity === 'driver') fuera.push('driver-detail')
  if (change.type === 'create' && change.entity === 'asset') fuera.push('asset-detail', 'asset-driver-assignment')
  // Un contacto no cambia quién opera ni dónde (ver el test de arriba), ni el
  // nombre del conductor habitual de un tracto.
  if (change.type === 'contact') fuera.push(...MONITOR, ...CIERRE, 'asset-driver-assignment')
  // Los contactos de una empresa viven en su ficha, no en sus rosters.
  // (ni el teléfono de un conductor sale en el roster, ni la ficha de su empresa).
  if (change.type === 'contact') fuera.push('carrier-drivers', 'carrier-assets-roster', 'carrier-assets')
  if (change.type === 'contact' && change.entity !== 'carrier') fuera.push('carrier-detail')
  // Un conductor recién creado no es todavía el habitual de ningún tracto.
  if (change.type === 'create' && change.entity === 'driver') fuera.push('asset-driver-assignment')
  return fuera
}

const ENTIDADES: DirectoryEntity[] = ['carrier', 'driver', 'asset']
const TIPOS: DirectoryChange['type'][] = ['create', 'update', 'assignment', 'contact', 'delete']
/** Cada mutación posible, con los datos que le pasan los sitios que la llaman. */
const MUTACIONES: DirectoryChange[] = ENTIDADES.flatMap(entity => TIPOS.map(type => ({
  entity, type,
  id: type === 'create' && entity !== 'carrier' ? undefined : 'x',
  carrierIds: entity === 'carrier' || type === 'contact' ? undefined : ['x'],
})))

describe('cobertura', () => {
  it('por cada mutación, toda raíz que leen las pantallas afectadas se invalida (o está clasificada)', async () => {
    const leidas = raicesLeidas()
    const faltan: string[] = []
    for (const change of MUTACIONES) {
      const tocadas = await raices(change)
      const fuera = new Set(noLasCambia(change))
      for (const [raiz, archivo] of leidas) {
        if (tocadas.has(raiz) || NO_DEPENDEN_DEL_DIRECTORIO.has(raiz) || fuera.has(raiz)) continue
        faltan.push(`${change.entity}/${change.type}: ${raiz} (${archivo})`)
      }
    }
    expect(faltan).toEqual([])
  })

  it('las exclusiones nombran raíces que alguna pantalla lee (no se vuelven letra muerta)', () => {
    const leidas = raicesLeidas()
    const muertas = [...NO_DEPENDEN_DEL_DIRECTORIO, ...MUTACIONES.flatMap(noLasCambia)]
      .filter(r => !leidas.has(r))
    expect([...new Set(muertas)]).toEqual([])
  })

  // Escriben y avisan por un callback; quien los monta llama a invalidateDirectory (R12).
  const DELEGAN: Record<string, string> = {
    'components/dashboard/NewCarrierPanel.tsx': 'onCreated',
    'components/dashboard/AltaDeFlota.tsx': 'onCreado',
    'components/compliance/GestionDeclarada.tsx': 'onGuardado',
    'components/dashboard/sections/VincularConductorPropuesto.tsx': 'onVinculado',
    'components/dashboard/sections/AltaConductorDesdeCierre.tsx': 'onListo',
  }
  const MUTACION = /(carriersApi\.(patch|create|delete|assignDriver|assignAsset|unassignDriver|unassignAsset|createContact)|driversApi\.(create|patch|createContact)|assetsApi\.(create|patch|assignDriver|unassignDriver)|contactsApi\.(patch|delete))\(/

  it('toda mutación del Directorio pasa por invalidateDirectory', () => {
    const faltan: string[] = []
    for (const ruta of fuentes()) {
      const rel = relative(RAIZ, ruta)
      if (rel.startsWith(join('lib', 'api'))) continue
      const texto = readFileSync(ruta, 'utf8')
      if (!MUTACION.test(texto)) continue
      const delegado = DELEGAN[rel.split('\\').join('/')]
      if (delegado ? !texto.includes(delegado) : !texto.includes('invalidateDirectory(')) faltan.push(rel)
    }
    expect(faltan).toEqual([])
  })
})
