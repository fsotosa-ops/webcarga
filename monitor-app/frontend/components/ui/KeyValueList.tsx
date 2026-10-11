import type { ReactNode } from 'react'

export type KeyValueItem = { label: string; value: ReactNode }

/** Rótulo y valor en dos columnas, como una lista de definiciones: el lector de
 *  pantalla los anuncia emparejados. El valor ausente lo dice quien llama ("Sin
 *  teléfono"), nunca un guion que no explica nada. */
export function KeyValueList({ items }: { items: KeyValueItem[] }) {
  return (
    <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 text-dato">
      {items.map(item => (
        <div key={item.label} className="contents">
          <dt className="text-informativo">{item.label}</dt>
          <dd className="m-0 min-w-0 text-text-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
