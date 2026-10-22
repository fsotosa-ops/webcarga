'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Field'
import { ApiError } from '@/lib/api/client'

/** Guardar la vista actual con un nombre (HU Analítica, criterio 9). Compartir solo con analytics.manage_views.
 *  Si falla, no se cierra ni pierde el nombre. */
export function SaveViewDialog({ canShare, onClose, onSave }: {
  canShare: boolean
  onClose: () => void
  onSave: (name: string, shared: boolean) => Promise<void>
}) {
  const [nombre, setNombre] = useState('')
  const [compartir, setCompartir] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await onSave(nombre.trim(), compartir)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409
        ? 'Ya hay una vista con ese nombre' : 'No se pudo guardar la vista. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog label="Guardar vista" onClose={onClose} dismissible={!guardando}
      className="inset-0 m-auto h-fit w-[min(92vw,380px)] rounded-2xl bg-white p-5 shadow-xl animate-modal-in">
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (nombre.trim()) void guardar() }}>
        <p className="text-base font-bold text-text-primary">Guardar vista</p>
        <label className="block text-dato">
          <span className="text-informativo">Nombre</span>
          <input aria-label="Nombre" value={nombre} maxLength={60} autoFocus disabled={guardando}
            onChange={e => setNombre(e.target.value)} className={`${inputClass({ size: 'sm' })} mt-1 w-full`} />
        </label>
        {canShare && (
          <label className="flex items-center gap-2 text-dato">
            <input type="checkbox" aria-label="Compartir con el equipo" checked={compartir} disabled={guardando}
              onChange={e => setCompartir(e.target.checked)} className="accent-accent" />
            Compartir con el equipo
          </label>
        )}
        {error && <p role="alert" className="text-dato text-status-incidente">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={guardando} onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" disabled={guardando || !nombre.trim()}>
            {guardando && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
