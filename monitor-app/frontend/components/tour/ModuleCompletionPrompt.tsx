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
  const { showCompletionPrompt, nextModule, dismissCompletionPrompt, startTour } = useTourContext()

  if (!showCompletionPrompt || !nextModule) return null

  function handleContinue() {
    dismissCompletionPrompt()
    router.push(MODULE_ROUTES[nextModule!])
    // Delay start to let the new page render before Joyride looks for targets
    setTimeout(() => startTour(nextModule!), 600)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <div className="text-3xl mb-3">🎉</div>
        <h2 className="font-mulish font-bold text-lg text-slate-900 mb-2">
          ¡Módulo completado!
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          ¿Quieres continuar al tour de{' '}
          <span className="font-semibold text-slate-700">{MODULE_LABELS[nextModule]}</span>?
        </p>
        <div className="flex gap-3">
          <button
            onClick={dismissCompletionPrompt}
            className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 border border-border rounded-lg hover:bg-gray-50 transition-colors"
          >
            Ahora no
          </button>
          <button
            onClick={handleContinue}
            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
          >
            Continuar →
          </button>
        </div>
      </div>
    </div>
  )
}
