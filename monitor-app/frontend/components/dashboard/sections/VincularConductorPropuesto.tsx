'use client'

import { useState } from 'react'
import { Loader2, Link2 } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { ApiError } from '@/lib/api/client'
import { Button, buttonClass } from '@/components/ui/Button'

interface Props {
  driverId:    string
  carrierId:   string
  carrierName: string
  onVinculado: () => Promise<void> | void
}

/**
 * Confirmar la empresa que el pre-cierre propone para un conductor que no tiene.
 *
 * POR QUÉ EXISTE. Es el caso Gerson Ferrada, el que Pablo marcó con estrella en
 * la minuta del 25/08, y el problema estructural detrás: el cierre por
 * conductor recorre el PADRÓN (`driver_assignments`, quién figura) mientras el
 * viaje resuelve el conductor por el HECHO (lo que reporta el TMS). Nada los
 * reconciliaba, así que el cierre mostraba al conductor de papel como no
 * asignado y al que efectivamente manejó no lo mostraba en absoluto.
 *
 * **La app propone y una persona confirma.** El backend sólo propone cuando el
 * padrón está en silencio —el conductor no tiene ninguna asignación activa— y
 * cuando todos sus viajes del día apuntan a la misma empresa. Nunca cuando hay
 * una asignación que diga otra cosa: una inferencia llena un silencio, no
 * contradice un dato que alguien cargó a mano.
 *
 * **Y confirmar acá es la sincronización con Certificación**, no un paso
 * aparte: lo que se escribe es `driver_assignments`, que es exactamente la
 * tabla que Certificación lee para saber de quién es cada conductor.
 */
export function VincularConductorPropuesto({ driverId, carrierId, carrierName, onVinculado }: Props) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function vincular() {
    setGuardando(true)
    setError(null)
    try {
      await carriersApi.assignDriver(carrierId, driverId)
      await onVinculado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo vincular al conductor')
    } finally {
      setGuardando(false)
    }
  }

  // Lo que pasa y lo que cuesta (sin empresa no aparece en el cierre) lo dice el
  // Detalle de la fila de Pendientes; aquí queda la decisión.
  return (
    <div className="space-y-1.5">
      {error && <p className="text-etiqueta text-status-incidente">{error}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="primary" size="sm" disabled={guardando} onClick={vincular}>
          {guardando ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : <Link2 size={11} aria-hidden="true" />}
          {guardando ? 'Vinculando…' : `Asignar a ${carrierName}`}
        </Button>
        {/* La salida cuando la propuesta esta equivocada. No se ofrece un
            segundo desplegable aca: elegir OTRA empresa es el mismo gesto que
            ya vive en Certificacion, y duplicarlo daria dos lugares para la
            misma decision. */}
        <a
          href="/dashboard/compliance?vista=conductores"
          target="_blank"
          className={buttonClass({ variant: 'link', size: 'sm' })}
        >
          Es otra empresa
        </a>
      </div>
    </div>
  )
}
