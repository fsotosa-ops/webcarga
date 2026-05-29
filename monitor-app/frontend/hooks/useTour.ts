import { useState, useCallback } from 'react'

export type TourModule = 'diario' | 'transportistas' | 'admin'

const TOUR_SHOWN_KEY    = 'wc_tour_shown_first_time'
const TOUR_COMPLETED_KEY = 'wc_tour_completed_modules'

const TOUR_SEQUENCE: TourModule[] = ['diario', 'transportistas', 'admin']

function readCompleted(): TourModule[] {
  try {
    return JSON.parse(localStorage.getItem(TOUR_COMPLETED_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function useTour() {
  const [activeModule, setActiveModule] = useState<TourModule | null>(null)
  const [completedModules, setCompletedModules] = useState<TourModule[]>(() => {
    if (typeof window === 'undefined') return []
    return readCompleted()
  })
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false)
  const [nextModule, setNextModule] = useState<TourModule | null>(null)

  const wasShown = typeof window !== 'undefined' && !!localStorage.getItem(TOUR_SHOWN_KEY)

  const markShown = useCallback(() => {
    localStorage.setItem(TOUR_SHOWN_KEY, 'true')
  }, [])

  const startTour = useCallback((module: TourModule) => {
    setActiveModule(module)
    setShowCompletionPrompt(false)
  }, [])

  const stopTour = useCallback(() => {
    setActiveModule(null)
  }, [])

  const completeTour = useCallback((module: TourModule) => {
    setActiveModule(null)
    setCompletedModules(prev => {
      if (prev.includes(module)) return prev
      const next = [...prev, module]
      localStorage.setItem(TOUR_COMPLETED_KEY, JSON.stringify(next))
      return next
    })
    const idx = TOUR_SEQUENCE.indexOf(module)
    const next = TOUR_SEQUENCE[idx + 1] ?? null
    if (next) {
      setNextModule(next)
      setShowCompletionPrompt(true)
    }
  }, [])

  const dismissCompletionPrompt = useCallback(() => {
    setShowCompletionPrompt(false)
    setNextModule(null)
  }, [])

  const resetAll = useCallback(() => {
    localStorage.removeItem(TOUR_SHOWN_KEY)
    localStorage.removeItem(TOUR_COMPLETED_KEY)
    setCompletedModules([])
    setActiveModule(null)
    setShowCompletionPrompt(false)
    setNextModule(null)
  }, [])

  const allCompleted =
    TOUR_SEQUENCE.every(m => completedModules.includes(m))

  return {
    activeModule,
    completedModules,
    showCompletionPrompt,
    nextModule,
    wasShown,
    allCompleted,
    markShown,
    startTour,
    stopTour,
    completeTour,
    dismissCompletionPrompt,
    resetAll,
    TOUR_SEQUENCE,
  }
}
