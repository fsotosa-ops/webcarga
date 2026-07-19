'use client'

import { useState } from 'react'
import { Search, Loader2, Building2, Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { shippersApi } from '@/lib/api/locations'
import { ApiError } from '@/lib/api/client'

interface Props {
  /** client_name actual — texto libre o el nombre exacto de un shipper real */
  value:       string
  onChange:    (name: string) => void
  placeholder?: string
  size?:       'sm' | 'md'
}

export function ClientPicker({ value, onChange, placeholder = 'Cliente…', size = 'md' }: Props) {
  const [open, setOpen]         = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  const shippersQuery = useQuery({
    queryKey: ['shippers', 'list'],
    queryFn: () => shippersApi.list(),
    staleTime: 5 * 60 * 1000,
  })
  const shippers = shippersQuery.data ?? []
  const q = value.trim().toLowerCase()
  const results = q ? shippers.filter(s => s.name.toLowerCase().includes(q)) : shippers
  const exactMatch = shippers.some(s => s.name.toLowerCase() === q)

  async function handleCreate() {
    const name = value.trim()
    if (!name) return
    setCreating(true); setErr(null)
    try {
      const created = await shippersApi.create({ name })
      onChange(created.name)
      setOpen(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Carrera: alguien más lo creó justo antes — igual queda seleccionado,
        // no es un error real desde la perspectiva del operador.
        await shippersQuery.refetch()
        onChange(name)
        setOpen(false)
      } else {
        setErr(e instanceof Error ? e.message : 'Error al crear el cliente')
      }
    } finally {
      setCreating(false)
    }
  }

  const inputCls = size === 'sm'
    ? 'w-full text-xs border border-border rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20'
    : 'w-full text-sm border border-border rounded-lg pl-8 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300'
  const iconSize = size === 'sm' ? 12 : 13

  return (
    <div className="relative">
      <div className="relative">
        <Search size={iconSize} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
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
            <p className="px-3 py-2 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Cargando…
            </p>
          )}
          {!shippersQuery.isLoading && results.map(s => (
            <button
              key={s.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(s.name); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
            >
              <Building2 size={12} className="text-gray-400 shrink-0" />
              <p className="text-[11px] font-semibold text-text-primary truncate">{s.name}</p>
            </button>
          ))}
          {!shippersQuery.isLoading && q && !exactMatch && (
            <button
              type="button"
              disabled={creating}
              onMouseDown={e => e.preventDefault()}
              onClick={handleCreate}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/5 transition-colors text-accent disabled:opacity-50"
            >
              {creating ? <Loader2 size={12} className="animate-spin shrink-0" /> : <Plus size={12} className="shrink-0" />}
              <p className="text-[11px] font-semibold truncate">Crear cliente &ldquo;{value.trim()}&rdquo;</p>
            </button>
          )}
          {!shippersQuery.isLoading && !q && results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-gray-400">Sin clientes registrados</p>
          )}
        </div>
      )}
      {err && <p className="text-[11px] text-red-500 mt-1">{err}</p>}
    </div>
  )
}
