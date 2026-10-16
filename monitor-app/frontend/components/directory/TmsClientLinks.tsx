'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Shipper } from '@/lib/api/locations'
import { tmsClientsApi } from '@/lib/api/tmsClients'
import type { TmsClient } from '@/lib/types'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { clientKeys, invalidateClients } from '@/lib/queries/clientes'
import { useClients } from '@/hooks/useClients'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { Estado } from '@/components/ui/Estado'
import { INPUT } from '@/app/dashboard/admin/settings/shared'

type Props =
  /** Directorio › Clientes, vista "Nombres del TMS sin vincular": tabla. */
  | { unlinked: true; shipperId?: never }
  /** La ficha de un cliente, al costado: lista compacta. */
  | { shipperId: string; unlinked?: never }

const viajes = (n: number) => n.toLocaleString('es-CL')

/**
 * Cómo llama cada TMS a cada cliente del directorio (spec 2026-10-11). El
 * pipeline lo lee para guardar en cada viaje el id de su cliente; un nombre
 * nuevo del TMS aparece solo, sin vincular. Cambiar un vínculo ya hecho mueve
 * todos sus viajes: se confirma en la fila antes de escribir, y el backend lo
 * audita. Con `commercial.edit` se vincula; sin él, se lee.
 */
export function TmsClientLinks(props: Props) {
  const params = props.unlinked ? { unlinked: true } : { shipper_id: props.shipperId }
  const qc = useQueryClient()
  const puedeEditar = usePermiso('commercial.edit')
  const lista = useQuery({ queryKey: clientKeys.tmsLinks(params), queryFn: () => tmsClientsApi.list(params) })
  const directorio = useClients()
  const [aplicados, setAplicados] = useState<Set<string>>(new Set())
  const [porConfirmar, setPorConfirmar] = useState<{ id: string; shipperId: string } | null>(null)
  const vinculo = useMutation({
    mutationFn: ({ c, shipperId }: { c: TmsClient; shipperId: string }) => tmsClientsApi.vincular(c.source_client_id, shipperId),
    onSuccess: (_r, { c }) => {
      setAplicados(a => new Set(a).add(c.source_client_id))
      return invalidateClients(qc)
    },
  })

  // Sin el directorio, los selectores quedarían en blanco aunque el nombre esté
  // vinculado: se espera a las dos listas.
  if (lista.isError || directorio.isError) {
    return <Estado tipo="error" titulo="No se pudieron cargar los nombres del TMS" />
  }
  if (lista.isPending || directorio.isPending) return <Estado tipo="cargando" />

  // El backend rechaza vincular un cliente inactivo.
  const activos = directorio.data.filter(s => s.status === 'ACTIVE')
  const filas = lista.data

  if (filas.length === 0) {
    return props.unlinked
      ? <Estado tipo="vacio" titulo="Todos los nombres del TMS tienen cliente" />
      : <Estado tipo="vacio" titulo="Ningún TMS nombra todavía a este cliente"
          detalle="Se vinculan desde Clientes › Nombres del TMS sin vincular." />
  }

  function elegir(c: TmsClient, shipperId: string) {
    if (!shipperId || shipperId === c.shipper_id) return
    if (c.shipper_id) setPorConfirmar({ id: c.source_client_id, shipperId })
    else vincular(c, shipperId)
  }
  function vincular(c: TmsClient, shipperId: string) {
    setPorConfirmar(null)
    vinculo.mutate({ c, shipperId })
  }

  const control = (c: TmsClient) => (
    <VinculoDeLaFila
      c={c} activos={activos} puedeEditar={puedeEditar}
      pendiente={porConfirmar?.id === c.source_client_id ? porConfirmar.shipperId : null}
      guardando={vinculo.isPending && vinculo.variables?.c.source_client_id === c.source_client_id}
      error={vinculo.isError && vinculo.variables?.c.source_client_id === c.source_client_id ? vinculo.error.message : null}
      aplicado={aplicados.has(c.source_client_id)}
      onElegir={id => elegir(c, id)} onConfirmar={id => vincular(c, id)} onCancelar={() => setPorConfirmar(null)}
    />
  )

  if (props.shipperId) {
    return (
      <ul className="divide-y divide-border/60">
        {filas.map(c => (
          <li key={c.source_client_id} className="py-2 space-y-1">
            <p className="font-semibold text-text-primary">{c.source_client}</p>
            <p className="text-etiqueta text-informativo">{c.source_system} · {viajes(c.trips)} viajes</p>
            {control(c)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-dato text-informativo">
        Cada TMS escribe el cliente a su manera. Aquí se dice a qué cliente del directorio corresponde,
        y el Monitor, el Cierre y el Reporte lo muestran con ese nombre. Mientras no tenga cliente,
        sus viajes no quedan bajo ningún cliente en los filtros.
      </p>
      <div className="bg-white rounded-2xl border border-border overflow-x-auto">
        <table className="w-full text-dato">
          <thead>
            <tr className="border-b border-border bg-bg-main">
              <th scope="col" className={CABECERA}>TMS</th>
              <th scope="col" className={CABECERA}>Nombre en el TMS</th>
              <th scope="col" className={`${CABECERA} text-right`}>Viajes</th>
              <th scope="col" className={CABECERA}>Cliente del directorio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filas.map(c => (
              <tr key={c.source_client_id}>
                <td className="px-3 py-2.5 text-informativo">{c.source_system}</td>
                <td className="px-3 py-2.5 font-semibold text-text-primary">{c.source_client}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{viajes(c.trips)}</td>
                <td className="px-3 py-2.5">{control(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** El vínculo de un nombre del TMS: el selector (o el cliente, sin permiso), la
 *  confirmación al cambiar un vínculo ya hecho, el aviso y el error de la fila. */
function VinculoDeLaFila({ c, activos, puedeEditar, pendiente, guardando, error, aplicado, onElegir, onConfirmar, onCancelar }: {
  c: TmsClient; activos: Shipper[]; puedeEditar: boolean; pendiente: string | null; guardando: boolean
  error: string | null; aplicado: boolean
  onElegir: (shipperId: string) => void; onConfirmar: (shipperId: string) => void; onCancelar: () => void
}) {
  if (!puedeEditar) return <span className="text-informativo">{c.shipper_name ?? 'Sin vincular'}</span>
  return (
    <div className="space-y-1">
      <select
        aria-label={`Cliente del directorio para ${c.source_client}`}
        value={pendiente ?? c.shipper_id ?? ''}
        disabled={guardando}
        onChange={e => onElegir(e.target.value)}
        className={INPUT}
      >
        {!c.shipper_id && <option value="">Elige el cliente</option>}
        {/* Vinculado a un cliente desactivado: se dice, y se puede mover a uno activo. */}
        {c.shipper_id && !activos.some(s => s.id === c.shipper_id) && (
          <option value={c.shipper_id} disabled>{c.shipper_name} (inactivo)</option>
        )}
        {activos.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {pendiente && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-etiqueta text-text-primary">
          <span>
            ¿Pasar «{c.source_client}» y sus {viajes(c.trips)} viajes a {activos.find(s => s.id === pendiente)?.name ?? 'otro cliente'}?
          </span>
          <button type="button" onClick={() => onConfirmar(pendiente)} className="font-semibold text-accent hover:underline">
            Confirmar
          </button>
          <button type="button" onClick={onCancelar} className="font-semibold text-informativo hover:underline">
            Cancelar
          </button>
        </div>
      )}
      {aplicado && !error && (
        <p className="text-etiqueta text-informativo">Se aplicará a sus viajes en la próxima actualización</p>
      )}
      {error && <p role="alert" className="text-etiqueta text-status-incidente">{error}</p>}
    </div>
  )
}
