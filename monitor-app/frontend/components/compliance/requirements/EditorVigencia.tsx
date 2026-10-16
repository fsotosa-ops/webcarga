'use client'

import type { ReactNode } from 'react'
import { CalendarClock } from 'lucide-react'
import type { PoliticaVencimiento } from '@/lib/types'
import { ejemploDeVigencia, type Vigencia } from '@/lib/vigencia'

/** Cómo vence un tipo de documento (HU-C1, entrega 2b).
 *
 *  Es el MISMO control al crear y al editar (HU-C1, regla 7). Cuatro tipos
 *  cerrados, como los trabaja la planilla de WebCarga: la regla se escribe como
 *  una frase con sus campos adentro, y debajo un ejemplo con fechas reales para
 *  confirmar que la regla dice lo que la planilla dice (patrón de "repetir" de
 *  Google Calendar y de los recordatorios de renovación de Fleetio).
 *
 *  Se llama "¿Cuándo vence?" y no "Vigencia": en esta pantalla "Vigente" ya
 *  significa que el documento se exige (`is_active`). */

type Tipo = 'NONE' | 'FECHA' | 'ISSUE_PLUS_MONTHS' | 'CALENDAR_PERIOD'

const TIPOS: { tipo: Tipo; titulo: string; ayuda: string }[] = [
  { tipo: 'NONE',              titulo: 'No vence',                         ayuda: 'Se presenta una vez (ej. Padrón, Finiquito)' },
  { tipo: 'FECHA',             titulo: 'Vence en la fecha del documento',  ayuda: 'La fecha viene impresa (ej. Licencia, SOAP)' },
  { tipo: 'ISSUE_PLUS_MONTHS', titulo: 'Dura un plazo desde que se emite', ayuda: 'Anual o bienal (ej. Matriz IPER, RIOHS)' },
  { tipo: 'CALENDAR_PERIOD',   titulo: 'Se renueva cada período',          ayuda: 'Mensual con día tope (ej. F30, cotizaciones)' },
]

const tipoDe = (p: PoliticaVencimiento): Tipo =>
  p === 'REQUIRED' || p === 'OPTIONAL' ? 'FECHA' : p

/** Al cambiar de tipo quedan solo los parámetros del tipo nuevo; el aviso y la
 *  gracia, que valen para todos, se conservan. Lo que el tipo necesita y no
 *  tiene arranca con el valor más común de la planilla (12 meses; mensual, mes
 *  anterior, aviso 5), salvo el día tope, que se pide. */
function conTipo(v: Vigencia, tipo: Tipo): Vigencia {
  const comunes: Partial<Vigencia> = {}
  if (v.warning_days !== undefined) comunes.warning_days = v.warning_days
  if (v.grace_days !== undefined) comunes.grace_days = v.grace_days
  switch (tipo) {
    case 'NONE':
      return { politica: 'NONE' }
    case 'FECHA':
      return { politica: v.politica === 'OPTIONAL' ? 'OPTIONAL' : 'REQUIRED', ...comunes }
    case 'ISSUE_PLUS_MONTHS':
      return { politica: 'ISSUE_PLUS_MONTHS', validity_months: v.validity_months ?? 12, ...comunes }
    case 'CALENDAR_PERIOD':
      return {
        politica: 'CALENDAR_PERIOD',
        frequency_months: v.frequency_months ?? 1,
        cutoff_day: v.cutoff_day ?? null,
        period_offset_months: v.period_offset_months ?? 1,
        ...comunes,
        warning_days: v.warning_days ?? 5,
      }
  }
}

const CAMPO = 'mx-1 w-14 rounded-md border border-border bg-white px-1.5 py-0.5 text-center text-dato '
  + 'tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60'

function Numero({ etiqueta, valor, min, max, disabled, onCambiar }: {
  etiqueta: string
  valor: number | null | undefined
  min: number
  max?: number
  disabled?: boolean
  onCambiar: (n: number | null) => void
}) {
  return (
    <input
      type="number"
      aria-label={etiqueta}
      min={min}
      max={max}
      value={valor ?? ''}
      disabled={disabled}
      onChange={e => onCambiar(e.target.value === '' ? null : Number(e.target.value))}
      className={CAMPO}
    />
  )
}

function Tarjeta({ elegida, disabled, titulo, ayuda, onElegir, children }: {
  elegida: boolean
  disabled?: boolean
  titulo: string
  ayuda: string
  onElegir: () => void
  children?: ReactNode
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${elegida ? 'border-accent bg-accent/5' : 'border-border'}`}>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name="tipo-de-vencimiento"
          aria-label={titulo}
          checked={elegida}
          disabled={disabled}
          onChange={onElegir}
          className="mt-0.5 accent-accent"
        />
        <span>
          <span className="block text-dato font-semibold text-text-primary">{titulo}</span>
          <span className="block text-etiqueta text-informativo">{ayuda}</span>
        </span>
      </label>
      {elegida && children && <div className="mt-2 pl-6 text-dato text-text-primary">{children}</div>}
    </div>
  )
}

export function EditorVigencia({ value, onChange, disabled = false }: {
  value: Vigencia
  onChange: (v: Vigencia) => void
  disabled?: boolean
}) {
  const tipo = tipoDe(value.politica)
  const poner = (cambio: Partial<Vigencia>) => onChange({ ...value, ...cambio })

  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-semibold text-text-primary">¿Cuándo vence?</legend>
      <div className="mt-2 space-y-1.5">
        {TIPOS.map(t => (
          <Tarjeta
            key={t.tipo}
            elegida={tipo === t.tipo}
            disabled={disabled}
            titulo={t.titulo}
            ayuda={t.ayuda}
            onElegir={() => onChange(conTipo(value, t.tipo))}
          >
            {t.tipo === 'FECHA' && (
              <div className="flex flex-wrap gap-3">
                {(['REQUIRED', 'OPTIONAL'] as const).map(p => (
                  <label key={p} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="fecha-del-documento"
                      aria-label={p === 'REQUIRED' ? 'Fecha obligatoria' : 'Fecha opcional'}
                      checked={value.politica === p}
                      disabled={disabled}
                      onChange={() => poner({ politica: p })}
                      className="accent-accent"
                    />
                    {p === 'REQUIRED' ? 'Obligatoria' : 'Opcional'}
                  </label>
                ))}
              </div>
            )}
            {t.tipo === 'ISSUE_PLUS_MONTHS' && (
              <p className="leading-loose">
                Dura
                <Numero etiqueta="Meses que dura" valor={value.validity_months} min={1}
                        disabled={disabled} onCambiar={n => poner({ validity_months: n })} />
                meses desde que se emite.
              </p>
            )}
            {t.tipo === 'CALENDAR_PERIOD' && (
              <p className="leading-loose">
                Cada
                <Numero etiqueta="Cada cuántos meses" valor={value.frequency_months} min={1}
                        disabled={disabled} onCambiar={n => poner({ frequency_months: n })} />
                mes, a más tardar el día
                <Numero etiqueta="Día tope" valor={value.cutoff_day} min={1} max={31}
                        disabled={disabled} onCambiar={n => poner({ cutoff_day: n })} />
                , el documento del
                <select
                  aria-label="De qué mes es"
                  value={value.period_offset_months ?? ''}
                  disabled={disabled}
                  onChange={e => poner({ period_offset_months: Number(e.target.value) })}
                  className="mx-1 rounded-md border border-border bg-white px-1.5 py-0.5 text-dato
                             focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
                >
                  <option value={1}>mes anterior</option>
                  <option value={0}>mes en curso</option>
                </select>
                .
              </p>
            )}
          </Tarjeta>
        ))}
      </div>

      {tipo !== 'NONE' && (
        <p className="mt-2 leading-loose text-dato text-text-primary">
          Avisar
          <Numero etiqueta="Días de aviso" valor={value.warning_days} min={0}
                  disabled={disabled} onCambiar={n => poner({ warning_days: n })} />
          días antes · tolerar
          <Numero etiqueta="Días de gracia" valor={value.grace_days ?? 0} min={0}
                  disabled={disabled} onCambiar={n => poner({ grace_days: n ?? 0 })} />
          días después.
        </p>
      )}

      <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-border bg-accent/5 px-3 py-2
                    text-etiqueta text-text-primary" aria-live="polite">
        <CalendarClock size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        {ejemploDeVigencia(value, new Date())}
      </p>
    </fieldset>
  )
}
