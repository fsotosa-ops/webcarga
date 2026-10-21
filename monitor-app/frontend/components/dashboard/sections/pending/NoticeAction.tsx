'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { carriersApi, type CarrierCreateResult } from '@/lib/api/carriers'
import { lifecycleApi } from '@/lib/api/lifecycle'
import { directoryKeys } from '@/lib/queries/directorio'
import { LifecycleDialog } from '@/components/dashboard/LifecycleDialog'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { NewCarrierPanel } from '../../NewCarrierPanel'
import { AltaDeFlota } from '@/components/dashboard/AltaDeFlota'
import { VincularConductorPropuesto } from '../VincularConductorPropuesto'
import type { Notice } from '@/lib/cierre/closureNotices'
import { invalidateDirectory, type DirectoryChange } from '@/lib/queries/directorio'

const ENLACE = 'text-etiqueta font-semibold text-accion hover:underline'

/** La acción de un aviso de Pendientes, en su fila. Es la de siempre (crear,
 *  activar, vincular, dar de alta, ir a la ficha); cada una con el permiso de su
 *  endpoint (bloque 0, 0.3): crear, vincular y dar de alta piden directory.edit;
 *  activar una empresa en onboarding también, y reactivar una dada de baja es un
 *  cambio de estado que pide directory.delete. */
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
  const canChangeCarrierStatus = usePermiso('directory.delete')
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
    case 'EMPRESA_ONBOARDING': {
      // Una empresa nueva se activa (directory.edit); una dada de baja se reactiva,
      // con motivo y eligiendo su flota (directory.delete). Son acciones distintas.
      const s = notice.source
      if (s.operational_status === 'ONBOARDING' || !s.operational_status) {
        return canEditDirectory ? <ActivarEmpresa carrierId={s.carrier_id} carrierName={s.carrier_name} onChanged={onChanged} /> : noPermission
      }
      return canChangeCarrierStatus ? <ReactivarEmpresa carrierId={s.carrier_id} carrierName={s.carrier_name} onChanged={onChanged} /> : noPermission
    }
    case 'SIN_TIPO_OPERACION':
      return <a href={`/dashboard/carriers/${notice.source.carrier_id}?tab=equipos`} target="_blank" className={ENLACE}>Ir a la ficha de la empresa</a>
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

function ActivarEmpresa({ carrierId, carrierName, onChanged }: {
  carrierId: string; carrierName: string; onChanged: (c: DirectoryChange) => Promise<void>
}) {
  const [activando, setActivando] = useState(false)
  const [error, setError] = useState('')
  const [rut, setRut] = useState('')

  async function activar(cambios: { tax_id?: string } = {}) {
    setActivando(true)
    setError('')
    try {
      await lifecycleApi.activateCarrier(carrierId, cambios)
      await onChanged({ entity: 'carrier', id: carrierId, type: 'update' })
    } catch (e) {
      // El 422 de "falta RUT" llega en dos formas según el endpoint: en vez de parsearla,
      // siempre se ofrece completar el RUT, la única causa realista de un error aquí.
      setError(e instanceof Error ? e.message : 'No se pudo activar la empresa')
    } finally {
      setActivando(false)
    }
  }

  return (
    <span className="flex flex-col items-start gap-1.5">
      {error && (<>
        <span className="text-etiqueta text-status-incidente">{error}</span>
        <span className="flex items-center gap-1.5">
          <input value={rut} onChange={e => setRut(e.target.value)} placeholder="RUT / Tax ID" aria-label={`RUT de ${carrierName}`}
            className="rounded-lg border border-border bg-white px-2 py-1 text-etiqueta" />
          <button type="button" disabled={activando || !rut.trim()}
            onClick={() => activar({ tax_id: rut.trim() })}
            className="rounded-lg bg-accent px-2 py-1 text-etiqueta font-semibold text-white disabled:opacity-50">
            Guardar RUT y activar
          </button>
        </span>
      </>)}
      <button type="button" disabled={activando} onClick={() => activar()} className={`${ENLACE} disabled:opacity-50`}>
        Activar empresa
      </button>
    </span>
  )
}

/** Reactivar una empresa dada de baja desde el pre-cierre: la misma ventana que en su
 *  ficha (motivo y qué flota vuelve), no un atajo sin ellos. La flota se pide al abrir. */
function ReactivarEmpresa({ carrierId, carrierName, onChanged }: {
  carrierId: string; carrierName: string; onChanged: (c: DirectoryChange) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const drivers = useQuery({
    queryKey: directoryKeys.carrierDrivers(carrierId), queryFn: () => carriersApi.listDrivers(carrierId), enabled: abierto,
  })
  const assets = useQuery({
    queryKey: directoryKeys.carrierAssets(carrierId), queryFn: () => carriersApi.listAssets(carrierId), enabled: abierto,
  })
  const listo = abierto && !!drivers.data && !!assets.data
  return (<>
    <button type="button" disabled={abierto && !listo} onClick={() => setAbierto(true)} className={`${ENLACE} disabled:opacity-50`}>
      {abierto && !listo ? 'Cargando su flota…' : 'Reactivar empresa'}
    </button>
    {listo && (
      <LifecycleDialog
        action="reactivate" scope="carrier" label={carrierName}
        fleet={{
          drivers: drivers.data!.map(d => ({ id: d.id, label: d.full_name })),
          assets: assets.data!.map(a => ({ id: a.id, label: a.license_plate })),
        }}
        onClose={() => setAbierto(false)}
        onConfirm={async body => {
          await lifecycleApi.reactivate('carrier', carrierId, body)
          await onChanged({ entity: 'carrier', id: carrierId, type: 'assignment' })
        }}
      />
    )}
  </>)
}
