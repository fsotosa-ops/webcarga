'use client'

import { useState } from 'react'
import { Search, Loader2, Building2, Plus } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useClients } from '@/hooks/useClients'
import { invalidateClients } from '@/lib/queries/clientes'
import { shippersApi } from '@/lib/api/locations'
import { ApiError } from '@/lib/api/client'
import { inputClass } from '@/components/ui/Field'

export type ClienteElegido = { id: string; name: string }

interface Props {
  /** El cliente del directorio elegido, o null. Siempre un cliente real: el
   *  viaje guarda su id (spec 2026-10-11), nunca texto libre. */
  value:        ClienteElegido | null
  onChange:     (cliente: ClienteElegido | null) => void
  placeholder?: string
  size?:        'sm' | 'md'
  /** El id del campo, para que una etiqueta (`Field`) lo nombre. */
  id?:          string
}

const normalizar = (s: string) => s.trim().toLowerCase()

/** Elige el cliente del viaje del directorio, o lo crea si no existe. Elegido,
 *  queda fijo con "Cambiar" (el mismo patrón que el conductor en el formulario):
 *  así nunca conviven un texto escrito y un id elegido que digan cosas distintas. */
export function ClientPicker({ value, onChange, placeholder = 'Cliente…', size = 'md', id }: Props) {
  const [texto, setTexto]       = useState('')
  const [open, setOpen]         = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  const qc = useQueryClient()
  const shippersQuery = useClients()
  // Solo clientes activos: el backend rechaza un viaje con un cliente inactivo.
  const todos = shippersQuery.data ?? []
  const shippers = todos.filter(s => s.status === 'ACTIVE')
  const q = normalizar(texto)
  const results = q ? shippers.filter(s => s.name.toLowerCase().includes(q)) : shippers
  const exactMatch = shippers.some(s => normalizar(s.name) === q)
  // Lo escrito es un cliente inactivo: crearlo daría "ya existe". Se dice.
  const inactivo = q ? todos.find(s => s.status !== 'ACTIVE' && normalizar(s.name) === q) : undefined

  function elegir(c: ClienteElegido) {
    onChange({ id: c.id, name: c.name })
    setTexto('')
    setOpen(false)
  }

  async function handleCreate() {
    const name = texto.trim()
    if (!name) return
    setCreating(true); setErr(null)
    try {
      const created = await shippersApi.create({ name })
      await invalidateClients(qc)
      elegir(created)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Carrera: alguien lo creó justo antes. Se elige el del directorio, que
        // es el mismo cliente aunque lo hayan escrito con otras mayúsculas.
        const { data } = await shippersQuery.refetch()
        const existente = (data ?? []).find(s => normalizar(s.name) === normalizar(name))
        if (existente) elegir(existente)
        else setErr('Ese cliente ya existe; búscalo en la lista')
      } else {
        setErr(e instanceof Error ? e.message : 'Error al crear el cliente')
      }
    } finally {
      setCreating(false)
    }
  }

  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  if (value) {
    return (
      <div className={`flex items-center justify-between gap-2 border border-border rounded-lg px-3 py-2 bg-white ${textSize}`}>
        <span className="flex items-center gap-2 min-w-0">
          <Building2 size={13} className="text-informativo shrink-0" />
          <span className="font-semibold text-text-primary truncate">{value.name}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Cambiar cliente"
          className="text-[11px] font-semibold text-accent hover:underline shrink-0"
        >
          Cambiar
        </button>
      </div>
    )
  }

  const inputCls = size === 'sm'
    ? `w-full ${inputClass({ size: 'sm' })} pl-7`
    : `w-full ${inputClass()} pl-8`
  const iconSize = size === 'sm' ? 12 : 13

  return (
    <div className="relative">
      <div className="relative">
        <Search size={iconSize} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo pointer-events-none" />
        <input
          id={id}
          type="text"
          value={texto}
          onChange={e => { setTexto(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          aria-label="Cliente"
          className={inputCls}
        />
      </div>
      {open && (
        <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/60 mt-1.5 absolute z-10 bg-white w-full shadow-lg">
          {shippersQuery.isLoading && (
            <p className="px-3 py-2 text-center text-[11px] text-informativo flex items-center justify-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Cargando…
            </p>
          )}
          {!shippersQuery.isLoading && results.map(s => (
            <button
              key={s.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => elegir(s)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-main transition-colors"
            >
              <Building2 size={12} className="text-informativo shrink-0" />
              <p className="text-[11px] font-semibold text-text-primary truncate">{s.name}</p>
            </button>
          ))}
          {!shippersQuery.isLoading && inactivo && (
            <p className="px-3 py-2 text-[11px] text-informativo">«{inactivo.name}» está inactivo en el directorio</p>
          )}
          {!shippersQuery.isLoading && q && !exactMatch && !inactivo && (
            <button
              type="button"
              disabled={creating}
              onMouseDown={e => e.preventDefault()}
              onClick={handleCreate}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/5 transition-colors text-accent disabled:opacity-50"
            >
              {creating ? <Loader2 size={12} className="animate-spin shrink-0" /> : <Plus size={12} className="shrink-0" />}
              <p className="text-[11px] font-semibold truncate">Crear cliente &ldquo;{texto.trim()}&rdquo;</p>
            </button>
          )}
          {!shippersQuery.isLoading && !q && results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-informativo">Sin clientes registrados</p>
          )}
        </div>
      )}
      {err && <p className="text-[11px] text-status-incidente mt-1">{err}</p>}
    </div>
  )
}
