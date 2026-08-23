import { describe, it, expect } from 'vitest'
import { COMPLIANCE_STATUS_CONFIG, evidenciaDeDocumento, expiryRelative, updatedRelative } from './compliance'

describe('expiryRelative', () => {
  it('returns null when there is no expiration date', () => {
    expect(expiryRelative(null, false)).toBeNull()
  })

  it('returns "vence hoy" when the expiration date is today', () => {
    expect(expiryRelative('2026-07-16', false, '2026-07-16')).toBe('vence hoy')
  })

  it('returns "vence en N días" for a future date', () => {
    expect(expiryRelative('2026-07-21', false, '2026-07-16')).toBe('vence en 5 días')
    expect(expiryRelative('2026-07-17', false, '2026-07-16')).toBe('vence en 1 día')
  })

  it('returns "vencido hace N días" only when is_expired is true', () => {
    expect(expiryRelative('2026-07-04', true, '2026-07-16')).toBe('vencido hace 12 días')
    expect(expiryRelative('2026-07-15', true, '2026-07-16')).toBe('vencido hace 1 día')
  })

  it('returns null for a past date that is not flagged as expired', () => {
    expect(expiryRelative('2026-07-04', false, '2026-07-16')).toBeNull()
  })
})

describe('updatedRelative', () => {
  const NOW = new Date('2026-07-16T12:00:00Z').getTime()

  it('returns null when there is no updated_at', () => {
    expect(updatedRelative(null, NOW)).toBeNull()
  })

  it('returns "actualizado hoy" for the same day', () => {
    expect(updatedRelative('2026-07-16T09:00:00Z', NOW)).toBe('actualizado hoy')
  })

  it('returns "sin actualizar hace N días" for older timestamps', () => {
    expect(updatedRelative('2026-06-06T12:00:00Z', NOW)).toBe('sin actualizar hace 40 días')
    expect(updatedRelative('2026-07-15T12:00:00Z', NOW)).toBe('sin actualizar hace 1 día')
  })
})

describe('evidenciaDeDocumento — los dos ejes no se colapsan', () => {
  it('sin fecha y sin archivo, no sabemos nada del documento', () => {
    expect(evidenciaDeDocumento('MISSING', null, false).label).toBe('Falta')
  })

  it('con fecha y sin archivo, lo que falta es el papel', () => {
    // El caso de Pablo: cargó las fechas que tenía en un Excel sin subir el
    // histórico. Decirle "Falta" a secas esconde que ya sabemos cuándo vence.
    expect(evidenciaDeDocumento('MISSING', '2026-09-12', false).label).toBe('Falta el archivo')
  })

  it('la fecha NO aprueba el documento', () => {
    // La regla que ninguna plataforma de cumplimiento rompe: una fecha sin
    // evidencia no cuenta como cumplido. Si el estilo cambiara al de aprobado,
    // cargar 1.326 fechas pondría empresas en verde sin que nadie vea un papel.
    const conFecha = evidenciaDeDocumento('MISSING', '2026-09-12', false)
    expect(conFecha.cls).toBe(COMPLIANCE_STATUS_CONFIG.MISSING.cls)
    expect(conFecha.cls).not.toBe(COMPLIANCE_STATUS_CONFIG.APPROVED_MANUAL.cls)
  })

  it('con archivo cargado vuelve a mandar el estado, no la fecha', () => {
    expect(evidenciaDeDocumento('APPROVED_MANUAL', '2026-09-12', true).label)
      .toBe(COMPLIANCE_STATUS_CONFIG.APPROVED_MANUAL.label)
    // Un MISSING con archivo es raro pero existe (un rechazo que conserva el
    // blob): ahí "Falta el archivo" mentiría.
    expect(evidenciaDeDocumento('MISSING', '2026-09-12', true).label).toBe('Falta')
  })
})

describe('evidenciaDeDocumento — dónde se ve de verdad', () => {
  it('la etiqueta nueva sólo puede aparecer en una fila PENDIENTE', () => {
    // El click-through del 23/08 encontró que la ficha de empresa parte sus
    // filas por `urgencia`: las AL_DIA llevan pill y las pendientes llevan zona
    // de arrastre, sin pill. O sea que ahí "Falta el archivo" no podía
    // renderizarse nunca: un MISSING no es AL_DIA. Las superficies que sí
    // dibujan pill para pendientes son TransporterSlideOver y
    // TransporterAlertBanner, y son las que consumen esta función.
    //
    // Este test fija la combinación, no la pantalla: si alguien la llama con
    // un estado aprobado esperando la etiqueta nueva, no la va a obtener.
    expect(evidenciaDeDocumento('MISSING', '2026-09-20', false).label).toBe('Falta el archivo')
    expect(evidenciaDeDocumento('APPROVED_MANUAL', '2026-09-20', false).label)
      .not.toBe('Falta el archivo')
  })
})
