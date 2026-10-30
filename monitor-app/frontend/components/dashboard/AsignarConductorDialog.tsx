'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tripsApi } from '@/lib/api/trips'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { Dialog } from '@/components/ui/Dialog'
import { AsignarConductorPopover } from './AsignarConductorPopover'

/** El viaje cuyo conductor se busca: el que el TMS nombró y no se resolvió. */
export type ViajeSinConductor = { id: string; driver_name_tms: string }

/**
 * Asignar el conductor de un viaje a partir del nombre que informó el TMS.
 *
 * Vivía escrito dentro del Monitor (consulta de candidatos, diálogo, "asignar a sus
 * N viajes" y alta). El Cierre lo necesita para "Por regularizar" (30/10), y copiar
 * ese bloque era tener dos emparejamientos que se separan el día que cambie uno:
 * se extrajo. La regla de a quién proponer es la del popover y la del backend
 * (`GET /trips/driver-candidates`), una sola vez.
 *
 * Los candidatos y los viajes REALES de esa persona vienen juntos del backend: el
 * alcance que promete el popover se aplica a los ids que él devuelve, no a un
 * conteo hecho acá sobre lo que una tabla tiene cargado.
 */
export function AsignarConductorDialog({ viaje, onClose, onAsignado }: {
  viaje: ViajeSinConductor | null
  onClose: () => void
  /** Lo que quien aloja tiene que releer además de los viajes (el Cierre, su lista). */
  onAsignado?: () => Promise<void> | void
}) {
  const queryClient = useQueryClient()
  const puedeDarDeAlta = usePermiso('directory.edit')
  const candidatosQuery = useQuery({
    queryKey: ['driver-candidates', viaje?.driver_name_tms],
    queryFn: () => tripsApi.driverCandidates(viaje!.driver_name_tms),
    enabled: Boolean(viaje?.driver_name_tms),
  })

  if (!viaje?.driver_name_tms) return null
  return (
    <Dialog label={`Asignar conductor a ${viaje.driver_name_tms}`} onClose={onClose}
      className="inset-0 m-auto h-fit w-fit animate-modal-in">
      <AsignarConductorPopover
        nombreTms={viaje.driver_name_tms}
        candidatos={candidatosQuery.data?.candidatos ?? []}
        viajesDeLaPersona={candidatosQuery.data?.trip_ids_de_la_persona.length ?? 0}
        cargando={candidatosQuery.isLoading}
        onCancelar={onClose}
        onAsignar={async (driverId, aTodos) => {
          const ids = aTodos ? candidatosQuery.data?.trip_ids_de_la_persona ?? [viaje.id] : [viaje.id]
          const asignado = await tripsApi.assignDriver(driverId, ids)
          await queryClient.invalidateQueries({ queryKey: ['trips'] })
          await onAsignado?.()
          // Con aviso (empresa no habilitada) el popover queda abierto para
          // mostrarlo; "Continuar" lo cierra (D1 §7.1).
          if (asignado.warnings?.length) return asignado.warnings
          onClose()
        }}
        // NO lleva try/catch acá a propósito: la promesa se le devuelve al popover,
        // que es quien tiene el botón y por lo tanto quien puede mostrar el error,
        // apagar el control y ofrecer la salida. `onClose` viene DESPUÉS del await:
        // si la API falla, el popover queda abierto con lo que se escribió.
        // El alta es la común (AltaDeFlota): crea y después llama a onAsignar.
        puedeDarDeAlta={puedeDarDeAlta}
      />
    </Dialog>
  )
}
