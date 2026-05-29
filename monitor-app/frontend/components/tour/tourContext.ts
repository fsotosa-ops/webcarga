import { createContext, useContext } from 'react'
import type { TourModule } from '@/hooks/useTour'

export type { TourModule }

export interface TourContextValue {
  activeModule:            TourModule | null
  completedModules:        TourModule[]
  showCompletionPrompt:    boolean
  nextModule:              TourModule | null
  wasShown:                boolean
  allCompleted:            boolean
  TOUR_SEQUENCE:           TourModule[]
  markShown:               () => void
  startTour:               (module: TourModule) => void
  stopTour:                () => void
  completeTour:            (module: TourModule) => void
  dismissCompletionPrompt: () => void
  resetAll:                () => void
}

export const TourContext = createContext<TourContextValue | null>(null)

export function useTourContext(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTourContext must be used inside TourProvider')
  return ctx
}
