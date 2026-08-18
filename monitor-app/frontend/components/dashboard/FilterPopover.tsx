'use client'

import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, X, Plus, PenLine } from 'lucide-react'
import type { TripsMeta } from '@/lib/types'
import type { FilterGroup, GroupColor } from '@/lib/api/filterGroups'
import type { DiarioFilters, DiarioFiltersAction } from '@/hooks/useDiarioFilters'
import { countPopoverFilters } from '@/hooks/useDiarioFilters'
import { LocationPicker } from './LocationPicker'
import { TEXTO_CUERPO } from '@/lib/ui/texto'

interface DefaultGroup {
  id:       string
  statuses: string[]
  label:    string
  on:       string
  off:      string
}

interface Props {
  filters:       DiarioFilters
  dispatch:      React.Dispatch<DiarioFiltersAction>
  meta?:         TripsMeta | null
  /** Estado (bug 5.2, 2026-08-07): se movió acá desde la barra principal —
   *  Cliente ocupó su lugar. Membership/labels ya resueltos por el padre
   *  (page.tsx), este componente solo renderiza. */
  defaultGroups: DefaultGroup[]
  customGroups:  FilterGroup[]
  statusParam:   string
  onEditGroup:   (g: FilterGroup) => void
  onCreateGroup: () => void
  onSaveAsGroup: () => void
}

// ── Custom group color classes (movido desde page.tsx, bug 5.2) ─────────────
const COLOR_CLS: Record<GroupColor, { on: string; off: string }> = {
  blue:   { on: 'bg-blue-500   border-blue-500   text-white', off: 'text-blue-700   border-blue-300   bg-blue-50   hover:border-blue-400'   },
  green:  { on: 'bg-green-500  border-green-500  text-white', off: 'text-green-700  border-green-300  bg-green-50  hover:border-green-400'  },
  orange: { on: 'bg-orange-500 border-orange-500 text-white', off: 'text-orange-700 border-orange-300 bg-orange-50 hover:border-orange-400' },
  purple: { on: 'bg-purple-500 border-purple-500 text-white', off: 'text-purple-700 border-purple-300 bg-purple-50 hover:border-purple-400' },
  red:    { on: 'bg-red-500    border-red-500    text-white', off: 'text-red-700    border-red-300    bg-red-50    hover:border-red-400'    },
  teal:   { on: 'bg-teal-500   border-teal-500   text-white', off: 'text-teal-700   border-teal-300   bg-teal-50   hover:border-teal-400'   },
  amber:  { on: 'bg-amber-500  border-amber-500  text-white', off: 'text-amber-700  border-amber-300  bg-amber-50  hover:border-amber-400'  },
  pink:   { on: 'bg-pink-500   border-pink-500   text-white', off: 'text-pink-700   border-pink-300   bg-pink-50   hover:border-pink-400'   },
  slate:  { on: 'bg-slate-500  border-slate-500  text-white', off: 'text-slate-700  border-slate-300  bg-slate-50  hover:border-slate-400'  },
}

/**
 * Filtros de uso ocasional (Estado, Fuente TMS, Tipo de operación, rango de
 * fechas) fuera de la barra principal — reduce la carga visual del monitor.
 * Cliente vive en la barra principal desde el bug 5.2 (2026-08-07).
 */
export function FilterPopover({
  filters: f, dispatch, meta,
  defaultGroups, customGroups, statusParam, onEditGroup, onCreateGroup, onSaveAsGroup,
}: Props) {
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

          {/* Estado: grupos default + custom (movido desde la barra
              principal, bug 5.2 — Cliente ocupó su lugar acá afuera). */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Estado</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {defaultGroups.map(g => {
                const key = `default:${g.id}`
                const active = f.activeGroup === key
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => dispatch({ type: 'toggleGroup', key })}
                    aria-pressed={active}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${active ? g.on : g.off}`}
                  >
                    {g.label}
                    {active && g.statuses.length > 1 && (
                      <span className="ml-1 opacity-70 text-[9px]">·{g.statuses.length}</span>
                    )}
                  </button>
                )
              })}

              {customGroups.length > 0 && <span className="text-gray-200 text-sm">·</span>}

              {customGroups.map(g => {
                const key = `custom:${g.id}`
                const active = f.activeGroup === key
                const cls = COLOR_CLS[g.color] ?? COLOR_CLS.blue
                return (
                  <span key={g.id} className={`inline-flex items-center rounded-full border transition-all ${active ? cls.on : cls.off}`}>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'toggleGroup', key })}
                      aria-pressed={active}
                      className="text-[11px] font-semibold pl-2.5 pr-1 py-1"
                    >
                      {g.name}
                      {active && g.statuses.length > 1 && (
                        <span className="opacity-70 text-[9px] ml-1">·{g.statuses.length}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onEditGroup(g) }}
                      aria-label={`Editar grupo ${g.name}`}
                      className="pr-2 pl-0.5 py-1 opacity-60 hover:opacity-100 transition-opacity"
                    >
                      <PenLine size={9} />
                    </button>
                  </span>
                )
              })}

              <button
                type="button"
                onClick={onCreateGroup}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-accent hover:text-accent transition-all"
                title="Crear grupo personalizado"
              >
                <Plus size={11} />
                Grupo
              </button>

              {statusParam && (
                <button
                  type="button"
                  onClick={onSaveAsGroup}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-accent/40 text-accent hover:border-accent hover:bg-accent/5 transition-all"
                  title="Guardar el filtro de estado actual como grupo"
                >
                  <Plus size={11} />
                  Guardar como grupo
                </button>
              )}
            </div>
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

          {/* "No asignado por WebCarga" — solo historial, Task 8 (plan
              2026-08-18-cierre-paso-viajes). Pablo: "voy a poder ver todos
              los viajes que alguna vez nos ofrecieron y no asignamos". No
              mira is_active (trips.py), por eso vive junto al rango de
              fechas del historial y no con Activo/Trabajando/Asignado. Es
              la única casilla booleana del popover: se copia el patrón de
              checkbox ya usado en AlertsPopover.tsx en vez de inventar un
              estilo de pill nuevo. */}
          {f.tab === 'historial' && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.fNoAsignadoWebcarga}
                  onChange={() => dispatch({ type: 'patch', patch: { fNoAsignadoWebcarga: !f.fNoAsignadoWebcarga } })}
                  className="shrink-0"
                />
                <span className={`text-xs ${TEXTO_CUERPO}`}>No asignado por WebCarga</span>
              </label>
            </div>
          )}

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
