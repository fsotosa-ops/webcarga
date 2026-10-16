'use client'

import { Suspense, use, useEffect } from 'react'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { dominioPorClave, puedeVerArea, rutaDeSeccion } from '../dominios'

/** `/settings/[area]`: lleva a una sección (Configuración, Parte 1). Atiende los
 *  enlaces viejos `?section=<s>[&estado=<id>]`: la sección pasa a la ruta y el
 *  elemento abierto, a `?item=`; `?doc=` de Condiciones se conserva. */
export default function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area: clave } = use(params)
  const area = dominioPorClave(clave)
  const { permissions } = useAcceso()
  if (!area || !puedeVerArea(area, permissions)) notFound()
  return <Suspense fallback={null}><Redirigir area={area!.clave} primera={area!.secciones[0].clave} /></Suspense>
}

function Redirigir({ area, primera }: { area: string; primera: string }) {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const sp = new URLSearchParams(params.toString())
    const seccion = sp.get('section') ?? primera
    sp.delete('section')
    const estado = sp.get('estado')
    if (estado) { sp.delete('estado'); sp.set('item', estado) }
    const resto = sp.toString()
    router.replace(`${rutaDeSeccion(area, seccion)}${resto ? `?${resto}` : ''}`)
  }, [router, params, area, primera])
  return null
}
