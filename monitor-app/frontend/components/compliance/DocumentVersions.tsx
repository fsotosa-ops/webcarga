'use client'

import { useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { fileHistoryLabel, formatExpiry } from '@/lib/compliance'
import type { DocumentVersion } from '@/lib/types'

/** El historial de archivos de un documento: el vigente y los que reemplazó.
 *  Es lectura, así que lo ve cualquiera. Vivía en `TransporterDocumentsPanel`
 *  (la pestaña Documentos vieja de la empresa); con la ficha única (Entrega C,
 *  14/10) lo usan las filas del espacio de trabajo. Se pide al abrirlo. */
export function DocumentVersions({ recordId }: { recordId: string }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && versions === null) {
      setLoading(true); setErr(null)
      try {
        setVersions(await complianceApi.listFiles(recordId))
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error al cargar versiones')
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <span className="relative shrink-0">
      <button type="button" onClick={toggle} aria-expanded={open}
              className="inline-flex items-center gap-1 text-etiqueta font-semibold text-informativo transition-opacity hover:opacity-70">
        <History size={12} aria-hidden="true" /> Versiones
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 space-y-1 rounded-lg border border-border bg-white p-2 shadow-lg">
          {loading ? (
            <p className="flex items-center gap-1 text-etiqueta text-informativo"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
          ) : err ? (
            <p className="text-etiqueta text-status-incidente">{err}</p>
          ) : (versions?.length ?? 0) === 0 ? (
            <p className="text-etiqueta italic text-informativo">Sin archivos</p>
          ) : (
            versions!.map((v, i) => (
              <a key={v.storage_path ?? v.replaced_at ?? i} href={v.url ?? undefined} target="_blank" rel="noreferrer"
                 className={`flex items-center justify-between gap-2 text-etiqueta ${v.url ? 'text-accion hover:underline' : 'pointer-events-none text-informativo'}`}>
                <span className="truncate">
                  {v.status ? fileHistoryLabel(v.status) : '—'} · {v.is_current
                    ? 'vigente'
                    : `reemplazado ${v.replaced_at ? formatExpiry(v.replaced_at) : '—'}`}
                </span>
                {!v.url && <span className="shrink-0">(sin archivo)</span>}
              </a>
            ))
          )}
        </div>
      )}
    </span>
  )
}
