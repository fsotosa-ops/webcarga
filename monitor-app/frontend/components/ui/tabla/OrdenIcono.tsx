import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

/** Extraido de TripTable.tsx, donde vivia privado. Mismos iconos, mismos
 *  tamanos y mismos colores: si el orden se ve distinto en dos tablas de la
 *  misma app, deja de leerse como orden. */
export function OrdenIcono({ activo, direccion }: { activo: boolean; direccion: 'asc' | 'desc' }) {
  if (!activo) return <ArrowUpDown size={10} className="inline ml-0.5 text-gray-300" aria-hidden="true" />
  if (direccion === 'asc') return <ArrowUp size={10} className="inline ml-0.5 text-accent" aria-hidden="true" />
  return <ArrowDown size={10} className="inline ml-0.5 text-accent" aria-hidden="true" />
}
