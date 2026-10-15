'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Inbox, Loader2 } from 'lucide-react'
import { certificationRequestsApi } from '@/lib/api/certificationRequests'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { formatExpiry } from '@/lib/compliance'
import { EntityCell } from '@/components/dashboard/EntityCell'

export const OPERATIONS_REQUESTS_KEY = ['certification-requests', 'open'] as const

const ENTITY_NOUN = { CARRIER: 'Empresa', DRIVER: 'Conductor', ASSET: 'Equipo' } as const
const ENTITY_KIND = { CARRIER: 'carrier', DRIVER: 'driver', ASSET: 'asset' } as const

/** "Pedidos de Operaciones" arriba de Pendientes (Entrega B, 14/10): lo que
 *  Operaciones pidió desde el Cierre o el Directorio. Un pedido cuyo documento ya
 *  quedó al día sale solo; el resto lo resuelve Certificación. Sin pedidos, no
 *  ocupa lugar. */
export function OperationsRequests() {
  const qc = useQueryClient()
  const canResolve = usePermiso('documents.review')
  const [err, setErr] = useState<string | null>(null)
  const query = useQuery({ queryKey: OPERATIONS_REQUESTS_KEY, queryFn: () => certificationRequestsApi.listOpen() })
  const resolve = useMutation({
    mutationFn: (id: string) => certificationRequestsApi.resolve(id),
    onSuccess: () => { setErr(null); void qc.invalidateQueries({ queryKey: ['certification-requests'] }) },
    onError: e => setErr(e instanceof Error ? e.message : 'No se pudo resolver'),
  })

  const rows = query.data?.rows ?? []
  if (!rows.length) return null

  return (
    <section aria-label="Pedidos de Operaciones" className="mb-3 rounded-md border border-border bg-white p-3">
      <h2 className="flex items-center gap-2 text-lectura font-semibold text-text-primary">
        <Inbox size={14} aria-hidden="true" /> Pedidos de Operaciones ({rows.length})
      </h2>
      <ul className="mt-2 divide-y divide-border">
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-dato">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary">
                {/* A quién se le pide y su empresa llevan a su vista rápida (N2, Entrega 1 de fichas). */}
                {r.requirement_name ?? 'Documento sin especificar'} · {ENTITY_NOUN[r.entity_type]}{' '}
                <EntityCell kind={ENTITY_KIND[r.entity_type]} id={r.entity_id} label={r.entity_name} empty="" />
                {r.carrier_name && r.entity_type !== 'CARRIER' && (
                  <> (<EntityCell kind="carrier" id={r.carrier_id} label={r.carrier_name} />)</>
                )}
              </p>
              <p className="text-etiqueta text-informativo">
                Pedido por {r.created_by_name ?? 'Operaciones'} el {formatExpiry(r.created_at.slice(0, 10))}
                {r.closure_date ? ` · Cierre del ${formatExpiry(r.closure_date)}` : ''}
                {r.trip_number ? ` · viaje ${r.trip_number}` : ''}
                {r.note ? ` · "${r.note}"` : ''}
              </p>
            </div>
            {canResolve && (
              <button type="button" onClick={() => resolve.mutate(r.id)} disabled={resolve.isPending}
                      className="flex items-center gap-1 text-etiqueta font-semibold text-accion hover:underline disabled:opacity-50">
                {resolve.isPending && resolve.variables === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Resolver
              </button>
            )}
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-1 text-etiqueta text-espera">{err}</p>}
    </section>
  )
}
