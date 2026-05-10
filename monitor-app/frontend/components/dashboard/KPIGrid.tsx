import KPICard from './KPICard'
import type { DiarioTrip } from '@/lib/types'

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  'ASIGNADO':           { label: 'Asignados', color: '#053bfa' },
  'ORIGEN':             { label: 'En Origen', color: '#8a00dd' },
  'RUTA':               { label: 'En Ruta', color: '#62a420' },
  'EN LOCAL':           { label: 'En Local', color: '#ea6b25' },
  'RETORNANDO':         { label: 'Retornando', color: '#1cb9ec' },
  'CERRADO FINALIZADO': { label: 'Finalizados', color: '#6b7280' },
  'CANCELADO':          { label: 'Cancelados', color: '#b00020' },
  'CERRADO INCOMPLETO': { label: 'Incompletos', color: '#f59e0b' },
}

interface KPIGridProps {
  trips: DiarioTrip[]
}

export default function KPIGrid({ trips }: KPIGridProps) {
  const counts = trips.reduce<Record<string, number>>((acc, t) => {
    const status = t.normalized_status ?? 'SIN ESTADO'
    acc[status] = (acc[status] ?? 0) + 1
    return acc
  }, {})

  const total = trips.length

  const cards = Object.entries(STATUS_CONFIG).map(([key, { label, color }]) => ({
    title: label,
    value: counts[key] ?? 0,
    color,
  }))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Resumen del día</h2>
        <span className="text-xs text-gray-400">{total} viajes totales</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {cards.map(card => (
          <KPICard key={card.title} {...card} />
        ))}
      </div>
    </div>
  )
}
