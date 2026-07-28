import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BitacoraFollowupBadge } from './BitacoraFollowupBadge'

describe('BitacoraFollowupBadge', () => {
  it('renders nothing when show is false', () => {
    render(<BitacoraFollowupBadge show={false} onClick={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a button when show is true', () => {
    render(<BitacoraFollowupBadge show onClick={vi.fn()} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<BitacoraFollowupBadge show onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('compact variant still renders a clickable button', () => {
    const onClick = vi.fn()
    render(<BitacoraFollowupBadge show onClick={onClick} compact />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
