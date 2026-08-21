import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { list: vi.fn().mockResolvedValue({ data: [], count: 0 }) },
}))

import { tripsApi } from '@/lib/api/trips'
import { useTrips } from './useTrips'

/** El Monitor es la ÚNICA pantalla que se deja abierta y se mira de reojo, y
 *  por eso es la única que necesita refrescar al volver a la pestaña.
 *
 *  Desde que el default global es `refetchOnWindowFocus: false`
 *  (`app/dashboard/providers.tsx`), esa excepción es lo único que la mantiene
 *  fresca. Si alguien borra la línea de `useTrips`, el Monitor deja de
 *  actualizarse al enfocar **en silencio** — no falla nada, sólo muestra datos
 *  viejos a quien está mirando una operación en vivo. */
describe('useTrips', () => {
  it('pide refrescar al volver a la pestaña, contra el default global apagado', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    renderHook(() => useTrips({ view: 'en_curso' }), { wrapper })
    await waitFor(() => expect(tripsApi.list).toHaveBeenCalledTimes(1))

    // Se afirma el COMPORTAMIENTO —volver a la pestaña vuelve a pedir— y no la
    // presencia de una opción: `options.refetchOnWindowFocus` existe en tiempo
    // de ejecución pero no en el tipo de `QueryOptions`, así que afirmarlo
    // pasaba por casualidad de la forma del objeto.
    focusManager.setFocused(false)
    focusManager.setFocused(true)

    await waitFor(() => expect(tripsApi.list).toHaveBeenCalledTimes(2))
  })
})
