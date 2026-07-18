'use client'

import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { TripsMeta } from '@/lib/types'
import type { DiarioFilters, DiarioFiltersAction, FlagField } from '@/hooks/useDiarioFilters'
import { countPopoverFilters } from '@/hooks/useDiarioFilters'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'

const FLAGS: { label: string; field: FlagField }[] = [
  { label: 'Activo',     field: 'fIsActive'        },
  { label: 'Trabajando', field: 'fIsWorking'    },
  { label: 'Asignado',   field: 'fIsAssigned'      },
  { label: '1ra Vuelta', field: 'fIsFirstLeg' },
]

interface Props {
  filters:  DiarioFilters
  dispatch: React.Dispatch<DiarioFiltersAction>
  meta?:    TripsMeta | null
}

/**
 * Filtros de uso ocasional (Fuente TMS, Indicadores, rango de fechas) fuera de
 * la barra principal — reduce la carga visual del monitor de ~25 a ~10 controles.
 */
export function FilterPopover({ filters: f, dispatch, meta }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef  = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

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

          {/* Indicadores (relevantes para viajes manuales) */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Indicadores</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {FLAGS.map(flag => {
                const active = f[flag.field] === true
                return (
                  <button
                    key={flag.field}
                    type="button"
                    onClick={() => dispatch({ type: 'toggleFlag', field: flag.field })}
                    aria-pressed={active}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                      active
                        ? 'bg-accent border-accent text-white'
                        : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {flag.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Ubicación de origen (región/ciudad asignada desde el Monitor) */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Ubicación de origen</p>
            <RegionCityPicker
              size="sm"
              region={f.fRegion || null}
              city={f.fCity || null}
              onChange={(region, city) => dispatch({ type: 'patch', patch: { fRegion: region ?? '', fCity: city ?? '' } })}
              labelSuffix="(filtro)"
            />
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
