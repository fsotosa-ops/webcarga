'use client'

import type { ReactNode } from 'react'

/** Una fila de la lista: el texto que identifica el caso y, cuando existe, a
 *  dónde ir a resolverlo. */
export type ItemPendiente = {
  clave: string
  texto: string
  href?: string
}

/**
 * Los que bloquean el cierre, con nombre.
 *
 * POR QUÉ EXISTE. Es la misma lección de `SinFlotaList`, aplicada a las otras
 * dos listas que el backend mandaba y la pantalla tiraba: `detail.pending` del
 * 409 de conductores (con nombre y estado) y el de equipos (con patente y
 * empresa). El coordinador leía "15 equipo(s) sin resolver — no se puede
 * cerrar el día" y no tenía forma de saber cuáles eran los quince. Pablo,
 * 04/09: *"cuál es el listado de estos 15 equipos sin resolver, ni hay un
 * detalle"*.
 *
 * Se escribe una vez y la usan las dos listas: cambia el título, el icono y
 * cómo se arma cada frase — una variante es una prop, no un componente
 * hermano.
 */
export function PendientesDelCierre({
  titulo, icono, items,
}: {
  titulo: string
  icono:  ReactNode
  items:  ItemPendiente[]
}) {
  if (!items.length) return null
  return (
    <div className="mt-2">
      <p className="text-etiqueta font-semibold text-status-incidente flex items-center gap-1">
        {icono} {titulo} ({items.length})
      </p>
      <ul className="mt-1 space-y-0.5 text-etiqueta text-status-incidente list-disc list-inside">
        {items.map(i => (
          <li key={i.clave}>
            {i.href
              ? <a href={i.href} className="underline hover:no-underline">{i.texto}</a>
              : i.texto}
          </li>
        ))}
      </ul>
    </div>
  )
}
