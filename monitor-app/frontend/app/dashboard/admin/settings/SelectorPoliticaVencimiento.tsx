import type { PoliticaVencimiento } from '@/lib/types'

/** Qué hace el sistema con la fecha de vencimiento de un documento.
 *
 *  Es el MISMO control al crear y al editar (HU-C1, regla 7). Que "Nuevo
 *  documento" no lo tuviera hizo que el F30-1 naciera sin vencimiento: la
 *  política existía y se podía editar después, pero nadie la ve al crear.
 *
 *  Antes esto era `has_expiration`, un booleano con tres significados: "no
 *  vence" y "vence" compartían casilla con "la fecha es obligatoria", y por
 *  eso la carga rechazaba con 422 documentos cuya fecha la pantalla nunca
 *  pedía. Los tres estados se nombran, y quien decide cuál es cada documento
 *  es negocio, no un despliegue. */
export function SelectorPoliticaVencimiento({ value, onChange, disabled = false }: {
  value: PoliticaVencimiento
  onChange: (politica: PoliticaVencimiento) => void
  disabled?: boolean
}) {
  return (
    <label className="mt-4 block">
      <span className="text-etiqueta font-semibold uppercase tracking-wider text-informativo">
        Fecha de vencimiento
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value as PoliticaVencimiento)}
        className="mt-1 w-full text-dato border border-border rounded-lg px-2 py-1.5 bg-white
                   disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        <option value="REQUIRED">Obligatoria — sin ella el documento no se acepta</option>
        <option value="OPTIONAL">Opcional — se acepta y la fecha queda pendiente</option>
        <option value="NONE">No aplica — este documento no vence</option>
      </select>
    </label>
  )
}
