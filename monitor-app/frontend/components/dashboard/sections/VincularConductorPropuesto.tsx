'use client'

import { useState } from 'react'
import { Loader2, Link2 } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { ApiError } from '@/lib/api/client'

interface Props {
  driverId:    string
  driverName:  string
  carrierId:   string
  carrierName: string
  viajes:      number
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
export function VincularConductorPropuesto({
  driverId, driverName, carrierId, carrierName, viajes, onVinculado,
}: Props) {
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

  return (
    <div className="rounded-xl border border-border bg-accent/5 px-4 py-3 space-y-2">
      <p className="text-xs text-text-primary">
        <span className="font-semibold">{driverName}</span> manejó{' '}
        {viajes === 1 ? 'un viaje' : `${viajes} viajes`} con un tracto de{' '}
        <span className="font-semibold">{carrierName}</span> y no tiene empresa asignada.
        {/* Sin empresa no entra al roster del cierre: decir la consecuencia es
            lo que hace que valga la pena apretar el boton. */}{' '}
        Sin empresa no aparece en el cierre del día.
      </p>

      {error && <p className="text-[11px] text-status-incidente">{error}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={guardando}
          onClick={vincular}
          className="text-[11px] font-semibold bg-accent text-white rounded-lg px-2 py-1 disabled:opacity-50 flex items-center gap-1"
        >
          {guardando ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
          {guardando ? 'Vinculando…' : `Asignar a ${carrierName}`}
        </button>
        {/* La salida cuando la propuesta esta equivocada. No se ofrece un
            segundo desplegable aca: elegir OTRA empresa es el mismo gesto que
            ya vive en Certificacion, y duplicarlo daria dos lugares para la
            misma decision. */}
        <a
          href="/dashboard/compliance?vista=conductores"
          target="_blank"
          className="text-[11px] font-semibold text-accent hover:underline"
        >
          Es otra empresa
        </a>
      </div>
    </div>
  )
}
