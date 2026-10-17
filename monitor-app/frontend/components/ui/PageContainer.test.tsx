import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PageContainer } from './PageContainer'

const clases = (ui: React.ReactElement) => (render(ui).container.firstElementChild as HTMLElement).className

describe('PageContainer', () => {
  it('el mismo margen y la misma separación en todas las pantallas, más chico en el teléfono', () => {
    expect(clases(<PageContainer>x</PageContainer>)).toBe('p-4 md:p-6 space-y-4')
  })

  it('una pantalla que desplaza su propio contenido (el Monitor, Configuración)', () => {
    expect(clases(<PageContainer scrollable>x</PageContainer>)).toContain('flex-1 overflow-y-auto')
  })

  it('una pantalla de lectura se limita al ancho que se lee; una con barra fija abajo le deja lugar', () => {
    expect(clases(<PageContainer width="reading">x</PageContainer>)).toContain('max-w-6xl mx-auto')
    expect(clases(<PageContainer bottomBar>x</PageContainer>)).toContain('pb-24')
  })
})
