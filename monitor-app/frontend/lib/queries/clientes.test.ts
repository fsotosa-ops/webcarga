// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateClients } from './clientes'

const RAIZ = join(__dirname, '..', '..')
function recorrer(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : recorrer(ruta)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : []
  })
}

describe('el directorio de clientes', () => {
  it('se lee en un solo lugar (useClients): una caché, que invalidateClients refresca', () => {
    const lectores = ['app', 'components', 'hooks', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))
      .filter(r => /shippersApi\.list\b/.test(readFileSync(r, 'utf8')))
      .map(r => relative(RAIZ, r))
    expect(lectores).toEqual(['hooks/useClients.ts'])
  })

  it('un cambio de cliente refresca también la pestaña Empresas de su ficha (raíz carriers)', async () => {
    const qc = new QueryClient()
    const invalida = vi.spyOn(qc, 'invalidateQueries')
    await invalidateClients(qc)
    expect(invalida).toHaveBeenCalledWith({ queryKey: ['carriers'] })
  })
})
