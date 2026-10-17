'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Button } from '@/components/ui/Button'
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

  return (
    <PanelLateral placement="center" titulo={`Clientes de ${label}`} onCerrar={onClose} dismissible={!busy}
      pie={<div className="flex justify-end"><Button onClick={onClose} disabled={!!busy}>Listo</Button></div>}>
      <div className="space-y-3">
        {active.length === 0 && <p className="text-dato text-informativo">Todavía no tiene clientes declarados.</p>}
        <ul className="divide-y divide-border">
          {active.map(c => (
            <li key={c.id} className="flex items-center justify-between py-1.5 text-dato text-text-primary">
              <span>{c.name}</span>
              <Button variant="link" size="sm" onClick={() => run(c.id, () => onEnd(c.id))} disabled={!!busy}
                aria-label={`Quitar ${c.name}`}>
                {busy === c.id ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : 'Quitar'}
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex items-start gap-2">
          <div className="flex-1">
            <ClientPicker value={picked} onChange={setPicked} placeholder="Agregar un cliente…" size="sm" />
          </div>
          <Button variant="primary" onClick={() => picked && run('add', async () => { await onAdd(picked.id); setPicked(null) })}
            disabled={!picked || alreadyThere || !!busy}>
            {busy === 'add' ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : 'Agregar'}
          </Button>
        </div>
        {alreadyThere && <p className="text-dato text-informativo">Ese cliente ya está en la lista.</p>}
        {err && <p role="alert" className="text-dato text-status-incidente">{err}</p>}
      </div>
    </PanelLateral>
  )
}
