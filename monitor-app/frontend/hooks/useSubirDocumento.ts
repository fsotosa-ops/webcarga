'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { complianceApi } from '@/lib/api/compliance'
import { invalidarCertificacion } from '@/lib/queries/certificacion'

/** Subir un documento a su requisito. **Una sola implementación.**
 *
 *  La consumen el cajón de Certificación y la ficha legacy (`DocumentChecklist`
 *  vía `DriverDetailPanel` / `VehicleDetailPanel`). Antes cada una llamaba a
 *  la puerta de la Bandeja por su cuenta, y ahí está el defecto
 *  que esto cierra: esa puerta **sube primero y clasifica después**, así que un
 *  rechazo —típicamente el 422 por falta de fecha de vencimiento— dejaba el
 *  archivo huérfano en la bandeja y el requisito vacío. El usuario veía "no
 *  pasó nada".
 *
 *  Dos implementaciones de "subir un documento a un requisito" es exactamente
 *  cómo este módulo terminó con dos caminos de carga que se estorbaban. Si hace
 *  falta subir desde una pantalla nueva, se consume este hook.
 *
 *  **El error se propaga a propósito**: quien llamó es el que sabe dónde
 *  mostrarlo. `RenglonPendiente` lo pinta dentro de su propia fila, conservando
 *  el archivo para reintentar; un mensaje global no diría de cuál de los 91
 *  renglones está hablando. */
export function useSubirDocumento() {
  const queryClient = useQueryClient()

  return useCallback(
    async (recordId: string, archivo: File, vencimiento?: string) => {
      await complianceApi.uploadFile(recordId, archivo, vencimiento)
      // Sólo si salió bien. Invalidar tras un fallo haría refetch de datos que
      // no cambiaron y borraría el estado de la pantalla donde el usuario está
      // por reintentar.
      await invalidarCertificacion(queryClient)
    },
    [queryClient],
  )
}
