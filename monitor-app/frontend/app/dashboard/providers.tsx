'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        // 60 s y no 15: navegar entre pantallas dentro del minuto deja de
        // repedir todo. Lo que cambia el dato de verdad ya invalida a mano
        // —`invalidarCertificacion` y los `invalidateQueries` de cada escritura—
        // así que el `staleTime` sólo gobierna el refresco pasivo, y ahí un
        // minuto es holgado: la ingesta corre cada ~24 minutos.
        staleTime: 60_000,
        // Apagado a propósito. Con el valor por defecto —`true`— cada regreso a
        // la pestaña repite TODAS las consultas activas: en la ficha de una
        // empresa son ~300 KB por alt-tab, contra un backend que no comprime
        // hasta hoy y que tiene un presupuesto de conexiones chico.
        //
        // La pantalla que sí necesita frescura al enfocar ya lo pide por su
        // cuenta: `hooks/useTrips.ts` declara `refetchOnWindowFocus: true`
        // desde antes de este cambio. Ése es el criterio — el default no
        // refresca, y la vista que lo necesita lo dice.
        refetchOnWindowFocus: false,
      },
    },
  }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
