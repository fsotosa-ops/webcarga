import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndicadorDeAjustes } from './IndicadorDeAjustes'

describe('IndicadorDeAjustes', () => {
  it('sin ajustes no aparece', () => {
    const { container } = render(<IndicadorDeAjustes cantidad={0} onVer={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('dice cuántos y lleva a verlos', () => {
    const onVer = vi.fn()
    render(<IndicadorDeAjustes cantidad={12} onVer={onVer} />)
    fireEvent.click(screen.getByRole('button', { name: /12 ajustes posteriores al cierre/i }))
    expect(onVer).toHaveBeenCalled()
  })

  it('en singular no dice "1 ajustes"', () => {
    render(<IndicadorDeAjustes cantidad={1} onVer={() => {}} />)
    expect(screen.getByRole('button', { name: /1 ajuste posterior al cierre/i })).toBeInTheDocument()
  })
})
