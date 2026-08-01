import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertsPopover } from './AlertsPopover'
import { alertSignalDefs, type AlertSignalId } from '@/lib/utils/alertSignals'
import { DEFAULT_ALERT_RULES } from '@/lib/utils/kpis'

const defs = alertSignalDefs(DEFAULT_ALERT_RULES)
const counts = Object.fromEntries(defs.map(d => [d.id, 0])) as Record<AlertSignalId, number>

function renderPopover(props: Partial<React.ComponentProps<typeof AlertsPopover>> = {}) {
  return render(
    <AlertsPopover
      defs={defs}
      counts={{ ...counts, dwell_severity: 5 }}
      active={[]}
      pinned={['dwell_severity']}
      onToggle={vi.fn()}
      onTogglePin={vi.fn()}
      {...props}
    />,
  )
}

describe('AlertsPopover', () => {
  it('opens on click and lists all 8 signals with their counts', () => {
    renderPopover()
    fireEvent.click(screen.getByText('Alertas'))
    expect(screen.getByText('Detenido en local')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2ª+ vuelta')).toBeInTheDocument()
  })

  it('calls onToggle when a checkbox is clicked', () => {
    const onToggle = vi.fn()
    renderPopover({ onToggle })
    fireEvent.click(screen.getByText('Alertas'))
    fireEvent.click(screen.getByText('Detenido en local').closest('label')!.querySelector('input')!)
    expect(onToggle).toHaveBeenCalledWith('dwell_severity')
  })

  it('calls onTogglePin when the star is clicked, without also toggling the filter', () => {
    const onToggle = vi.fn()
    const onTogglePin = vi.fn()
    renderPopover({ onToggle, onTogglePin })
    fireEvent.click(screen.getByText('Alertas'))
    fireEvent.click(screen.getByLabelText('Quitar Detenido en local de las tiles fijas'))
    expect(onTogglePin).toHaveBeenCalledWith('dwell_severity')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('shows the active-count badge on the trigger button', () => {
    renderPopover({ active: ['dwell_severity', 'active'] })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderPopover()
    fireEvent.click(screen.getByText('Alertas'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
