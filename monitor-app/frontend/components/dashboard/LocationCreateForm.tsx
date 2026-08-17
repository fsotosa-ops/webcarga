'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi, type Shipper } from '@/lib/api/locations'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

const EMPTY_LOCATION = {
  shipperId: '', name: '', site_number: '', format: '', address: '',
  region_name: '', operation_type: '',
}

const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

interface Props {
  shippers: Shipper[]
  onCreated: (location: Location) => void
}

/** Alta de local — el generador de carga se elige adentro del formulario
 *  (Robustecer Tarifario, 2026-07-27) en vez de depender de un filtro de
 *  página, para que "+ Nuevo local" quede visible siempre, no solo con un
 *  generador ya elegido. */
export function LocationCreateForm({ shippers, onCreated }: Props) {
  const [nuevo, setNuevo]         = useState<typeof EMPTY_LOCATION | null>(null)
  const [creating, setCreating]   = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  async function create() {
    if (!nuevo || !nuevo.name.trim()) {
      setCreateErr('Nombre es requerido'); return
    }
    if (!nuevo.shipperId) {
      setCreateErr('Elige un generador de carga'); return
    }
    setCreating(true); setCreateErr(null)
    try {
      const created = await locationsApi.create({
        entity_type: 'SHIPPER', entity_id: nuevo.shipperId, name: nuevo.name,
        site_number: nuevo.site_number || null, format: nuevo.format || null,
        address: nuevo.address || null, region_name: nuevo.region_name || null,
        operation_type: nuevo.operation_type || null,
      })
      onCreated(created)
      setNuevo(null)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }

  if (!nuevo) {
    return (
      <button type="button" onClick={() => setNuevo(EMPTY_LOCATION)}
        className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80">
        <Plus size={13} /> Nuevo local
      </button>
    )
  }

  return (
    <div className="border border-accent/30 bg-accent/[0.03] rounded-xl p-3 space-y-2.5 max-w-2xl">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={nuevo.shipperId} onChange={e => setNuevo({ ...nuevo, shipperId: e.target.value })}
          aria-label="Generador de carga del local nuevo" className={INPUT + ' w-40'}>
          <option value="">Generador de carga…</option>
          {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input autoFocus value={nuevo.name} onChange={e => setNuevo({ ...nuevo, name: e.target.value })}
          placeholder="Nombre del local" aria-label="Nombre del local nuevo" className={INPUT + ' w-40'} />
        <input value={nuevo.site_number} onChange={e => setNuevo({ ...nuevo, site_number: e.target.value })}
          placeholder="N° Local (opcional)" aria-label="N° de local nuevo" className={INPUT + ' w-28'} />
        <input value={nuevo.address} onChange={e => setNuevo({ ...nuevo, address: e.target.value })}
          placeholder="Dirección" aria-label="Dirección del local nuevo" className={INPUT + ' w-48'} />
        <select value={nuevo.operation_type} onChange={e => setNuevo({ ...nuevo, operation_type: e.target.value })}
          aria-label="Clasificación del local nuevo" className={INPUT + ' w-32'}>
          <option value="">Sin clasificar</option>
          {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {createErr && <p className="text-[10px] text-red-500">{createErr}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={create} disabled={creating}
          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 px-3 py-1.5 rounded-lg disabled:opacity-50">
          {creating && <Loader2 size={12} className="animate-spin" />}
          Crear local
        </button>
        <button type="button" onClick={() => { setNuevo(null); setCreateErr(null) }}
          className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
      </div>
    </div>
  )
}
