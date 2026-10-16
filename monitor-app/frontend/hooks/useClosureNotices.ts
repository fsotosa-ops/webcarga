'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { refetchWhilePending } from '@/components/dashboard/AvisoDeActualizacion'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { carriersApi } from '@/lib/api/carriers'
import { buildNotices, type Notice } from '@/lib/cierre/closureNotices'
import { inScope } from '@/lib/cierre/scope'
import type { ClosureScope } from '@/lib/types'

/** Los avisos de Pendientes del alcance (D6): los del pre-cierre y el desbalance de
 *  dotación. La página los cuenta en la pestaña y la sección los dibuja: los dos leen
 *  de aquí, así que el número y la tabla no pueden decir cosas distintas. El
 *  pre-cierre viaja en `/daily-closures` (misma clave que la Flota: no hay otro pedido). */
export function useClosureNotices(fecha: string, alcance: ClosureScope) {
  const cierre = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
    refetchInterval: refetchWhilePending,
  })
  const dotacion = useQuery({
    queryKey: ['fleet-driver-gap'],
    queryFn: () => carriersApi.fleetDriverGap(),
  })
  const preCierre = cierre.data?.pre_cierre ?? null
  const notices = useMemo<Notice[] | null>(
    () => (preCierre
      ? buildNotices(preCierre.escalations, dotacion.data?.rows).filter(n => inScope(n.scope, alcance))
      : null),
    [preCierre, dotacion.data, alcance],
  )
  return {
    /** `null` mientras carga o con el día firmado (un día firmado no corre el pre-cierre). */
    notices,
    autoResolved: preCierre?.auto_resolved ?? [],
    closed: !!cierre.data && !preCierre,
    isPending: cierre.isPending,
  }
}
