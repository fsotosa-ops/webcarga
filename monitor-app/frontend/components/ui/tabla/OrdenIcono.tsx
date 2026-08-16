import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

/** Extraido de TripTable.tsx, donde vivia privado — y TripTable lo usa desde
 *  aca: la copia local se fue. Mismos iconos, mismos tamanos y mismos colores,
 *  en un solo lugar: si el orden se ve distinto en dos tablas de la misma app,
 *  deja de leerse como orden.
 *
 *  La firma es {activo, direccion} y no {col, sortKey, sortDir}: el icono no
 *  tiene por que saber como se llaman las columnas de quien lo dibuja. Los
 *  llamadores comparan y le pasan el resultado. */
export function OrdenIcono({ activo, direccion }: { activo: boolean; direccion: 'asc' | 'desc' }) {
  if (!activo) return <ArrowUpDown size={10} className="inline ml-0.5 text-gray-300" aria-hidden="true" />
  if (direccion === 'asc') return <ArrowUp size={10} className="inline ml-0.5 text-accent" aria-hidden="true" />
  return <ArrowDown size={10} className="inline ml-0.5 text-accent" aria-hidden="true" />
}
