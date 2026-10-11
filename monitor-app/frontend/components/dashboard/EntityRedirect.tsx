'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Estado } from '@/components/ui/Estado'
import { entitySummaryKey, fetchEntitySummary } from '@/lib/api/entitySummary'
import { carrierPanelHref, returnLink } from '@/lib/navegacion/directory'

const NOUN = { driver: 'conductor', asset: 'equipo' } as const

/** La dirección canónica de un conductor o de un equipo (`/dashboard/drivers/[id]`,
 *  `/dashboard/assets/[id]`): pregunta su empresa y abre su panel en la ficha de la
 *  empresa, que es donde vive su detalle. Sin pantalla propia (HU 20261011/01). */
export function EntityRedirect({ kind, id }: { kind: 'driver' | 'asset'; id: string }) {
  const router = useRouter()
  const returnTo = returnLink(useSearchParams().get('next'))?.href
  const query = useQuery({
    queryKey: entitySummaryKey(kind, id),
    queryFn: () => fetchEntitySummary(kind, id),
    retry: false,
  })
  const carrierId = query.data?.carrier?.id

  useEffect(() => {
    if (carrierId) router.replace(carrierPanelHref(carrierId, { kind, id }, returnTo))
  }, [carrierId, kind, id, returnTo, router])

  if (query.isError) {
    const notFound = (query.error as { status?: number }).status === 404
    return notFound
      ? <Estado tipo="vacio" titulo="No se encontró en el directorio">
          <Link href="/dashboard/carriers" className="text-dato font-semibold text-accion hover:underline">Ir al Directorio</Link>
        </Estado>
      : <Estado tipo="error" titulo={`No se pudo abrir el ${NOUN[kind]}`} detalle="Reintenta en unos segundos." />
  }
  if (query.data && !carrierId) {
    return (
      <Estado tipo="vacio" titulo={`Este ${NOUN[kind]} no está asignado a ninguna empresa`}
              detalle="Su detalle vive en la ficha de una empresa. Asígnalo desde el Directorio.">
        <Link href="/dashboard/carriers" className="text-dato font-semibold text-accion hover:underline">Ir al Directorio</Link>
      </Estado>
    )
  }
  return <Estado tipo="cargando" />
}
