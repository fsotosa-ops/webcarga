'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { locationsApi } from '@/lib/api/locations'
import type { DriverPatchBody } from '@/lib/api/drivers'
import type { Driver } from '@/lib/types'

const LABEL = 'text-etiqueta font-semibold text-informativo'
const INPUT = 'w-full rounded-lg border border-border bg-white px-3 py-1.5 text-dato focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60'

/** Editar los datos de un conductor, en el bloque Detalles de su ficha. Movido
 *  del panel de conductor (Entrega 1 de fichas, 15/10): nombre y origen
 *  habitual, con la propuesta de CD de sus viajes. El borrador sale de `driver`
 *  al montarse, y el bloque lo monta cada vez que se abre. */
export function DriverEditForm({ driver, onSave, onClose }: {
  driver: Driver
  onSave: (body: DriverPatchBody) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState({ full_name: driver.full_name, home_location_id: driver.home_location_id ?? '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // El desplegable sale del CATÁLOGO, no de lo que el conductor haya recorrido:
  // se le puede asignar un CD al que todavía no fue nunca.
  const cdsQuery = useQuery({
    queryKey: ['origenes'],
    queryFn: () => locationsApi.list({ origin: true, operational_status: 'ACTIVE', limit: 200 }),
    staleTime: 5 * 60 * 1000,
  })

  async function save() {
    setSaving(true); setErr(null)
    try {
      // home_location_id viaja SIEMPRE: '' significa "quítaselo", y omitirlo
      // significaría "no lo toques". Son cosas distintas.
      await onSave({ full_name: draft.full_name, home_location_id: draft.home_location_id })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  const sugerido = driver.suggested_home_location
  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className={LABEL}>Nombre</span>
        <input aria-label="Nombre" value={draft.full_name}
               onChange={e => setDraft(d => ({ ...d, full_name: e.target.value }))} className={INPUT} />
      </label>
      <div className="space-y-1">
        <label htmlFor="cd-base" className={LABEL}>Origen habitual</label>
        {/* Si el catálogo no carga, NO se dibuja un desplegable vacío que
            parezca "no hay CD": se dice qué pasó. */}
        {cdsQuery.isError ? (
          <p className="text-etiqueta text-status-incidente">No se pudieron cargar los orígenes.</p>
        ) : (
          <select id="cd-base" aria-label="Origen habitual" value={draft.home_location_id}
                  disabled={cdsQuery.isLoading}
                  onChange={e => setDraft(d => ({ ...d, home_location_id: e.target.value }))} className={INPUT}>
            <option value="">Sin asignar</option>
            {(cdsQuery.data?.data ?? []).map(cd => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
          </select>
        )}
        {/* PROPONE, nunca escribe. El botón dice el CD concreto: quien lo aprieta
            tiene que poder leer qué va a quedar guardado sin abrir el desplegable. */}
        {sugerido && !draft.home_location_id && (
          <p className="text-etiqueta text-informativo">
            Salió {sugerido.viajes} de {sugerido.total} veces desde {sugerido.name} en los últimos 90 días.{' '}
            <button type="button" onClick={() => setDraft(d => ({ ...d, home_location_id: sugerido.id }))}
                    className="font-semibold text-accion hover:underline">
              Asignar {sugerido.name}
            </button>
          </p>
        )}
      </div>
      {err && <p role="alert" className="text-etiqueta text-status-incidente">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
          Guardar
        </button>
        <button type="button" onClick={onClose} disabled={saving}
                className="rounded-lg border border-border px-3 py-1.5 text-dato text-text-primary hover:bg-bg-main disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  )
}
