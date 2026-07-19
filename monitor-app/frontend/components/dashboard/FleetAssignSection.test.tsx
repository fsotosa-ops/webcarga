import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from './FleetAssignSection'
import { driversApi } from '@/lib/api/drivers'

vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function Harness({
  initial = EMPTY_FLEET_ASSIGN_VALUE, onChangeSpy, suggested, notFoundHint,
}: {
  initial?: FleetAssignValue
  onChangeSpy?: (v: FleetAssignValue) => void
  suggested?: React.ComponentProps<typeof FleetAssignSection>['suggested']
  notFoundHint?: React.ComponentProps<typeof FleetAssignSection>['notFoundHint']
}) {
  const [value, setValue] = useState<FleetAssignValue>(initial)
  return (
    <Wrapper>
      <FleetAssignSection
        value={value}
        onChange={v => { setValue(v); onChangeSpy?.(v) }}
        suggested={suggested}
        notFoundHint={notFoundHint}
      />
    </Wrapper>
  )
}

const CANDIDATE = {
  driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '11.111.111-1', driver_phone: '+56911112222',
  carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
}

describe('FleetAssignSection', () => {
  it('shows the driver search when no driver is picked', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Buscar conductor')).toBeInTheDocument()
  })

  it('picking a suggested driver fills every field from the candidate', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} suggested={[CANDIDATE]} />)
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(spy).toHaveBeenCalledWith({
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '11.111.111-1', driver_phone: '+56911112222',
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
      trailer_plate: null,
    })
  })

  it('preserves an already-typed trailer plate when a driver is picked', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} suggested={[CANDIDATE]} initial={{ ...EMPTY_FLEET_ASSIGN_VALUE, trailer_plate: 'RMPLA01' }} />)
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ trailer_plate: 'RMPLA01' }))
  })

  it('shows the picked driver summary and editable fleet fields once a driver is set', () => {
    render(<Harness initial={{
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '11.111.111-1', driver_phone: null,
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
      trailer_plate: null,
    }} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByLabelText('Empresa de transporte')).toHaveValue('TransCargo')
    expect(screen.getByLabelText('Patente tracto')).toHaveValue('ABCD12')
  })

  it('editing the tractor plate patches only that field, uppercased', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: null, driver_phone: null,
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: '',
      trailer_plate: null,
    }} />)
    fireEvent.change(screen.getByLabelText('Patente tracto'), { target: { value: 'bgvs12' } })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tractor_plate: 'BGVS12', driver_id: 'd1' }))
  })

  it('"Cambiar" resets the whole selection back to empty', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: null, driver_phone: null,
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
      trailer_plate: 'RMPLA01',
    }} />)
    fireEvent.click(screen.getByText('Cambiar'))
    expect(spy).toHaveBeenCalledWith(EMPTY_FLEET_ASSIGN_VALUE)
  })

  it('shows the notFoundHint once the search query reaches 2 characters', () => {
    render(<Harness notFoundHint={<p>Alta en Empresas</p>} />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Na' } })
    expect(screen.getByText('Alta en Empresas')).toBeInTheDocument()
  })

  it('does not show the notFoundHint below 2 characters', () => {
    render(<Harness notFoundHint={<p>Alta en Empresas</p>} />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'N' } })
    expect(screen.queryByText('Alta en Empresas')).not.toBeInTheDocument()
  })
})
