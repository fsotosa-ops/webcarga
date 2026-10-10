import { Star } from 'lucide-react'
import type { RoleInfo } from '@/lib/api/access'

const VISIBLES = 2

/** Los roles de una persona en su fila (maqueta 09/10). Propietario va
 *  primero y se distingue; desde el tercero se resumen en "+N". */
export default function RolChips({ codes, roles }: { codes: string[]; roles: RoleInfo[] }) {
  if (codes.length === 0) return <span className="text-etiqueta text-informativo">Sin roles</span>
  const nombre = (c: string) => roles.find(r => r.code === c)?.name ?? c
  const orden = [...codes].sort((a, b) => Number(b === 'owner') - Number(a === 'owner'))
  const vistos = orden.slice(0, VISIBLES)
  const resto = orden.slice(VISIBLES)
  return (
    <ul className="flex flex-wrap gap-1">
      {vistos.map(c => (
        <li
          key={c}
          data-propietario={c === 'owner'}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-etiqueta font-semibold whitespace-nowrap ${
            c === 'owner' ? 'bg-text-primary text-white' : 'border border-border bg-bg-main text-text-primary'
          }`}
        >
          {c === 'owner' && <Star size={10} aria-hidden />}
          {nombre(c)}
        </li>
      ))}
      {resto.length > 0 && (
        <li title={resto.map(nombre).join(', ')} className="inline-flex px-2 py-0.5 rounded-full text-etiqueta border border-dashed border-border text-informativo">
          +{resto.length}
        </li>
      )}
    </ul>
  )
}
