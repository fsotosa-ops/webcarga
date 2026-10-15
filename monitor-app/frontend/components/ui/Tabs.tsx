export type TabOption<T extends string> = {
  id: T
  label: string
  /** Cuántos hay; `null` no muestra nada. */
  count?: number | null
  /** El conteo en rojo: lo que falta o está vencido. */
  urgent?: boolean
}

/** Las pestañas de una ficha: una sección visible a la vez, cero scroll entre
 *  ellas. Salieron de la ficha de empresa para que la de conductor y equipo
 *  (D4) sean la misma barra y no una copia. Para filtrar una lista se usa
 *  `SegmentedControl`, no esto. */
export function Tabs<T extends string>({ label, tabs, value, onChange }: {
  label:    string
  tabs:     TabOption<T>[]
  value:    T
  onChange: (id: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
      {tabs.map(t => {
        const active = value === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={`shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              active ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`ml-1.5 ${t.urgent ? 'text-status-incidente font-bold' : 'text-gray-400'}`}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
