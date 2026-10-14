'use client'

import { useState } from 'react'
import { X, Loader2, Users } from 'lucide-react'
import { ClientPicker, type ClienteElegido } from '@/components/dashboard/ClientPicker'
import type { CarrierShipper } from '@/lib/types'

interface Props {
  label:    string
  clients:  CarrierShipper[]
  onClose:  () => void
  onAdd:    (shipperId: string) => Promise<void>
  onEnd:    (shipperId: string) => Promise<void>
}

/** Los clientes de una empresa se declaran (P10, 12/10) y tienen vigencia (D2):
 *  agregar empieza hoy, quitar termina hoy y deja el vínculo en el historial. */
export function CarrierClientsModal({ label, clients, onClose, onAdd, onEnd }: Props) {
  const [picked, setPicked] = useState<ClienteElegido | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const active = clients.filter(c => c.status === 'ACTIVE')
  const alreadyThere = !!picked && active.some(c => c.id === picked.id)

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key); setErr(null)
    try {
      await action()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setBusy(null)
    }
  }

  function handleClose() {
    if (busy) return
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 bg-sidebar flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Users size={14} /> Clientes de {label}
          </h3>
          <button onClick={handleClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {active.length === 0 && <p className="text-sm text-informativo">Todavía no tiene clientes declarados.</p>}
          <ul className="divide-y divide-border">
            {active.map(c => (
              <li key={c.id} className="flex items-center justify-between py-1.5 text-sm text-text-primary">
                <span>{c.name}</span>
                <button
                  onClick={() => run(c.id, () => onEnd(c.id))}
                  disabled={!!busy}
                  className="text-xs text-status-incidente hover:underline disabled:opacity-50"
                >
                  {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : 'Quitar'}
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-start gap-2">
            <div className="flex-1">
              <ClientPicker value={picked} onChange={setPicked} placeholder="Agregar un cliente…" size="sm" />
            </div>
            <button
              onClick={() => picked && run('add', async () => { await onAdd(picked.id); setPicked(null) })}
              disabled={!picked || alreadyThere || !!busy}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {busy === 'add' ? <Loader2 size={12} className="animate-spin" /> : 'Agregar'}
            </button>
          </div>
          {alreadyThere && <p className="text-xs text-informativo">Ese cliente ya está en la lista.</p>}
          {err && <p className="text-xs text-status-incidente">{err}</p>}
        </div>
      </div>
    </div>
  )
}
