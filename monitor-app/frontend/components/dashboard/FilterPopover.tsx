'use client'

import { Children, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X, Plus, PenLine } from 'lucide-react'
import type { TripsMeta } from '@/lib/types'
import type { FilterGroup } from '@/lib/api/filterGroups'
import type { DiarioFilters, DiarioFiltersAction } from '@/hooks/useDiarioFilters'
import { countPopoverFilters } from '@/hooks/useDiarioFilters'
import { TEXTO_CUERPO } from '@/lib/ui/texto'
import { GROUP_COLORS } from '@/lib/ui/groupColors'
import { Button } from '@/components/ui/Button'
import { Popover } from '@/components/ui/Popover'
import { ToggleChip } from '@/components/ui/ToggleChip'
import { inputClass } from '@/components/ui/Field'

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

/** Un apartado del panel: su nombre y sus chips. Sin opciones no se dibuja: un título
 *  sin nada debajo parece un filtro roto. */
function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  if (Children.toArray(children).length === 0) return null
  return (
    <div>
      <p className="mb-1.5 text-etiqueta font-semibold text-informativo">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

/** Las acciones de grupo ("+ Grupo", "Guardar como grupo"): un chip punteado, porque
 *  crean algo en vez de filtrar. */
const ACTION_CHIP = 'flex items-center gap-1 rounded-full border border-dashed px-2 py-1 text-etiqueta font-semibold transition-colors'

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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const count = countPopoverFilters(f)
  /** Una acción de grupo abre un diálogo: el panel se cierra antes, como un menú. */
  const closeThen = (accion: () => void) => () => { setOpen(false); accion() }

  return (
    <>
      <Button ref={buttonRef} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}
        className={count > 0 ? 'border-accent/40 bg-accent/5 text-accion' : ''}>
        <SlidersHorizontal size={13} aria-hidden="true" />
        Filtros
        {count > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-etiqueta font-bold text-white">
            {count}
          </span>
        )}
      </Button>

      <Popover anchor={buttonRef} open={open} onClose={() => setOpen(false)} label="Filtros adicionales" align="end" width={288}>
        <div className="space-y-4 p-2">
          <div className="flex items-center justify-between">
            <p className="text-etiqueta font-semibold text-informativo">Filtros</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar filtros"
              className="text-informativo hover:text-text-primary">
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Estado: grupos default + custom (movido desde la barra
              principal, bug 5.2 — Cliente ocupó su lugar acá afuera). */}
          <FilterSection label="Estado">
            {defaultGroups.map(g => {
              const key = `default:${g.id}`
              const active = f.activeGroup === key
              return (
                <ToggleChip key={g.id} pressed={active} tone={{ on: g.on, off: g.off }}
                  onClick={() => dispatch({ type: 'toggleGroup', key })}>
                  {g.label}
                  {active && g.statuses.length > 1 && <span className="ml-1 opacity-70">·{g.statuses.length}</span>}
                </ToggleChip>
              )
            })}

            {customGroups.length > 0 && <span aria-hidden="true" className="text-informativo">·</span>}

            {customGroups.map(g => {
              const key = `custom:${g.id}`
              const active = f.activeGroup === key
              const tone = (GROUP_COLORS[g.color] ?? GROUP_COLORS.blue).chip
              return (
                <span key={g.id} className={`inline-flex items-center rounded-full border transition-colors ${active ? tone.on : tone.off}`}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'toggleGroup', key })}
                    aria-pressed={active}
                    className="py-1 pl-2.5 pr-1 text-etiqueta font-semibold"
                  >
                    {g.name}
                    {active && g.statuses.length > 1 && <span className="ml-1 opacity-70">·{g.statuses.length}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); closeThen(() => onEditGroup(g))() }}
                    aria-label={`Editar grupo ${g.name}`}
                    className="py-1 pl-0.5 pr-2 opacity-60 transition-opacity hover:opacity-100"
                  >
                    <PenLine size={11} aria-hidden="true" />
                  </button>
                </span>
              )
            })}

            <button
              type="button"
              onClick={closeThen(onCreateGroup)}
              className={`${ACTION_CHIP} border-border text-informativo hover:border-accent hover:text-accion`}
              title="Crear grupo personalizado"
            >
              <Plus size={11} aria-hidden="true" />
              Grupo
            </button>

            {statusParam && (
              <button
                type="button"
                onClick={closeThen(onSaveAsGroup)}
                className={`${ACTION_CHIP} border-accent/40 text-accion hover:border-accent hover:bg-accent/5`}
                title="Guardar el filtro de estado actual como grupo"
              >
                <Plus size={11} aria-hidden="true" />
                Guardar como grupo
              </button>
            )}
          </FilterSection>

          <FilterSection label="Fuente">
            {(meta?.tms_sources ?? []).map(src => (
              <ToggleChip key={src.id} pressed={f.fTms.includes(src.id)} onClick={() => dispatch({ type: 'toggleTms', id: src.id })}>
                {src.label}
              </ToggleChip>
            ))}
          </FilterSection>

          {/* Indicadores (Activo/Trabajando/Asignado) se movieron a tiles
              visibles arriba de la tabla, junto a las KPI cards — Fase 3
              del hardening del Diario, 2026-07-18. Ya no viven acá. */}

          {/* Tipo de operación (RM/Zona Cero) — reemplaza el filtro de
              región/ciudad de origen (Fase 2, Plan 7). Filtra por destino,
              no por origen (swap 2026-08-02, ítem 12 de la minuta) — ya
              viene resuelto en cada TripStop de GET /trips, el filtro es
              100% client-side, mismo mecanismo que las alertas KPI de la
              Ronda 26. */}
          <FilterSection label="Tipo de operación">
            {(meta?.operation_types ?? []).map(ot => (
              <ToggleChip key={ot.id} pressed={f.fOperationType.includes(ot.id)} onClick={() => dispatch({ type: 'toggleOperationType', id: ot.id })}>
                {ot.label}
              </ToggleChip>
            ))}
          </FilterSection>

          {/* Tipo de carga — catálogo de app.temperature_ranges (ya
              disponible en meta, sin fetch nuevo). */}
          <FilterSection label="Tipo de carga">
            {(meta?.temperature_ranges ?? []).map(tr => (
              <ToggleChip key={tr.cargo_type} pressed={f.fCargoType.includes(tr.cargo_type)} onClick={() => dispatch({ type: 'toggleCargoType', id: tr.cargo_type })}>
                {tr.label}
              </ToggleChip>
            ))}
          </FilterSection>

          {/* Origen — chips dinámicas desde la base, igual que Fuente y
              Cliente. Era un autocomplete con el argumento de que son
              "cientos de locales reales": cierto para los DESTINOS —279
              distintos— y falso para los orígenes, que medidos el 2026-09-07
              son 23 en todo el histórico y cinco concentran el 98% del
              volumen. Con eso una lista se lee de un vistazo, y el
              autocomplete obligaba a saber el nombre antes de buscarlo.

              Vienen ordenadas por volumen y no alfabéticamente: los CD que
              mueven la operación tienen que estar arriba. */}
          <FilterSection label="Origen">
            {(meta?.origins ?? []).map(name => (
              <ToggleChip key={name} pressed={f.fOrigin.includes(name)} onClick={() => dispatch({ type: 'toggleOrigin', id: name })}>
                {name}
              </ToggleChip>
            ))}
          </FilterSection>

          {/* "No asignado por WebCarga" — solo historial, Task 8 (plan
              2026-08-18-cierre-paso-viajes). Pablo: "voy a poder ver todos
              los viajes que alguna vez nos ofrecieron y no asignamos". No
              mira is_active (trips.py), por eso vive junto al rango de
              fechas del historial y no con Activo/Trabajando/Asignado. Es
              la única casilla booleana del popover: se copia el patrón de
              checkbox ya usado en AlertsPopover.tsx en vez de inventar un
              estilo de pill nuevo. */}
          {f.tab === 'historial' && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={f.fNoAsignadoWebcarga}
                onChange={() => dispatch({ type: 'patch', patch: { fNoAsignadoWebcarga: !f.fNoAsignadoWebcarga } })}
                className="shrink-0 accent-accent"
              />
              <span className={`text-dato ${TEXTO_CUERPO}`}>No asignado por WebCarga</span>
            </label>
          )}

          {/* Rango de fechas — solo historial */}
          {f.tab === 'historial' && (
            <div>
              <p className="mb-1.5 text-etiqueta font-semibold text-informativo">Rango de fechas</p>
              <div className="flex items-center gap-1.5">
                <input type="date" value={f.fechaDesde} aria-label="Desde"
                  onChange={e => dispatch({ type: 'patch', patch: { fechaDesde: e.target.value } })}
                  className={`${inputClass({ size: 'sm' })} min-w-0 flex-1`} />
                <span className="shrink-0 text-dato text-informativo">a</span>
                <input type="date" value={f.fechaHasta} aria-label="Hasta"
                  onChange={e => dispatch({ type: 'patch', patch: { fechaHasta: e.target.value } })}
                  className={`${inputClass({ size: 'sm' })} min-w-0 flex-1`} />
              </div>
            </div>
          )}
        </div>
      </Popover>
    </>
  )
}
