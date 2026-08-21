import { render } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { describe, it, expect } from 'vitest'

import { Providers } from './providers'

/** Los valores por defecto de React Query deciden cuánto tráfico genera la app
 *  entera, y no los ve ningún test de pantalla. */
function leerDefaults() {
  let defaults: Record<string, unknown> = {}
  function Sonda() {
    defaults = useQueryClient().getDefaultOptions().queries as Record<string, unknown>
    return null
  }
  render(<Providers><Sonda /></Providers>)
  return defaults
}

describe('los valores por defecto de las consultas', () => {
  it('no repite todas las consultas al volver a la pestaña', () => {
    // Con el default de React Query —`true`— cada alt-tab repetía TODAS las
    // consultas activas. En la ficha de una empresa son ~300 KB por regreso.
    expect(leerDefaults().refetchOnWindowFocus).toBe(false)
  })

  it('considera fresco un dato por un minuto', () => {
    // Navegar entre pantallas dentro del minuto deja de repedir. Lo que cambia
    // el dato ya invalida a mano, así que esto sólo gobierna el refresco pasivo.
    expect(leerDefaults().staleTime).toBe(60_000)
  })
})
