'use client'

import Link from 'next/link'
import { User, Truck } from 'lucide-react'
import type { DirectorioBusqueda } from '@/lib/types'

/**
 * Los conductores y los vehículos que coinciden con lo que se buscó.
 *
 * POR QUÉ EXISTE. El Directorio buscaba sólo por nombre o RUT de empresa:
 * escribir "Pardo" —un conductor que existe— devolvía "Sin resultados, 0
 * empresas", y la patente igual. La búsqueda por conductor y por vehículo sí
 * existía, pero en Certificación, que es el módulo documental: ahí no se puede
 * dar de baja a nadie ni moverlo de empresa. Pablo, 04/09: *"si yo tengo un
 * conductor acá y lo quiero ir a buscar aquí, no puedo, pero la empresa sí me
 * lo permite"*.
 *
 * Cada fila lleva al panel de esa persona o de ese equipo YA ABIERTO, con
 * `?driver=`/`?asset=` — dos parámetros que la ficha ya sabía leer desde antes
 * y a los que no apuntaba nadie. Antes había que adivinar la empresa, entrar,
 * ir a la pestaña y abrir la tarjeta: seis clics, y sólo si sabías de quién
 * era.
 *
 * El RUT va en la fila y no adentro del panel a propósito: es el dato con el
 * que se decide cuál de dos conductores duplicados se queda, y estaba en un
 * solo lugar de toda la app.
 */
export function ResultadosDelDirectorio({ datos }: { datos: DirectorioBusqueda }) {
  const { conductores, vehiculos } = datos
  if (!conductores.length && !vehiculos.length) return null

  return (
    <div className="space-y-3">
      <Grupo titulo="Conductores" icono={<User size={12} />} cantidad={conductores.length}>
        {conductores.map(c => (
          <Fila
            key={c.id}
            href={c.carrier_id ? `/dashboard/carriers/${c.carrier_id}?tab=conductores&driver=${c.id}` : null}
            principal={c.full_name}
            secundario={c.tax_id}
            empresa={c.carrier_name}
            deBaja={c.operational_status !== 'ACTIVE'}
          />
        ))}
      </Grupo>

      <Grupo titulo="Vehículos" icono={<Truck size={12} />} cantidad={vehiculos.length}>
        {vehiculos.map(v => (
          <Fila
            key={v.id}
            href={v.carrier_id ? `/dashboard/carriers/${v.carrier_id}?tab=equipos&asset=${v.id}` : null}
            principal={v.license_plate}
            secundario={v.webcarga_operation_type_label ?? 'Sin tipo de operación'}
            empresa={v.carrier_name}
            deBaja={v.operational_status !== 'ACTIVE'}
          />
        ))}
      </Grupo>
    </div>
  )
}

function Grupo({
  titulo, icono, cantidad, children,
}: {
  titulo: string
  icono: React.ReactNode
  cantidad: number
  children: React.ReactNode
}) {
  if (!cantidad) return null
  return (
    <section className="bg-white border border-border rounded-2xl overflow-hidden">
      <h2 className="flex items-center gap-1.5 text-etiqueta font-bold text-informativo uppercase tracking-wide px-4 py-2.5 border-b border-border/60">
        {icono} {titulo} <span className="font-normal">({cantidad})</span>
      </h2>
      <ul className="divide-y divide-border/60">{children}</ul>
    </section>
  )
}

function Fila({
  href, principal, secundario, empresa, deBaja,
}: {
  href:       string | null
  principal:  string
  secundario: string | null
  empresa:    string | null
  deBaja:     boolean
}) {
  const contenido = (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-dato font-semibold text-text-primary truncate">{principal}</p>
        {secundario && <p className="text-etiqueta text-informativo font-mono truncate">{secundario}</p>}
      </div>
      {deBaja && (
        <span className="text-etiqueta font-semibold px-1.5 py-0.5 rounded-full border border-border text-informativo shrink-0">
          Dado de baja
        </span>
      )}
      <p className="text-etiqueta text-informativo truncate max-w-[45%] text-right">
        {/* Sin empresa no hay ficha donde abrirlo, y decirlo es más honesto que
            un link que lleva a una lista vacía. Son las personas que el
            pre-cierre propone vincular. */}
        {empresa ?? 'sin empresa'}
      </p>
    </div>
  )
  if (!href) return <li className="opacity-70">{contenido}</li>
  return (
    <li>
      <Link href={href} className="block hover:bg-bg-main transition-colors">{contenido}</Link>
    </li>
  )
}
