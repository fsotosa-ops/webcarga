'use client'

import { Suspense, use, useEffect } from 'react'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { dominioPorClave, primeraEditable, puedeVerArea, rutaDeSeccion, seccionesVisibles } from '../dominios'

/** `/settings/[area]`: lleva a una sección (Configuración, Parte 1). Atiende los
 *  enlaces viejos `?section=<s>[&estado=<id>]`: la sección pasa a la ruta y el
 *  elemento abierto, a `?item=`; `?doc=` de Condiciones se conserva. */
export default function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area: clave } = use(params)
  const area = dominioPorClave(clave)
  const { permissions } = useAcceso()
  if (!area || !puedeVerArea(area, permissions)) notFound()
  return (
    <Suspense fallback={null}>
      <Redirigir area={area!.clave} primera={primeraEditable(area!, permissions)!.clave}
                 validas={seccionesVisibles(area!, permissions).map(s => s.clave)} />
    </Suspense>
  )
}

function Redirigir({ area, primera, validas }: { area: string; primera: string; validas: string[] }) {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const sp = new URLSearchParams(params.toString())
    // Una sección que no existe (o que no puede leer) cae en la primera editable.
    const pedida = sp.get('section')
    const seccion = pedida && validas.includes(pedida) ? pedida : primera
    sp.delete('section')
    const estado = sp.get('estado')
    if (estado) { sp.delete('estado'); sp.set('item', estado) }
    const resto = sp.toString()
    router.replace(`${rutaDeSeccion(area, seccion)}${resto ? `?${resto}` : ''}`)
  }, [router, params, area, primera, validas])
  return null
}
