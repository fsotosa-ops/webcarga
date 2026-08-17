import { describe, expect, it } from 'vitest'
import { nombreLegible } from '@/components/dashboard/TripTable'

describe('nombreLegible', () => {
  it('normaliza las MAYUSCULAS del TMS', () => {
    expect(nombreLegible('SUAREZ LOPEZ EFRAIN EDUARDO')).toBe('Suarez Lopez Efrain Eduardo')
  })
  it('deja igual lo que ya venia capitalizado', () => {
    expect(nombreLegible('Aravena Herrera Francisco Javier')).toBe('Aravena Herrera Francisco Javier')
  })
  it('limpia el punto final y los espacios dobles del TMS', () => {
    expect(nombreLegible('VIDAL  ESCOBAR   PEDRO NOLASCO .')).toBe('Vidal Escobar Pedro Nolasco')
  })
  it('respeta apellidos compuestos y apostrofes', () => {
    expect(nombreLegible("O'HIGGINS RIQUELME")).toBe("O'Higgins Riquelme")
    expect(nombreLegible('PEREZ-SOTO ANA')).toBe('Perez-Soto Ana')
  })
  it('no pierde las eñes ni las tildes', () => {
    expect(nombreLegible('MUÑOZ PEÑA JOSÉ')).toBe('Muñoz Peña José')
  })
})
