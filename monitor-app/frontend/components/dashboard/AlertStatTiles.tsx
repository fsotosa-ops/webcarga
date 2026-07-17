'use client'

export type AlertStatTile = {
  id:    string
  label: string
  value: number
  tone:  'neutral' | 'danger' | 'success'
}

interface Props {
  tiles:    AlertStatTile[]
  active:   string
  onSelect: (id: string) => void
}

const TONE_VALUE_CLS: Record<AlertStatTile['tone'], string> = {
  neutral: 'text-text-primary',
  danger:  'text-red-600',
  success: 'text-green-600',
}

/** Fila de tiles clickeables que resumen + filtran por compliance_health —
 *  reemplaza tabs de pill apiladas cuando ya hay otro eje de tabs (ej.
 *  Activas/Legacy) compitiendo por el mismo espacio. Mismo patrón en
 *  Empresas y en los rosters de Conductores/Equipos dentro de la ficha,
 *  para poder triagear y actuar rápido en los tres niveles (pedido
 *  explícito del usuario). Activas/Legacy se queda como tabs de pill
 *  (membresía mutuamente excluyente real); esto es para el eje de
 *  severidad, que además deja espacio para más ejes a futuro sin apilar
 *  una tercera fila de tabs. */
export function AlertStatTiles({ tiles, active, onSelect }: Props) {
  return (
    <div className={`grid gap-2.5`} style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map(t => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            aria-pressed={isActive}
            className={`text-left px-3.5 py-2.5 rounded-xl border transition-all ${
              isActive ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-border bg-white hover:border-gray-300'
            }`}
          >
            <p className={`text-xl font-bold leading-none ${TONE_VALUE_CLS[t.tone]}`}>{t.value}</p>
            <p className="text-[11px] text-gray-400 mt-1">{t.label}</p>
          </button>
        )
      })}
    </div>
  )
}
