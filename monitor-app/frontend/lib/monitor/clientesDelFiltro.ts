import type { ClientFacet } from '@/lib/types'

/** Las opciones del filtro de cliente del Monitor: los clientes con viajes en la
 *  vista (en curso, o el rango del historial), con su cuenta, como los devuelve
 *  `GET /trips`. Un cliente elegido que dejó de tener viajes en la vista se
 *  mantiene en cero para que se pueda quitar; si no se conoce su nombre, no se
 *  inventa. */
export function clientesDelFiltro(
  facetas: ClientFacet[],
  elegidos: string[],
  nombresConocidos: Record<string, string>,
): ClientFacet[] {
  const presentes = new Set(facetas.map(c => c.id))
  const ausentes = elegidos
    .filter(id => !presentes.has(id) && nombresConocidos[id])
    .map(id => ({ id, name: nombresConocidos[id], count: 0 }))
  return [...facetas, ...ausentes]
}
