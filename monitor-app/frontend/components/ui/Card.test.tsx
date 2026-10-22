import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('dibuja sus hijos dentro de la tarjeta de contenido', () => {
    render(<Card><p>Contenido</p></Card>)
    const tarjeta = screen.getByText('Contenido').parentElement!
    expect(tarjeta.className).toMatch(/rounded-2xl/)
    expect(tarjeta.className).toMatch(/border-border/)
    expect(tarjeta.className).toMatch(/bg-white/)
  })
})
