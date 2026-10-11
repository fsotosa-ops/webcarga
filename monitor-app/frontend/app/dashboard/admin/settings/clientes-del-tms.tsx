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
  const { items: directorio } = useConfigList(traerDirectorio)
  const { errors, saving, run } = useRowFeedback()
  const puedeEditar = usePuedeEditarSeccion('tms-clients')
  const [aplicados, setAplicados] = useState<Set<string>>(new Set())

  async function vincular(c: TmsClient, shipperId: string) {
    if (!shipperId) return
    await run(c.source_client_id, async () => {
      await tmsClientsApi.vincular(c.source_client_id, shipperId)
      setAplicados(a => new Set(a).add(c.source_client_id))
      reload()
    })
  }

  if (loading || error) return <LoadState loading={loading} error={error} onRetry={reload} />

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
            ? '1 cliente del TMS sin vincular: sus viajes no aparecen en los filtros por cliente'
            : `${sinVincular} clientes del TMS sin vincular: sus viajes no aparecen en los filtros por cliente`}
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
                        value={c.shipper_id ?? ''}
                        disabled={saving === c.source_client_id}
                        onChange={e => { void vincular(c, e.target.value) }}
                        className={INPUT}
                      >
                        {!c.shipper_id && <option value="">— Elige el cliente —</option>}
                        {directorio.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ) : (
                      <span>{c.shipper_name ?? 'Sin vincular'}</span>
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
