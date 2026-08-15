'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { carriersApi, type CarrierCreateResult } from '@/lib/api/carriers'
import type { ManagementType } from '@/lib/types'

interface Props {
  open:                 boolean
  initialBusinessName?: string
  onClose:              () => void
  onCreated:            (carrier: CarrierCreateResult) => void
}

/** Orden canónico de escritura. El CHECK de la base acepta cualquier orden,
 *  así que sin normalizar dos filas equivalentes no son iguales por `=`. */
const GESTIONES: { codigo: ManagementType; label: string }[] = [
  { codigo: 'TRACTOREO',       label: 'Tractoreo' },
  { codigo: 'EQUIPO_COMPLETO', label: 'Equipo Completo' },
]

/** Panel de alta de empresa — extraído de app/dashboard/carriers/page.tsx
 *  (Ronda 89) para reusarlo también desde Certificación. El backend siembra
 *  compliance_records en MISSING automáticamente al insertar (ver
 *  routers/carriers.py) — el caller decide qué hacer después de crear:
 *  carriers/page.tsx navega a la ficha nueva, Certificación abre el panel
 *  de documentos de esa empresa sin salir del módulo. */
export function NewCarrierPanel({ open, initialBusinessName = '', onClose, onCreated }: Props) {
  const [form, setForm]         = useState({ tax_id: '', business_name: initialBusinessName })
  const [gestiones, setGestiones] = useState<ManagementType[]>([])
  const [creating, setCreating] = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  function alternarGestion(codigo: ManagementType) {
    setGestiones(prev => (prev.includes(codigo)
      ? prev.filter(g => g !== codigo)
      // Se reconstruye desde el orden canónico en vez de agregar al final.
      : GESTIONES.filter(g => g.codigo === codigo || prev.includes(g.codigo)).map(g => g.codigo)))
  }

  async function handleCreate() {
    if (!form.business_name) return
    setCreating(true); setErr(null)
    try {
      const created = await carriersApi.create({
        ...form,
        tax_id: form.tax_id.trim() || undefined,
        // No se manda cuando nadie eligió: la flota manda cuando existe, y 37
        // de 39 empresas responden su gestión desde sus vehículos. Mandar un
        // arreglo vacío sería una tercera manera de decir "no declarado".
        ...(gestiones.length ? { management_types: gestiones } : {}),
      })
      onCreated(created)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al crear la empresa')
    } finally {
      setCreating(false)
    }
  }

  function handleClose() {
    // El panel NO se desmonta al cerrar (`if (!open) return null` sólo deja de
    // renderizar), asi que sin limpiar acá la gestión marcada para una empresa
    // se arrastraba a la siguiente y se guardaba sin que nadie la eligiera.
    // Misma clase que el bug de draft sin resincronizar de ContactCard.
    setErr(null)
    setForm({ tax_id: '', business_name: initialBusinessName })
    setGestiones([])
    onClose()
  }

  if (!open) return null

  return (
    <div className="bg-white border border-border rounded-2xl p-4 max-w-sm space-y-2">
      <p className="text-xs font-bold text-text-primary mb-1">Nueva empresa</p>
      <input
        placeholder="Tax ID"
        aria-label="Tax ID"
        value={form.tax_id}
        onChange={e => setForm(v => ({ ...v, tax_id: e.target.value }))}
        className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {form.tax_id.trim() === '' && (
        <p className="text-[11px] text-gray-400">Se creará en estado Onboarding, pendiente de RUT.</p>
      )}
      <input
        placeholder="Razón social"
        aria-label="Razón social"
        value={form.business_name}
        onChange={e => setForm(v => ({ ...v, business_name: e.target.value }))}
        className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {/* Tipo de gestión (D7). Son dos marcas independientes, no un desplegable
          de tres opciones: marcar las dos ES el caso mixto. Un valor 'AMBAS'
          obligaría a que toda consulta futura lo recordara, y olvidarlo deja
          afuera a la empresa mixta en silencio.

          Opcional a propósito: la flota manda cuando existe. Esto sólo cubre a
          la empresa que todavía no registró vehículos, y propone el subtipo
          correcto al registrar el primero. */}
      <fieldset className="pt-0.5">
        <legend className="text-[11px] text-gray-500 pb-1">Tipo de gestión</legend>
        <div className="flex gap-3">
          {GESTIONES.map(({ codigo, label }) => (
            <label key={codigo} className="flex items-center gap-1.5 text-xs text-text-primary cursor-pointer">
              <input
                type="checkbox"
                aria-label={label}
                checked={gestiones.includes(codigo)}
                onChange={() => alternarGestion(codigo)}
                className="accent-accent cursor-pointer"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-[10.5px] text-gray-400 pt-1">
          Opcional. Si no la eliges, se deduce de los vehículos que registres.
        </p>
      </fieldset>

      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleCreate}
          disabled={creating || !form.business_name}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Crear empresa
        </button>
        <button onClick={handleClose} aria-label="Cancelar" className="p-1.5 text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
