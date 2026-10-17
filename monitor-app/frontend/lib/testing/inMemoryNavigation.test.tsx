import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

vi.mock('next/navigation', async () => (await import('./inMemoryNavigation')).nextNavigation)
import { useRouter, useSearchParams } from 'next/navigation'
import { memoryUrl } from './inMemoryNavigation'

function Pantalla() {
  const params = useSearchParams()
  const router = useRouter()
  return <button onClick={() => router.replace('/x?tab=trips')}>{params.get('tab') ?? 'sin pestaña'}</button>
}

describe('next/navigation en memoria', () => {
  it('replace cambia la URL y la pantalla se vuelve a dibujar', () => {
    memoryUrl.reset('/x?tab=fleet')
    render(<Pantalla />)
    expect(screen.getByRole('button')).toHaveTextContent('fleet')
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button')).toHaveTextContent('trips')
    expect(memoryUrl.current()).toBe('/x?tab=trips')
    expect(memoryUrl.router.replace).toHaveBeenCalledWith('/x?tab=trips')
  })

  it('como Next: history.replaceState con una URL también cambia lo que leen useSearchParams y usePathname', () => {
    memoryUrl.reset('/x?tab=fleet')
    render(<Pantalla />)
    act(() => window.history.replaceState(null, '', '/x?tab=report'))
    expect(screen.getByRole('button')).toHaveTextContent('report')
    expect(memoryUrl.current()).toBe('/x?tab=report')
  })
})
