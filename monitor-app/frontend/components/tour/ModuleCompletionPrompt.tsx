'use client'

import { useRouter } from 'next/navigation'
import { useTourContext, type TourModule } from './tourContext'

const MODULE_LABELS: Record<TourModule, string> = {
  diario:          'Diario de Viajes',
  transportistas:  'Empresas Transportistas',
  admin:           'Administración',
}

const MODULE_ROUTES: Record<TourModule, string> = {
  diario:          '/dashboard/diario',
  transportistas:  '/dashboard/transportistas',
  admin:           '/dashboard/admin/usuarios',
}

export function ModuleCompletionPrompt() {
  const router = useRouter()
  const { showCompletionPrompt, nextModule, dismissCompletionPrompt, startTour, TOUR_SEQUENCE } = useTourContext()

  if (!showCompletionPrompt || !nextModule) return null

  function handleContinue() {
    dismissCompletionPrompt()
    router.push(MODULE_ROUTES[nextModule!])
    // Delay start to let the new page render before Joyride looks for targets
    setTimeout(() => startTour(nextModule!), 600)
  }

  const currentIdx = TOUR_SEQUENCE.indexOf(nextModule) // next is index after current

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="relative max-w-sm w-full mx-4 rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(15,23,42,0.95)',
          border: '1px solid rgba(28,185,236,0.3)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        {/* Accent top bar */}
        <div style={{ height: '2px', background: 'linear-gradient(90deg, #1cb9ec, #0e8db5)' }} />

        <div className="p-6">
          {/* Module progress bar */}
          <div className="flex gap-1.5 mb-5">
            {TOUR_SEQUENCE.map((m, i) => (
              <div
                key={m}
                className="flex-1 h-1 rounded-full transition-all"
                style={{
                  background: i < currentIdx
                    ? '#1cb9ec'
                    : i === currentIdx
                    ? 'rgba(28,185,236,0.35)'
                    : 'rgba(255,255,255,0.08)',
                }}
              />
            ))}
          </div>

          {/* Check icon */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center mb-4"
            style={{ background: 'rgba(28,185,236,0.12)', border: '1px solid rgba(28,185,236,0.25)' }}
          >
            <span style={{ color: '#1cb9ec', fontSize: '18px', lineHeight: 1 }}>✓</span>
          </div>

          <h2 className="font-mulish font-bold text-base text-slate-100 mb-1">
            Módulo completado
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            Siguiente: <span className="font-semibold text-slate-200">{MODULE_LABELS[nextModule]}</span>
          </p>

          <div className="flex gap-3">
            <button
              onClick={dismissCompletionPrompt}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#64748b',
              }}
            >
              Después
            </button>
            <button
              onClick={handleContinue}
              className="flex-1 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(90deg, #1cb9ec, #0e8db5)' }}
            >
              Ir a {MODULE_LABELS[nextModule].split(' ')[0]} →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
