'use client'

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'

/** "Pedir a Certificación" (Entrega B): Operaciones no sube, pide. Movido de la
 *  lista de documentos de la vista rápida para que las filas de las fichas lo
 *  ofrezcan igual (Entrega 1 de fichas, 15/10). Si ya está pedido, lo dice. */
export function RequestToCertification({ label, requested, onRequest }: {
  /** El nombre del documento: el botón dice qué se pide. */
  label: string
  requested: boolean
  onRequest: () => Promise<void>
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pedir() {
    setSending(true); setError(null)
    try {
      await onRequest()
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pedir')
    } finally {
      setSending(false)
    }
  }

  if (requested || sent) return <span className="shrink-0 text-etiqueta font-semibold text-informativo">Pedido a Certificación</span>
  return (
    <span className="flex shrink-0 flex-col items-end">
      <button type="button" onClick={() => void pedir()} disabled={sending} aria-label={`Pedir ${label} a Certificación`}
              className="flex items-center gap-1 text-etiqueta font-semibold text-accion hover:underline disabled:opacity-50">
        {sending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Send size={12} aria-hidden="true" />} Pedir a Certificación
      </button>
      {error && <span role="alert" className="text-etiqueta text-status-incidente">{error}</span>}
    </span>
  )
}
