'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { invalidarCertificacion } from '@/lib/queries/certificacion'

/** "Solicitar documento" (HU-C1, entrega 2b): pedirle a un sujeto un documento
 *  "solo cuando se solicita" —trabajo en altura, soldador, guardias…—, que al
 *  activarse no se le pide a nadie.
 *
 *  Vive dentro de la tarjeta del sujeto, al pie de sus documentos: no es una
 *  pantalla nueva. La lista se pide recién al abrir la acción. */
export function SolicitarDocumento({ entityType, entityId }: {
  entityType: 'CARRIER' | 'DRIVER' | 'ASSET'
  entityId: string
}) {
  const qc = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [elegido, setElegido] = useState('')

  const lista = useQuery({
    queryKey: ['solicitables', entityType, entityId],
    queryFn: () => complianceApi.solicitables(entityType, entityId),
    enabled: abierto,
  })

  const solicitar = useMutation({
    mutationFn: () => complianceApi.solicitar({
      requirement_id: elegido, entity_type: entityType, entity_id: entityId,
    }),
    onSuccess: async () => {
      setElegido('')
      setAbierto(false)
      await qc.invalidateQueries({ queryKey: ['solicitables', entityType, entityId] })
      await invalidarCertificacion(qc)
    },
  })

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-etiqueta font-semibold text-accion
                   transition-opacity hover:opacity-70"
      >
        <Plus size={12} aria-hidden="true" />
        Solicitar documento
      </button>
    )
  }

  const opciones = lista.data ?? []
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border">
      {lista.isPending && (
        <span className="inline-flex items-center gap-1.5 text-etiqueta text-informativo">
          <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" /> Cargando…
        </span>
      )}
      {lista.data && opciones.length === 0 && (
        <span className="text-etiqueta text-informativo">
          No hay documentos a pedido para solicitar. Se configuran en Configuración › Certificación.
        </span>
      )}
      {opciones.length > 0 && (
        <>
          <select
            aria-label="Documento a solicitar"
            value={elegido}
            onChange={e => setElegido(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2 py-1 text-dato
                       focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">Elige el documento…</option>
            {opciones.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => solicitar.mutate()}
            disabled={!elegido || solicitar.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-etiqueta
                       font-semibold text-white disabled:opacity-50"
          >
            {solicitar.isPending && <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />}
            Solicitar
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="text-etiqueta text-informativo transition-opacity hover:opacity-70"
      >
        Cancelar
      </button>
      {solicitar.isError && (
        <span role="alert" className="w-full text-etiqueta text-status-incidente">
          {solicitar.error instanceof Error ? solicitar.error.message : 'No se pudo solicitar'}
        </span>
      )}
    </div>
  )
}
