'use client'

import { useState } from 'react'
import { Map } from 'lucide-react'
import { useTourContext, type TourModule } from './tourContext'

const MODULE_LABELS: Record<TourModule, string> = {
  diario:         'Diario de Viajes',
  transportistas: 'Empresas',
  admin:          'Administración',
}

export function TourProgressButton() {
  const [open, setOpen] = useState(false)
  const { completedModules, startTour, resetAll, allCompleted, TOUR_SEQUENCE } = useTourContext()

  const completedCount = completedModules.length
  const totalCount = TOUR_SEQUENCE.length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        title={allCompleted ? 'Repetir tour' : `Tour: ${completedCount}/${totalCount} módulos`}
      >
        <Map size={17} className="text-gray-500" />
        {!allCompleted && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
            {completedCount}/{totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 bg-white border border-border rounded-xl shadow-lg z-50 w-52 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/60">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {allCompleted ? 'Tour completado 🎉' : `Tour guiado · ${completedCount}/${totalCount}`}
            </p>
          </div>
          {TOUR_SEQUENCE.map(module => {
            const done = completedModules.includes(module)
            return (
              <button
                key={module}
                onClick={() => { setOpen(false); startTour(module) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-gray-50 transition-colors text-left"
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                  done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  {done ? '✓' : '○'}
                </span>
                {MODULE_LABELS[module]}
              </button>
            )
          })}
          {allCompleted && (
            <button
              onClick={() => { setOpen(false); resetAll(); startTour('diario') }}
              className="w-full px-3 py-2.5 text-xs font-medium text-accent hover:bg-accent/5 transition-colors text-left border-t border-border/60"
            >
              Repetir tour completo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
