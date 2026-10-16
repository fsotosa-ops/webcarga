'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { INPUT } from '@/app/dashboard/admin/settings/shared'

/** El nombre de un cliente del directorio: el alta (lista de Clientes) y el
 *  cambio de nombre (su ficha). El directorio no admite dos nombres que solo
 *  difieran en mayúsculas: el 409 se muestra aquí, con lo escrito intacto. */
export function ClientNamePanel({ titulo, accion, inicial = '', onGuardar, onCerrar }: {
  titulo: string
  accion: string
  inicial?: string
  onGuardar: (name: string) => Promise<unknown>
  onCerrar: () => void
}) {
  const [nombre, setNombre] = useState(inicial)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listo = nombre.trim() !== '' && nombre.trim() !== inicial.trim() && !guardando

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await onGuardar(nombre.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <PanelLateral
      titulo={titulo}
      onCerrar={onCerrar}
      pie={
        <button type="button" onClick={guardar} disabled={!listo}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
          {guardando ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Check size={12} aria-hidden />}
          {accion}
        </button>
      }
    >
      <label className="block">
        <span className="text-dato font-semibold text-text-primary">Cómo se llama</span>
        <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} aria-label="Nombre del cliente"
          className={`${INPUT} mt-2 w-full`} />
      </label>
      {error && <p role="alert" className="mt-2 text-dato text-status-incidente">{error}</p>}
    </PanelLateral>
  )
}
