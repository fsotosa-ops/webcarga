'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SettingsIndex } from './SettingsIndex'

/** Un área o una sección de Configuración que no existe (o que la persona no
 *  puede ver). Vive dentro del layout del módulo, así que en escritorio el índice
 *  ya está al costado; en el teléfono se dibuja aquí: la salida útil no es solo
 *  "volver", es la lista de lo que sí existe. */
export default function AreaNoEncontrada() {
  return (
    <div className="space-y-4">
      <Link href="/dashboard/admin/settings" prefetch={false}
            className="inline-flex items-center gap-1 text-etiqueta text-accion hover:underline">
        <ChevronLeft size={13} aria-hidden="true" /> Configuración
      </Link>
      <EncabezadoDePagina titulo="Esa sección de Configuración no existe"
                          bajada="La dirección no corresponde a ninguna sección que puedas ver. Elige una de las que hay." />
      <div className="md:hidden"><SettingsIndex /></div>
    </div>
  )
}
