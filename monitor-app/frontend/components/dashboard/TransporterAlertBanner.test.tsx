import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransporterAlertBanner } from './TransporterAlertBanner'

describe('TransporterAlertBanner', () => {
  it('renders nothing when the company is eligible', () => {
    const { container } = render(
      <TransporterAlertBanner eligible={true} blockingReasons={[]} compliancePct={100} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each blocking reason with readable text', () => {
    render(
      <TransporterAlertBanner
        eligible={false}
        blockingReasons={['docs_below_threshold', 'insurance_overdue']}
        compliancePct={82}
      />,
    )
    expect(screen.getByText(/Documentación bajo el umbral \(82% < 90%\)/)).toBeInTheDocument()
    expect(screen.getByText('Cuota de seguro vencida')).toBeInTheDocument()
  })

  it('shows an unknown reason code verbatim rather than hiding it', () => {
    render(
      <TransporterAlertBanner eligible={false} blockingReasons={['new_future_reason']} compliancePct={null} />,
    )
    expect(screen.getByText('new_future_reason')).toBeInTheDocument()
  })
})
