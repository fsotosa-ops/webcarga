'use client'

import { Suspense, use, useEffect } from 'react'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { destinoMudado, dominioPorClave, primeraEditable, puedeVerArea, rutaDeSeccion, seccionesVisibles } from '../dominios'

/** `/settings/[area]`: lleva a una sección (Configuración, Parte 1). Atiende los
 *  enlaces viejos `?section=<s>[&estado=<id>]`: la sección pasa a la ruta y el
 *  elemento abierto, a `?item=`. Una sección
 *  que se mudó fuera de Configuración (Parte 3) lleva a su lugar nuevo antes de
 *  mirar el área: quien la usaba puede ya no ver ninguna sección de esa área. */
export default function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area: clave } = use(params)
  return <Suspense fallback={null}><Redirigir clave={clave} /></Suspense>
}

function Redirigir({ clave }: { clave: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const { permissions } = useAcceso()
  const mudada = destinoMudado(clave, params.get('section'), params.get('doc'))
  const area = dominioPorClave(clave)
  const visible = !!area && puedeVerArea(area, permissions)
  const destino = mudada ?? (visible ? destinoEnElArea(clave, params, area!, permissions) : null)
  useEffect(() => { if (destino) router.replace(destino) }, [router, destino])
  if (!destino) notFound()
  return null
}

function destinoEnElArea(
  clave: string, params: URLSearchParams,
  area: NonNullable<ReturnType<typeof dominioPorClave>>, permissions: readonly string[],
): string {
  const sp = new URLSearchParams(params.toString())
  // Una sección que no existe (o que no puede leer) cae en la primera editable.
  const validas = seccionesVisibles(area, permissions).map(s => s.clave)
  const pedida = sp.get('section')
  const seccion = pedida && validas.includes(pedida) ? pedida : primeraEditable(area, permissions)!.clave
  sp.delete('section')
  const estado = sp.get('estado')
  if (estado) { sp.delete('estado'); sp.set('item', estado) }
  const resto = sp.toString()
  return `${rutaDeSeccion(clave, seccion)}${resto ? `?${resto}` : ''}`
}
