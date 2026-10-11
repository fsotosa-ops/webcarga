import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Section } from './Section'

describe('Section', () => {
  it('es una región con su título como nombre', () => {
    render(<Section title="Dónde trabaja"><p>contenido</p></Section>)
    expect(screen.getByRole('region', { name: 'Dónde trabaja' })).toHaveTextContent('contenido')
  })
})
