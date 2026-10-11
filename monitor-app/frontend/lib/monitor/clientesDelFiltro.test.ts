import { describe, it, expect } from 'vitest'
import { clientesDelFiltro } from './clientesDelFiltro'

const WALMART = { id: 'w', name: 'Walmart', count: 31 }
const IANSA = { id: 'i', name: 'Iansa', count: 4 }

describe('clientesDelFiltro', () => {
  it('son los clientes con viajes en la vista, con su cuenta', () => {
    expect(clientesDelFiltro([WALMART, IANSA], [], {})).toEqual([WALMART, IANSA])
  })

  it('un cliente elegido que ya no tiene viajes en la vista sigue, en cero, para poder quitarlo', () => {
    expect(clientesDelFiltro([IANSA], ['w'], { w: 'Walmart' })).toEqual([IANSA, { id: 'w', name: 'Walmart', count: 0 }])
  })

  it('un elegido del que no se conoce el nombre no se inventa', () => {
    expect(clientesDelFiltro([IANSA], ['x'], {})).toEqual([IANSA])
  })
})
