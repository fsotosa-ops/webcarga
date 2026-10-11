import { describe, expect, it } from 'vitest'
import { GROUP_OPTIONS } from './shared'

describe('GROUP_OPTIONS', () => {
  // Ítem 6 (minuta 09/10): "Control de salida" se mueve a este grupo desde
  // Configuración › Estados. Son los mismos ids que valida el backend
  // (VALID_GROUP_IDS en routers/config.py).
  it('ofrece el grupo "Pendiente de cierre TMS"', () => {
    expect(GROUP_OPTIONS).toContainEqual({ id: 'pendiente_cierre_tms', label: 'Pendiente de cierre TMS' })
  })
})
