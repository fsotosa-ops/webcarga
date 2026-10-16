'use client'

import { useQuery } from '@tanstack/react-query'
import { refetchWhilePending } from '@/components/dashboard/AvisoDeActualizacion'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi } from '@/lib/api/equipmentClosures'

/** Las dos respuestas del día que alimentan la Flota del día y el resumen del
 *  alcance (`lib/cierre/dayFleet.ts`). La página y la sección lo llaman con la
 *  misma fecha: comparten la caché, así que no hay un segundo pedido. Mientras el
 *  día tiene un recálculo pendiente, se vuelven a pedir (spec 2026-10-10). */
export function useDayFleet(fecha: string) {
  const conductores = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
    refetchInterval: refetchWhilePending,
  })
  const tractos = useQuery({
    queryKey: ['equipment-closures', fecha],
    queryFn: () => equipmentClosuresApi.get(fecha),
    refetchInterval: refetchWhilePending,
  })
  return {
    drivers: conductores.data,
    equipment: tractos.data,
    isPending: conductores.isPending || tractos.isPending,
    isError: conductores.isError || tractos.isError,
    conductores,
  }
}
