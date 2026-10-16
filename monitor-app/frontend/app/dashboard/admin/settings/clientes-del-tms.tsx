'use client'

import { useCallback, useState } from 'react'
import { shippersApi } from '@/lib/api/locations'
import { tmsClientsApi } from '@/lib/api/tmsClients'
import type { TmsClient } from '@/lib/types'
import { INPUT, LoadState, useConfigList, useRowFeedback } from './shared'
import { usePuedeEditarSeccion } from './secciones'

/** Clientes del TMS (spec 2026-10-11): a qué cliente del directorio corresponde
 *  cada cliente de cada TMS. El pipeline la lee para guardar en cada viaje el id
 *  de su cliente; un cliente nuevo del TMS aparece acá solo, sin vincular, y
 *  sus viajes se ven marcados "sin vincular" hasta que alguien lo vincule. */
export function ClientesDelTmsTab() {
  // `useConfigList` mete el fetcher en un useCallback: un arrow inline cambia
  // en cada render y lo haría recargar en bucle.
  const traerClientes = useCallback(() => tmsClientsApi.list(), [])
  const traerDirectorio = useCallback(() => shippersApi.list(), [])
  const { items: clientes, loading, error, reload } = useConfigList<TmsClient>(traerClientes)
  const directorioQuery = useConfigList(traerDirectorio)
  // Solo clientes activos: el backend rechaza vincular uno inactivo.
  const directorio = directorioQuery.items.filter(s => s.status === 'ACTIVE')
  const { errors, saving, run } = useRowFeedback()
  const puedeEditar = usePuedeEditarSeccion('operations/tms-clients')
  const [aplicados, setAplicados] = useState<Set<string>>(new Set())
  // Un cambio sobre un cliente ya vinculado mueve todos sus viajes: se confirma
  // en la fila antes de escribir (revisión final, Importante 5).
  const [porConfirmar, setPorConfirmar] = useState<{ cliente: TmsClient; shipperId: string } | null>(null)

  function elegir(c: TmsClient, shipperId: string) {
    if (!shipperId || shipperId === c.shipper_id) return
    if (c.shipper_id) setPorConfirmar({ cliente: c, shipperId })
    else void vincular(c, shipperId)
  }

  async function vincular(c: TmsClient, shipperId: string) {
    setPorConfirmar(null)
    await run(c.source_client_id, async () => {
      await tmsClientsApi.vincular(c.source_client_id, shipperId)
      setAplicados(a => new Set(a).add(c.source_client_id))
      reload()
    })
  }

  // Sin el directorio, los selectores quedarían en blanco aunque el cliente esté
  // vinculado: se espera a las dos listas.
  if (loading || error || directorioQuery.loading || directorioQuery.error) {
    return (
      <LoadState
        loading={loading || directorioQuery.loading}
        error={error ?? directorioQuery.error}
        onRetry={() => { reload(); directorioQuery.reload() }}
      />
    )
  }

  const sinVincular = clientes.filter(c => !c.shipper_id).length

  return (
    <div className="space-y-4">
      <p className="text-xs text-informativo">
        Cada TMS escribe el cliente a su manera. Acá se dice a qué cliente del directorio corresponde,
        y el Monitor, el Cierre y el Reporte lo muestran con ese nombre.
      </p>

      {sinVincular > 0 && (
        <p role="status" className="text-xs border border-espera/20 bg-espera/5 rounded-lg px-3 py-2 text-text-primary">
          {sinVincular === 1
            ? '1 cliente del TMS sin vincular: sus viajes no quedan bajo ningún cliente en los filtros'
            : `${sinVincular} clientes del TMS sin vincular: sus viajes no quedan bajo ningún cliente en los filtros`}
        </p>
      )}

      {clientes.length === 0 ? (
        <p className="text-xs text-informativo">Todavía no llegan viajes de ningún TMS</p>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                <th className="text-left px-3 py-2">TMS</th>
                <th className="text-left px-3 py-2">Cliente en el TMS</th>
                <th className="text-right px-3 py-2">Viajes</th>
                <th className="text-left px-3 py-2">Cliente del directorio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {clientes.map(c => (
                <tr key={c.source_client_id} className={c.shipper_id ? '' : 'bg-espera/5'}>
                  <td className="px-3 py-2 text-informativo">{c.source_system}</td>
                  <td className="px-3 py-2 font-medium text-text-primary">{c.source_client}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.trips.toLocaleString('es-CL')}</td>
                  <td className="px-3 py-2">
                    {puedeEditar ? (
                      <select
                        aria-label={`Cliente del directorio para ${c.source_client}`}
                        value={porConfirmar?.cliente.source_client_id === c.source_client_id
                          ? porConfirmar.shipperId : (c.shipper_id ?? '')}
                        disabled={saving === c.source_client_id}
                        onChange={e => elegir(c, e.target.value)}
                        className={INPUT}
                      >
                        {!c.shipper_id && <option value="">— Elige el cliente —</option>}
                        {directorio.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ) : (
                      <span>{c.shipper_name ?? 'Sin vincular'}</span>
                    )}
                    {porConfirmar?.cliente.source_client_id === c.source_client_id && (
                      <div role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-primary">
                        <span>
                          ¿Pasar «{c.source_client}» y sus {c.trips.toLocaleString('es-CL')} viajes a{' '}
                          {directorio.find(s => s.id === porConfirmar.shipperId)?.name ?? 'otro cliente'}?
                        </span>
                        <button type="button" onClick={() => { void vincular(c, porConfirmar.shipperId) }}
                                className="font-semibold text-accent hover:underline">
                          Confirmar
                        </button>
                        <button type="button" onClick={() => setPorConfirmar(null)}
                                className="font-semibold text-informativo hover:underline">
                          Cancelar
                        </button>
                      </div>
                    )}
                    {aplicados.has(c.source_client_id) && !errors[c.source_client_id] && (
                      <p className="mt-1 text-[11px] text-informativo">Se aplicará a sus viajes en la próxima actualización</p>
                    )}
                    {errors[c.source_client_id] && (
                      <p className="mt-1 text-[11px] text-red-600">{errors[c.source_client_id]}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
