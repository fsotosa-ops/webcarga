import { describe, it, expect } from 'vitest'
import { TRIP_STAGES, tripStageStyle } from './states'

// Configuración, Parte 1 (D4): el color de un estado sale de su etapa del viaje,
// no de una paleta por fila. Las 7 columnas son un conjunto cerrado (backend:
// schemas/status_taxonomy.TRIP_STAGES).
describe('tripStageStyle', () => {
  it('da a cada columna el tono de lo que significa', () => {
    expect(tripStageStyle('en_ruta')).toMatchObject({ label: 'En Ruta', tone: 'action' })
    expect(tripStageStyle('en_local')).toMatchObject({ label: 'En Local', tone: 'action' })
    expect(tripStageStyle('retornando')).toMatchObject({ label: 'Retornando', tone: 'neutral' })
    expect(tripStageStyle('pendiente_cierre_tms')).toMatchObject({ label: 'Pendiente de cierre TMS', tone: 'warning' })
    expect(tripStageStyle('cerrado')).toMatchObject({ label: 'Cerrado', tone: 'resolved' })
    expect(tripStageStyle('problema')).toMatchObject({ label: 'Problema', tone: 'urgent' })
    expect(tripStageStyle('otro')).toMatchObject({ label: 'Otro', tone: 'neutral' })
  })

  it('un estado sin columna (o con una desconocida) se ve neutro, sin romper', () => {
    expect(tripStageStyle(null)).toMatchObject({ label: 'Sin columna', tone: 'neutral' })
    expect(tripStageStyle(undefined)).toMatchObject({ label: 'Sin columna', tone: 'neutral' })
    expect(tripStageStyle('inventada')).toMatchObject({ label: 'Sin columna', tone: 'neutral' })
  })

  it('TRIP_STAGES son las 7 columnas, en su orden', () => {
    expect(TRIP_STAGES.map(c => c.id)).toEqual(
      ['en_ruta', 'en_local', 'retornando', 'pendiente_cierre_tms', 'cerrado', 'problema', 'otro'])
  })
})
