import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompletionRing } from './CompletionRing'

describe('CompletionRing', () => {
  it('shows the rounded percentage', () => {
    render(<CompletionRing ok={1} total={8} />)
    expect(screen.getByText('13%')).toBeInTheDocument()
  })

  it('shows 0% when there are no documents', () => {
    render(<CompletionRing ok={0} total={0} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('exposes an accessible label with the raw counts', () => {
    render(<CompletionRing ok={8} total={8} />)
    expect(screen.getByRole('img', { name: '8 de 8 documentos al día' })).toBeInTheDocument()
  })
})
