'use client'

import type { ExigibleOn, RequirementOption } from '@/lib/types'
import { faltaDeVigencia, resumenDeVigencia, type Vigencia } from '@/lib/vigencia'
import { RENOVACIONES, renovacionDe, vigenciaPara, type Renovacion } from './borrador'
import { exigibilidadesPara, OPCIONES_DE_EXIGIBILIDAD } from './SelectorExigibilidad'

/** Las celdas que escriben en el BORRADOR de la tabla (HU-C1, entrega 2c),
 *  no en la base: cada una recibe su valor y avisa el cambio. Guardar es
 *  "Publicar", para todo el borrador junto (ver borrador.ts).
 *
 *  Un clic por cambio: son controles nativos siempre visibles, no celdas que
 *  hay que abrir. Sin permiso, la misma celda se lee como texto. */

// Un control que se ve como texto hasta que se pasa el mouse o se enfoca: la
// tabla no parece un formulario, pero cada celda se edita donde está.
const CONTROL = `rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-text-primary
  hover:border-border hover:bg-white focus:border-accent focus:bg-white focus:outline-none
  focus-visible:ring-2 focus-visible:ring-accent/30 cursor-pointer`
const NUMERO = `${CONTROL} w-12 text-right tabular-nums cursor-text placeholder:text-informativo`
// El cambio sin publicar se marca en la celda: con 96 filas, el pie de página
// dice cuántos, y la celda dice cuáles.
export const CAMBIADA = 'bg-accent/5 shadow-[inset_2px_0_0_var(--accent)]'

function numero(valor: string): number | null {
  const n = parseInt(valor, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function CeldaRenovacion({ requisito, vigencia, puedeEditar, onCambiar }: {
  requisito: RequirementOption
  vigencia: Vigencia
  puedeEditar: boolean
  onCambiar: (v: Vigencia) => void
}) {
  const actual = renovacionDe(vigencia)
  const falta = faltaDeVigencia(vigencia)
  if (!puedeEditar) return <span className="text-xs text-text-primary">{resumenDeVigencia(vigencia)}</span>

  return (
    <div>
      <div className="flex items-center gap-0.5 whitespace-nowrap">
        <select
          value={actual}
          onChange={e => onCambiar(vigenciaPara(e.target.value as Exclude<Renovacion, 'otra'>, vigencia))}
          aria-label={`Cómo se renueva ${requisito.name}`}
          className={`${CONTROL} max-w-[10.5rem]`}
        >
          {/* Una regla que la celda no sabe escribir se muestra tal cual y se
              edita en el panel: colapsarla en la más parecida la cambiaría
              sin que nadie lo pidiera. */}
          {actual === 'otra' && <option value="otra" disabled>{resumenDeVigencia(vigencia)}</option>}
          {RENOVACIONES.map(r => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
        </select>
        {actual === 'mes' && (
          <>
            <span className="text-etiqueta text-informativo">día</span>
            <input
              type="number" min={1} max={31} inputMode="numeric"
              value={vigencia.cutoff_day ?? ''}
              placeholder="—"
              onChange={e => onCambiar({ ...vigencia, cutoff_day: numero(e.target.value) })}
              aria-label={`Día tope de ${requisito.name}`}
              className={`${NUMERO} w-10`}
            />
            <span className="text-etiqueta text-informativo">con el del</span>
            <select
              value={vigencia.period_offset_months ?? 1}
              onChange={e => onCambiar({ ...vigencia, period_offset_months: Number(e.target.value) })}
              aria-label={`De qué mes es ${requisito.name}`}
              className={CONTROL}
            >
              <option value={1}>mes anterior</option>
              <option value={0}>mes en curso</option>
            </select>
          </>
        )}
      </div>
      {falta && <div className="px-1.5 text-etiqueta text-status-incidente">{falta}</div>}
    </div>
  )
}

/** Días de aviso. Vacío = el aviso general de Configuración › Alertas, salvo
 *  en un mensual, donde la base lo exige (con 30 estaría siempre por vencer). */
export function CeldaAviso({ requisito, vigencia, puedeEditar, onCambiar }: {
  requisito: RequirementOption
  vigencia: Vigencia
  puedeEditar: boolean
  onCambiar: (v: Vigencia) => void
}) {
  if (vigencia.politica === 'NONE') return <span className="px-1.5 text-xs text-informativo">—</span>
  const general = vigencia.politica !== 'CALENDAR_PERIOD'
  if (!puedeEditar) {
    return (
      <span className="text-xs tabular-nums text-text-primary">
        {vigencia.warning_days ?? <span className="text-informativo">general</span>}
      </span>
    )
  }
  return (
    <input
      type="number" min={0} inputMode="numeric"
      value={vigencia.warning_days ?? ''}
      placeholder={general ? 'general' : 'falta'}
      title={general ? 'Vacío: usa el aviso general de Configuración › Alertas' : undefined}
      onChange={e => onCambiar({ ...vigencia, warning_days: numero(e.target.value) })}
      aria-label={`Días de aviso de ${requisito.name}`}
      className={`${NUMERO} w-16`}
    />
  )
}

export function CeldaExigible({ requisito, valor, puedeEditar, onCambiar }: {
  requisito: RequirementOption
  valor: ExigibleOn
  puedeEditar: boolean
  onCambiar: (v: ExigibleOn) => void
}) {
  if (!puedeEditar) {
    const texto = OPCIONES_DE_EXIGIBILIDAD.find(o => o.valor === valor)?.corto ?? valor
    return <span className="text-xs text-text-primary">{texto}</span>
  }
  return (
    <select
      value={valor}
      onChange={e => onCambiar(e.target.value as ExigibleOn)}
      aria-label={`Cuándo se exige ${requisito.name}`}
      className={`${CONTROL} max-w-[9.5rem]`}
    >
      {exigibilidadesPara(requisito.target_entity).map(o => (
        <option key={o.valor} value={o.valor} title={o.ayuda}>{o.corto}</option>
      ))}
    </select>
  )
}

/** Vigente o no. Activarlo siembra un pendiente por cada entidad que
 *  califique: el número se ve en "Ver efecto" antes de publicar. */
export function CeldaVigente({ requisito, valor, puedeEditar, onCambiar }: {
  requisito: RequirementOption
  valor: boolean
  puedeEditar: boolean
  onCambiar: (v: boolean) => void
}) {
  if (!puedeEditar) {
    return <span className={`text-xs ${valor ? 'text-resuelto' : 'text-informativo'}`}>
      {valor ? 'Vigente' : 'Sin vigencia'}
    </span>
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={valor}
      aria-label={`${requisito.name} vigente`}
      onClick={() => onCambiar(!valor)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-accent/40 ${valor ? 'bg-accent' : 'bg-border'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-[left]
                    ${valor ? 'left-[16px]' : 'left-[2px]'}`}
      />
    </button>
  )
}

/** Obligatorio u opcional: lo cuentan la ficha y el semáforo del Diario. Un
 *  tercer valor (`SHIPPER_REQUIRED`, placeholder sin filas) se muestra y no se
 *  toca, en vez de colapsarlo en "Obligatorio" sin que nadie lo pida. */
export function CeldaNivel({ requisito, valor, puedeEditar, onCambiar }: {
  requisito: RequirementOption
  valor: RequirementOption['requirement_level']
  puedeEditar: boolean
  onCambiar: (v: RequirementOption['requirement_level']) => void
}) {
  const obligatorio = valor === 'LEGAL_MANDATORY'
  const conocido = obligatorio || valor === 'CONDITIONAL_OPTIONAL'
  const clase = obligatorio ? 'bg-accent/10 text-accent' : 'bg-bg-main text-informativo'
  const texto = conocido ? (obligatorio ? 'Obligatorio' : 'Opcional') : valor

  if (!puedeEditar || !conocido) {
    return <span className={`rounded px-2 py-0.5 text-etiqueta font-semibold ${clase}`}>{texto}</span>
  }
  return (
    <button
      type="button"
      onClick={() => onCambiar(obligatorio ? 'CONDITIONAL_OPTIONAL' : 'LEGAL_MANDATORY')}
      aria-label={`Cambiar ${requisito.name} a ${obligatorio ? 'opcional' : 'obligatorio'}`}
      className={`rounded px-2 py-0.5 text-etiqueta font-semibold ${clase} hover:opacity-80
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
    >
      {texto}
    </button>
  )
}
