'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { NavDominios } from './NavDominios'

/** La pantalla de un area de Configuracion que no existe.
 *
 *  Sin esto, `/dashboard/admin/settings/facturacion` caia en el 404 pelado de
 *  Next: sin la app alrededor y sin vuelta a ningun lado. Importa porque
 *  `facturacion` es justo lo que teclea quien recuerda las rutas viejas en
 *  espanol —los slugs son en ingles desde la normalizacion de rutas— y porque
 *  Facturacion aparece listada, reservada, en la portada.
 *
 *  Reusa `NavDominios`: la salida no es solo "volver", es la lista de las
 *  areas que si existen. `activo` va vacio a proposito — ninguna lo esta. */
export default function AreaNoEncontrada() {
  return (
    <div className="p-4 md:p-6 flex-1 overflow-y-auto">
      <Link
        href="/dashboard/admin/settings"
        prefetch={false}
        className="inline-flex items-center gap-1 text-[11px] text-accion hover:underline"
      >
        <ChevronLeft size={13} aria-hidden="true" />
        Configuración
      </Link>

      <h1 className="font-mulish font-bold text-xl text-text-primary mt-1">
        Esa área de Configuración no existe
      </h1>
      <p className="text-xs text-gray-400 mt-0.5">
        La dirección no corresponde a ninguna área. Elige una de las que hay.
      </p>

      <div className="mt-5 bg-white border border-border rounded-2xl p-4 min-h-[calc(100vh-14rem)]">
        <NavDominios activo="" />
      </div>
    </div>
  )
}
