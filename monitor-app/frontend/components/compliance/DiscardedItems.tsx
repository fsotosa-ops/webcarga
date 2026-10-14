'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { usePermiso } from '@/lib/authz/PermisosProvider'

const PAGE = 100

/** Los descartados de Sin clasificar (borrado lógico, 14/10): el archivo se
 *  conserva y se puede devolver a la cola. Plegado por defecto: es la excepción,
 *  no el trabajo del día. */
export function DiscardedItems() {
  const qc = useQueryClient()
  const canEdit = usePermiso('documents.upload')
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const query = useQuery({
    queryKey: [...clavesCertificacion.cola(), 'discarded'],
    queryFn: () => documentIngestApi.listQueue({ status: 'discarded', limit: PAGE }),
    enabled: open,
  })

  const restore = useMutation({
    mutationFn: (id: string) => documentIngestApi.restore(id),
    onSuccess: () => { setErr(null); void invalidarCertificacion(qc) },
    onError: e => setErr(e instanceof Error ? e.message : 'No se pudo restaurar'),
  })

  const rows = query.data?.rows ?? []

  return (
    <section className="rounded-xl border border-border bg-white">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-text-primary"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Descartados
        {query.data && <span className="text-xs font-normal text-informativo">({query.data.total})</span>}
      </button>

      {open && (
        <div className="px-4 pb-3">
          {query.isLoading && <p className="text-xs text-informativo flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>}
          {query.isError && <p className="text-xs text-status-incidente">No se pudieron cargar los descartados.</p>}
          {query.data && rows.length === 0 && <p className="text-xs text-informativo">No hay documentos descartados.</p>}
          <ul className="divide-y divide-border">
            {rows.map(r => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-text-primary">{r.file_name}</p>
                  <p className="text-xs text-informativo">
                    {r.carrier_name ?? 'Sin empresa'}
                    {r.discard_reason ? ` · ${r.discard_reason}` : ''}
                  </p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => restore.mutate(r.id)}
                    disabled={restore.isPending}
                    className="shrink-0 flex items-center gap-1 text-xs font-semibold text-accent hover:underline disabled:opacity-50"
                  >
                    <RotateCcw size={12} /> Restaurar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {err && <p className="text-xs text-status-incidente mt-2">{err}</p>}
        </div>
      )}
    </section>
  )
}
