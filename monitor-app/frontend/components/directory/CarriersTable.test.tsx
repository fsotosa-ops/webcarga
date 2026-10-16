import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { complianceSummary } from '@/lib/states.fixtures'
import { CarriersTable } from './CarriersTable'

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }))
const push = vi.fn()
beforeEach(() => { push.mockReset(); vi.mocked(useRouter).mockReturnValue({ push } as never) })

const ANDES = { id: 'c1', tax_id: '76555555-8', country_code: 'CL', business_name: 'Transportes Andes',
  operational_status: 'ACTIVE' as const, total_requirements: 3, last_document_update: null,
  compliance_summary: complianceSummary() }

describe('CarriersTable', () => {
  it('dibuja las columnas de la lista de Empresas con los chips del glosario', () => {
    render(<CarriersTable items={[ANDES]} returnTo="/dashboard/clients/s1?tab=empresas" />)
    const tabla = screen.getByRole('table')
    expect(within(tabla).getAllByRole('columnheader').map(h => h.textContent))
      .toEqual(['Empresa', 'RUT', 'Estado', 'Habilitación', 'Última actualización'])
    expect(within(tabla).getByText('76555555-8')).toBeInTheDocument()
    expect(within(tabla).getByText('Activa')).toBeInTheDocument()
  })

  it('el nombre y la fila abren la ficha de la empresa con la vuelta a quien la usa', () => {
    render(<CarriersTable items={[ANDES]} returnTo="/dashboard/clients/s1?tab=empresas" />)
    const enlace = within(screen.getByRole('table')).getByRole('link', { name: 'Transportes Andes' })
    expect(new URL(enlace.getAttribute('href')!, 'http://x').searchParams.get('next'))
      .toBe('/dashboard/clients/s1?tab=empresas')
    fireEvent.click(within(screen.getByRole('table')).getByText('76555555-8'))
    expect(push).toHaveBeenCalledWith(enlace.getAttribute('href'))
  })
})
