import { describe, it, expect } from 'vitest'
import { EMPTY_VIEW, readView, writeView } from './vistaEnUrl'

describe('la vista de una tabla en la URL', () => {
  it('ida y vuelta: filtros con comas y tildes, búsqueda y orden', () => {
    const view = {
      filters: { carrier: ['Hasa Spa', 'Peña, Ruiz y Cía.'], status: ['Sin motivo'] },
      q: 'bdlc',
      sort: { column: 'primary', dir: 'desc' as const },
    }
    const params = writeView(new URLSearchParams('date=2026-10-16&tab=fleet'), view)
    expect(readView(params)).toEqual(view)
  })

  it('conserva los parámetros ajenos y quita los filtros que se vacían', () => {
    const conFiltro = writeView(new URLSearchParams('date=2026-10-16'), { ...EMPTY_VIEW, filters: { carrier: ['Hasa'] } })
    const sinFiltro = writeView(conFiltro, EMPTY_VIEW)
    expect(sinFiltro.toString()).toBe('date=2026-10-16')
  })

  it('sin nada en la URL, la vista vacía', () => {
    expect(readView(new URLSearchParams('date=2026-10-16'))).toEqual(EMPTY_VIEW)
  })

  it('un orden mal escrito se ignora', () => {
    expect(readView(new URLSearchParams('sort=primary:arriba')).sort).toBeNull()
  })
})
