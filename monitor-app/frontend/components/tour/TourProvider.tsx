'use client'

import { useEffect } from 'react'
import { Joyride, type ButtonType, type EventData, type Step, STATUS } from 'react-joyride'
import { TourContext, type TourModule } from './tourContext'
import { useTour } from '@/hooks/useTour'
import { ModuleCompletionPrompt } from './ModuleCompletionPrompt'
import { diarioSteps } from './steps/diario'
import { transportistasSteps } from './steps/transportistas'
import { adminSteps } from './steps/admin'

const MODULE_STEPS: Record<TourModule, Step[]> = {
  diario:         diarioSteps,
  transportistas: transportistasSteps,
  admin:          adminSteps,
}

const JOYRIDE_OPTIONS = {
  primaryColor: '#1cb9ec',
  zIndex: 9000,
  showProgress: true,
  // Include skip button in every step by default
  buttons: ['back', 'close', 'primary', 'skip'] as ButtonType[],
}

const JOYRIDE_LOCALE = {
  back:  'Atrás',
  close: 'Cerrar',
  last:  'Finalizar',
  next:  'Siguiente →',
  skip:  'Saltar tour',
}

interface TourProviderProps {
  children: React.ReactNode
}

export function TourProvider({ children }: TourProviderProps) {
  const tour = useTour()

  // Auto-start on first visit
  useEffect(() => {
    if (!tour.wasShown) {
      tour.markShown()
      const timer = setTimeout(() => tour.startTour('diario'), 800)
      return () => clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleJoyrideCallback(data: EventData) {
    const { status } = data
    const finished = ([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status)
    if (finished && tour.activeModule) {
      if (status === STATUS.FINISHED) {
        tour.completeTour(tour.activeModule)
      } else {
        tour.stopTour()
      }
    }
  }

  const steps = tour.activeModule ? MODULE_STEPS[tour.activeModule] : []

  return (
    <TourContext.Provider value={tour}>
      <Joyride
        steps={steps}
        run={tour.activeModule !== null}
        continuous
        options={JOYRIDE_OPTIONS}
        locale={JOYRIDE_LOCALE}
        onEvent={handleJoyrideCallback}
      />
      <ModuleCompletionPrompt />
      {children}
    </TourContext.Provider>
  )
}
