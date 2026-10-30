'use client'

import { useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { carriersApi, type CarrierCreateResult } from '@/lib/api/carriers'
import type { ManagementType } from '@/lib/types'
import { FIELD_LABEL, Field, inputClass } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { PanelLateral } from '@/components/ui/PanelLateral'

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
  const formId = useId()

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

  // Diálogo del kit (30/10), igual que el alta de conductor y equipo: era una
  // tarjeta suelta con el nombre del campo solo como placeholder, "Tax ID" en
  // inglés y botones fuera del kit.
  return (
    <PanelLateral
      placement="center"
      titulo="Nueva empresa"
      // Toda empresa nueva nace en onboarding (21/10), con o sin RUT.
      description="Se creará En onboarding: carga su documentación y actívala cuando cumpla los obligatorios."
      onCerrar={handleClose}
      dismissible={!creating}
      pie={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={creating}>Cancelar</Button>
          <Button variant="primary" type="submit" form={formId} disabled={creating || !form.business_name}>
            {creating && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            {creating ? 'Creando…' : 'Crear empresa'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={e => { e.preventDefault(); void handleCreate() }} className="space-y-4">
        <Field label="Razón social" required>
          {(id, d) => (
            <input id={id} aria-describedby={d} autoFocus value={form.business_name}
                   onChange={e => setForm(v => ({ ...v, business_name: e.target.value }))}
                   className={`${inputClass()} w-full`} />
          )}
        </Field>
        <Field label="RUT" hint="Opcional. Se puede agregar después.">
          {(id, d) => (
            <input id={id} aria-describedby={d} placeholder="76.123.456-7" value={form.tax_id}
                   onChange={e => setForm(v => ({ ...v, tax_id: e.target.value }))}
                   className={`${inputClass()} w-full font-identificador`} />
          )}
        </Field>
        {/* Tipo de gestión (D7). Son dos marcas independientes, no un desplegable
            de tres opciones: marcar las dos ES el caso mixto. Un valor 'AMBAS'
            obligaría a que toda consulta futura lo recordara, y olvidarlo deja
            afuera a la empresa mixta en silencio.

            Opcional a propósito: la flota manda cuando existe. Esto sólo cubre a
            la empresa que todavía no registró vehículos, y propone el subtipo
            correcto al registrar el primero. */}
        <fieldset>
          <legend className={`${FIELD_LABEL} mb-1.5`}>Tipo de gestión</legend>
          <div className="flex gap-4">
            {GESTIONES.map(({ codigo, label }) => (
              <label key={codigo} className="flex items-center gap-1.5 text-dato text-text-primary cursor-pointer">
                <input type="checkbox" checked={gestiones.includes(codigo)}
                       onChange={() => alternarGestion(codigo)} className="accent-accent cursor-pointer" />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-etiqueta text-informativo">
            Opcional. Si no la eliges, se deduce de los vehículos que registres.
          </p>
        </fieldset>
        {err && <p role="alert" className="text-etiqueta text-status-incidente">{err}</p>}
      </form>
    </PanelLateral>
  )
}
