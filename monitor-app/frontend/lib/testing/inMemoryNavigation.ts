/** `next/navigation` en memoria para los tests de pantallas cuya vista vive en la
 *  URL (Cierre con un solo patrón, spec §4.2): `replace` y `push` cambian la URL y
 *  la pantalla se vuelve a dibujar, como en el navegador. Un solo lugar para los
 *  tests que lo necesitan, en vez de una copia del mock en cada uno.
 *
 *    vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
 *    beforeEach(() => memoryUrl.reset('/dashboard/operations/closures?date=2026-08-04'))
 */
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'

let url = new URL('http://test/')
const listeners = new Set<() => void>()
const porConsulta = new Map<string, URLSearchParams>()

function cambiar(destino: string) {
  url = new URL(destino, url)
  listeners.forEach(l => l())
}

// Como el App Router de Next (`app-router.js`): `history.replaceState` y `pushState`
// con una URL cambian lo que leen useSearchParams y usePathname, sin navegar. Así se
// escribe la vista de una tabla (`useUrlView`). Se envuelve una sola vez, al cargar.
for (const metodo of ['replaceState', 'pushState'] as const) {
  const nativo = window.history[metodo].bind(window.history)
  window.history[metodo] = (data: unknown, unused: string, destino?: string | URL | null) => {
    nativo(data, unused, destino)
    if (destino) cambiar(String(destino))
  }
}

const router = {
  replace: vi.fn((destino: string) => cambiar(destino)),
  push: vi.fn((destino: string) => cambiar(destino)),
  back: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}

function suscribir(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

function useSearchParams(): URLSearchParams {
  const consulta = useSyncExternalStore(suscribir, () => url.search, () => url.search)
  // La misma instancia para la misma consulta, como Next: si no, cada render la
  // ve "nueva" y los efectos que dependen de ella se disparan sin fin.
  if (!porConsulta.has(consulta)) porConsulta.set(consulta, new URLSearchParams(consulta))
  return porConsulta.get(consulta)!
}

function usePathname(): string {
  return useSyncExternalStore(suscribir, () => url.pathname, () => url.pathname)
}

export const nextNavigation = {
  useRouter: () => router,
  useSearchParams,
  usePathname,
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}

export const memoryUrl = {
  /** Vuelve a una URL (ruta y consulta) y limpia lo registrado. */
  reset(destino: string) {
    url = new URL(destino, 'http://test/')
    router.replace.mockClear(); router.push.mockClear()
    listeners.forEach(l => l())
  },
  /** La URL de ahora, como la escribiría la app (ruta + consulta). */
  current: () => `${url.pathname}${url.search}`,
  params: () => new URLSearchParams(url.search),
  router,
}
