import { describe, it, expect } from 'vitest'
import { BOARD_COLUMNS, boardColumnStyle } from './states'

// Configuración, Parte 1 (D4): el color de un estado sale de su columna del tablero,
// no de una paleta por fila. Las 7 columnas son un conjunto cerrado (backend:
// schemas/status_taxonomy.BOARD_COLUMNS).
describe('boardColumnStyle', () => {
  it('da a cada columna el tono de lo que significa', () => {
    expect(boardColumnStyle('en_ruta')).toMatchObject({ label: 'En Ruta', tone: 'action' })
    expect(boardColumnStyle('en_local')).toMatchObject({ label: 'En Local', tone: 'action' })
    expect(boardColumnStyle('retornando')).toMatchObject({ label: 'Retornando', tone: 'neutral' })
    expect(boardColumnStyle('pendiente_cierre_tms')).toMatchObject({ label: 'Pendiente de cierre TMS', tone: 'warning' })
    expect(boardColumnStyle('cerrado')).toMatchObject({ label: 'Cerrado', tone: 'resolved' })
    expect(boardColumnStyle('problema')).toMatchObject({ label: 'Problema', tone: 'urgent' })
    expect(boardColumnStyle('otro')).toMatchObject({ label: 'Otro', tone: 'neutral' })
  })

  it('un estado sin columna (o con una desconocida) se ve neutro, sin romper', () => {
    expect(boardColumnStyle(null)).toMatchObject({ label: 'Sin columna', tone: 'neutral' })
    expect(boardColumnStyle(undefined)).toMatchObject({ label: 'Sin columna', tone: 'neutral' })
    expect(boardColumnStyle('inventada')).toMatchObject({ label: 'Sin columna', tone: 'neutral' })
  })

  it('BOARD_COLUMNS son las 7 columnas, en el orden del tablero', () => {
    expect(BOARD_COLUMNS.map(c => c.id)).toEqual(
      ['en_ruta', 'en_local', 'retornando', 'pendiente_cierre_tms', 'cerrado', 'problema', 'otro'])
  })
})
