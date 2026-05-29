'use client'

import { useState } from 'react'
import { Compass } from 'lucide-react'
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
      {/* Trigger button — same style as Bell */}
      <button
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title={allCompleted ? 'Repetir tour' : `Tour guiado · ${completedCount}/${totalCount} módulos`}
        className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <Compass size={17} className="text-gray-500" />
        {!allCompleted && completedCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-accent text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
            {completedCount}
          </span>
        )}
        {!allCompleted && completedCount === 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-accent rounded-full" />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 rounded-xl overflow-hidden z-50 w-52"
          style={{
            background: 'rgba(15,23,42,0.97)',
            border: '1px solid rgba(28,185,236,0.2)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          }}
        >
          {/* Accent bar */}
          <div style={{ height: '2px', background: 'linear-gradient(90deg, #1cb9ec, #0e8db5)' }} />

          <div className="px-3 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#38bdf8' }}>
              {allCompleted ? 'Tour completado ✓' : `Tour guiado · ${completedCount}/${totalCount}`}
            </p>
          </div>

          {TOUR_SEQUENCE.map(module => {
            const done = completedModules.includes(module)
            return (
              <button
                key={module}
                onClick={() => { setOpen(false); startTour(module) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-left transition-colors"
                style={{ color: done ? '#94a3b8' : '#e2e8f0' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(28,185,236,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] shrink-0 font-bold"
                  style={{
                    background: done ? 'rgba(28,185,236,0.15)' : 'rgba(255,255,255,0.06)',
                    color: done ? '#1cb9ec' : '#475569',
                    border: `1px solid ${done ? 'rgba(28,185,236,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {done ? '✓' : '○'}
                </span>
                {MODULE_LABELS[module]}
              </button>
            )
          })}

          {allCompleted && (
            <button
              onClick={() => { setOpen(false); resetAll(); startTour('diario') }}
              className="w-full px-3 py-2.5 text-xs font-semibold text-left transition-opacity hover:opacity-80"
              style={{
                borderTop: '1px solid rgba(255,255,255,0.06)',
                color: '#38bdf8',
              }}
            >
              Repetir tour completo →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
