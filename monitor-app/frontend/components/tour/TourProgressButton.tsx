'use client'

import { useState } from 'react'
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
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        title={allCompleted ? 'Repetir tour' : `Tour: ${completedCount}/${totalCount} módulos`}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all"
        style={{
          background: allCompleted
            ? 'rgba(28,185,236,0.06)'
            : 'rgba(28,185,236,0.08)',
          border: '1px solid rgba(28,185,236,0.2)',
        }}
      >
        <span style={{ color: '#1cb9ec', fontSize: '12px', lineHeight: 1 }}>◈</span>
        <span className="text-[11px] font-semibold" style={{ color: '#38bdf8' }}>Tour</span>
        {/* Progress dots */}
        <div className="flex items-center gap-0.5 ml-0.5">
          {TOUR_SEQUENCE.map((m) => (
            <div
              key={m}
              className="rounded-full"
              style={{
                width: '5px',
                height: '5px',
                background: completedModules.includes(m)
                  ? '#1cb9ec'
                  : 'rgba(255,255,255,0.15)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>
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
