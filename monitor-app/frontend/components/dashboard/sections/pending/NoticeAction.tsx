'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CarrierCreateResult } from '@/lib/api/carriers'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { NewCarrierPanel } from '../../NewCarrierPanel'
import { AltaDeFlota } from '@/components/dashboard/AltaDeFlota'
import { VincularConductorPropuesto } from '../VincularConductorPropuesto'
import type { Notice } from '@/lib/cierre/closureNotices'
import { invalidateDirectory, type DirectoryChange } from '@/lib/queries/directorio'
import { assetHref, carrierHref, driverHref } from '@/lib/navegacion/directory'

const ENLACE = 'text-etiqueta font-semibold text-accion hover:underline'

/** La acción de un aviso de Pendientes, en su fila (crear, vincular, dar de alta, ir a
 *  la ficha); cada una con el permiso de su endpoint (bloque 0, 0.3): crear, vincular y
 *  dar de alta piden directory.edit. Activar o reactivar una empresa ya no se hace desde
 *  el Cierre (28/10): la habilita Certificación, desde su ficha. */
export function NoticeAction({ notice, fecha }: { notice: Notice; fecha: string }) {
  const queryClient = useQueryClient()
  async function onChanged(change: DirectoryChange) {
    await invalidateDirectory(queryClient, change)
    // Esta pantalla ES el Cierre: se relee ya, para traer `pendiente_desde` y que el
    // aviso y la relectura de 15 s arranquen (0.6). Desde otras pantallas el Cierre
    // solo queda marcado viejo (R9).
    await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
  }
  const canEditDirectory = usePermiso('directory.edit')
  const noPermission = <p className="text-etiqueta text-informativo">Lo resuelve un supervisor desde el Directorio.</p>

  switch (notice.type) {
    case 'CONDUCTOR_SIN_EMPRESA': {
      const s = notice.source
      return canEditDirectory ? (
        <VincularConductorPropuesto driverId={s.driver_id} carrierId={s.carrier_id} carrierName={s.carrier_name}
          onVinculado={() => onChanged({ entity: 'driver', id: s.driver_id, type: 'assignment', carrierIds: [s.carrier_id] })} />
      ) : noPermission
    }
    case 'PATENTE_NO_REGISTRADA':
      return canEditDirectory ? <CrearEmpresa tmsCarrierName={notice.source.tms_carrier_name ?? null} onChanged={onChanged} /> : noPermission
    case 'EMPRESA_ONBOARDING':
      // Habilita quien califica, no quien despacha (28/10): en su ficha, Certificación la
      // activa desde este día; si el viaje tenía mal la flota, se corrige en el viaje.
      return (
        <a href={carrierHref(notice.source.carrier_id)} target="_blank" className={ENLACE}>
          Abrir su ficha
        </a>
      )
    case 'LEFT_DAY_POPULATION': {
      // Para revisar, no para resolver aquí: la ficha dice por qué salió y desde cuándo.
      const s = notice.source
      return (
        <a href={s.subject_type === 'DRIVER' ? driverHref(s.subject_id) : assetHref(s.subject_id)} target="_blank"
          className={ENLACE}>
          Abrir su ficha
        </a>
      )
    }
    case 'SIN_TIPO_OPERACION':
      return <a href={`/dashboard/carriers/${notice.source.carrier_id}?tab=equipos`} target="_blank" className={ENLACE}>Ir a la ficha de la empresa</a>
    case 'OPERATION_TYPE_CONFLICT':
      // Lo más común es un tracto mal clasificado (P5 de Operaciones): se corrige en su
      // ficha. Si el viaje fue la excepción, su tipo se cambia desde el viaje (sus
      // números están en la fila).
      return (
        <a href={assetHref(notice.source.asset_id)} target="_blank" className={ENLACE}>
          Revisar el tipo de {notice.source.tractor_plate}
        </a>
      )
    case 'EMPRESA_NO_RECONOCIDA':
      // Derecho a la ficha que el directorio tiene para esa patente, pestaña Equipos:
      // es donde se corrige (el buscador de empresas no busca por patente).
      return (
        <a href={`/dashboard/carriers/${notice.source.directory_carrier_id}?tab=equipos`} target="_blank" className={ENLACE}>
          Revisar {notice.source.tractor_plate} en {notice.source.directory_carrier_name}
        </a>
      )
    case 'CONDUCTOR_NO_REGISTRADO': {
      const s = notice.source
      // Un RUT que ni siquiera es un RUT no tiene a quién dar de alta: se reclama al TMS.
      if (s.reason) return <span className="text-informativo">—</span>
      return canEditDirectory ? (
        <AltaDeFlota tipo="conductor" carrierId={null} rutFijo={s.driver_rut} prefill={s.driver_name_tms ?? undefined}
          etiqueta="Dar de alta a este conductor"
          onCreado={carrierId => onChanged({ entity: 'driver', type: 'create', carrierIds: [carrierId] })}
          // Un 409 solo ocurre si alguien lo registró con esta pantalla abierta: no hay
          // nada que asignar; releer el cierre hace desaparecer el aviso.
          yaExiste={{
            accion: () => 'Ya está registrado: actualizar el cierre',
            usar: existente => onChanged({ entity: 'driver', id: existente.driver_id, type: 'update' }),
          }} />
      ) : noPermission
    }
    case 'FLEET_DRIVER_GAP':
      // Se resuelve con el transportista, no con una acción del sistema.
      return <span className="text-informativo">Operaciones lo gestiona con la empresa</span>
  }
}

function CrearEmpresa({ tmsCarrierName, onChanged }: { tmsCarrierName: string | null; onChanged: (c: DirectoryChange) => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  if (!abierto) return <button type="button" onClick={() => setAbierto(true)} className={ENLACE}>Crear empresa nueva</button>
  return (
    <NewCarrierPanel open initialBusinessName={tmsCarrierName ?? undefined} onClose={() => setAbierto(false)}
      onCreated={(carrier: CarrierCreateResult) => {
        setAbierto(false)
        void onChanged({ entity: 'carrier', id: carrier.id, type: 'create' })
        // La empresa queda creada; asignarle la patente pide que el activo exista en
        // public.assets (a veces no): se completa desde la ficha.
        window.open(`/dashboard/carriers/${carrier.id}?tab=equipos`, '_blank')
      }} />
  )
}
