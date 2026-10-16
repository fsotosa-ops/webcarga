'use client'

import { use } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { dominioPorClave, puedeVerArea, seccionesVisibles } from '../../dominios'

/** Una sección de Configuración: su título, su propósito y su panel
 *  (Configuración, Parte 1). El índice vive en el layout; en el teléfono se vuelve
 *  a él con "‹ Configuración". */
export default function SectionPage({ params }: { params: Promise<{ area: string; section: string }> }) {
  const { area: claveArea, section: claveSeccion } = use(params)
  const { permissions } = useAcceso()
  const area = dominioPorClave(claveArea)
  const seccion = area && seccionesVisibles(area, permissions).find(s => s.clave === claveSeccion)
  if (!area || !seccion || !puedeVerArea(area, permissions)) notFound()
  const Panel = seccion!.Panel
  return (
    <div className="space-y-4">
      <Link href="/dashboard/admin/settings" prefetch={false}
            className="inline-flex items-center gap-1 text-etiqueta text-accion hover:underline md:hidden">
        <ChevronLeft size={13} aria-hidden="true" /> Configuración
      </Link>
      <EncabezadoDePagina titulo={seccion!.titulo} bajada={seccion!.proposito} />
      <Panel />
    </div>
  )
}
