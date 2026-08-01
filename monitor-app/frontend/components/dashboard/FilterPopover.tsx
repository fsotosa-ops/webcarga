'use client'

import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { TripsMeta } from '@/lib/types'
import type { Shipper } from '@/lib/api/locations'
import type { DiarioFilters, DiarioFiltersAction } from '@/hooks/useDiarioFilters'
import { countPopoverFilters } from '@/hooks/useDiarioFilters'
import { LocationPicker } from './LocationPicker'

interface Props {
  filters:  DiarioFilters
  dispatch: React.Dispatch<DiarioFiltersAction>
  meta?:    TripsMeta | null
  /** Catálogo de clientes/shippers (public.shippers) para el filtro de
   *  Cliente — 2026-08-02, ver AGENTLOG (filtros del Diario). */
  shippers?: Shipper[]
}

/**
 * Filtros de uso ocasional (Fuente TMS, Tipo de operación, rango de fechas)
 * fuera de la barra principal — reduce la carga visual del monitor de ~25 a
 * ~10 controles.
 */
export function FilterPopover({ filters: f, dispatch, meta, shippers }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef  = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Draft del autocomplete de Origen — se limpia apenas se elige un local
  // real, para poder seguir agregando más de uno (chips removibles abajo).
  const [originDraft, setOriginDraft] = useState('')

  const count = countPopoverFilters(f)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
          count > 0
            ? 'text-accent border-accent/40 bg-accent/5'
            : 'text-gray-500 border-border bg-white hover:border-gray-300'
        }`}
      >
        <SlidersHorizontal size={13} />
        Filtros
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold bg-accent text-white rounded-full">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filtros adicionales"
          className="absolute right-0 top-full mt-1.5 z-30 w-72 bg-white border border-border rounded-xl shadow-xl p-4 space-y-4 animate-modal-in"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Filtros</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar filtros"
              className="text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          </div>

          {/* Fuente TMS */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Fuente</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(meta?.tms_sources ?? []).map(src => {
                const active = f.fTms.includes(src.id)
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => dispatch({ type: 'toggleTms', id: src.id })}
                    aria-pressed={active}
                    style={active ? { backgroundColor: src.bg_color, color: src.text_color, borderColor: src.bg_color } : undefined}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                      active ? '' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {src.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Indicadores (Activo/Trabajando/Asignado) se movieron a tiles
              visibles arriba de la tabla, junto a las KPI cards — Fase 3
              del hardening del Diario, 2026-07-18. Ya no viven acá. */}

          {/* Tipo de operación (RM/Zona Cero) — reemplaza el filtro de
              región/ciudad de origen (Fase 2, Plan 7). Filtra por destino,
              no por origen (swap 2026-08-02, ítem 12 de la minuta) — ya
              viene resuelto en cada TripStop de GET /trips, el filtro es
              100% client-side, mismo mecanismo que las alertas KPI de la
              Ronda 26. */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Tipo de operación</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(meta?.operation_types ?? []).map(ot => {
                const active = f.fOperationType.includes(ot.id)
                return (
                  <button
                    key={ot.id}
                    type="button"
                    onClick={() => dispatch({ type: 'toggleOperationType', id: ot.id })}
                    aria-pressed={active}
                    style={active ? { backgroundColor: ot.bg_color, color: ot.text_color, borderColor: ot.bg_color } : undefined}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                      active ? '' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {ot.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cliente (shipper) — server-side, mismo patrón de chips que
              Fuente/Tipo de operación (2026-08-02). */}
          {shippers && shippers.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Cliente</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {shippers.map(sh => {
                  const active = f.fClient.includes(sh.name)
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      onClick={() => dispatch({ type: 'toggleClient', id: sh.name })}
                      aria-pressed={active}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                        active ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      {sh.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tipo de carga — catálogo de app.temperature_ranges (ya
              disponible en meta, sin fetch nuevo). */}
          {(meta?.temperature_ranges ?? []).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Tipo de carga</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(meta?.temperature_ranges ?? []).map(tr => {
                  const active = f.fCargoType.includes(tr.cargo_type)
                  return (
                    <button
                      key={tr.cargo_type}
                      type="button"
                      onClick={() => dispatch({ type: 'toggleCargoType', id: tr.cargo_type })}
                      aria-pressed={active}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                        active ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      {tr.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Origen — autocomplete (no chips estáticas: cientos de locales
              reales, no escala como multi-select). Cada elección real se
              agrega como chip removible; el draft se limpia para seguir
              agregando más de uno. */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Origen</p>
            <LocationPicker
              value={originDraft}
              onChange={setOriginDraft}
              onSelectLocation={loc => {
                dispatch({ type: 'toggleOrigin', id: loc.name })
                setOriginDraft('')
              }}
              placeholder="Buscar local de origen…"
              ariaLabel="Filtrar por local de origen"
              size="sm"
            />
            {f.fOrigin.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {f.fOrigin.map(name => (
                  <span key={name} className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/10 rounded-full pl-2.5 pr-1.5 py-1">
                    {name}
                    <button type="button" onClick={() => dispatch({ type: 'toggleOrigin', id: name })} aria-label={`Quitar origen ${name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Rango de fechas — solo historial */}
          {f.tab === 'historial' && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Rango de fechas</p>
              <div className="flex items-center gap-1.5">
                <input type="date" value={f.fechaDesde} aria-label="Desde"
                  onChange={e => dispatch({ type: 'patch', patch: { fechaDesde: e.target.value } })}
                  className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20" />
                <span className="text-gray-300 text-xs shrink-0">a</span>
                <input type="date" value={f.fechaHasta} aria-label="Hasta"
                  onChange={e => dispatch({ type: 'patch', patch: { fechaHasta: e.target.value } })}
                  className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
