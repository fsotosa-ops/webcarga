import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GroupBuilder } from './GroupBuilder'

vi.mock('@/lib/api/filterGroups', () => ({
  filterGroupsApi: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))

describe('GroupBuilder — prefill', () => {
  it('preselects the statuses passed via initialStatuses when creating a new group', () => {
    render(
      <GroupBuilder
        onSaved={vi.fn()}
        onClose={vi.fn()}
        initialStatuses={['ASIGNADO', 'RUTA']}
        statuses={[
          { id: 'ASIGNADO', label: 'Asignado',   group: 'en_ruta' },
          { id: 'RUTA',     label: 'Ruta',   group: 'en_ruta' },
        ]}
      />
    )
    expect(screen.getByText('(2 seleccionados)')).toBeInTheDocument()
  })

  it('editing an existing group still takes priority over initialStatuses', () => {
    render(
      <GroupBuilder
        onSaved={vi.fn()}
        onClose={vi.fn()}
        initialStatuses={['ASIGNADO']}
        editing={{ id: 'g1', name: 'Mi grupo', statuses: ['RUTA', 'ORIGEN'], color: 'blue', created_at: '', updated_at: '' }}
        statuses={[
          { id: 'ASIGNADO', label: 'Asignado',   group: 'en_ruta' },
          { id: 'RUTA',     label: 'Ruta',   group: 'en_ruta' },
          { id: 'ORIGEN',   label: 'Origen',   group: 'en_ruta' },
        ]}
      />
    )
    expect(screen.getByText('(2 seleccionados)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Mi grupo')).toBeInTheDocument()
  })
})

describe('GroupBuilder — el diálogo', () => {
  it('ofrece los nueve colores que acepta la API, cada uno con su nombre', () => {
    render(<GroupBuilder onSaved={vi.fn()} onClose={vi.fn()} statuses={[]} />)
    const colores = screen.getAllByRole('radio')
    expect(colores).toHaveLength(9)
    expect(screen.getByRole('radio', { name: 'Gris' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Azul' })).toHaveAttribute('aria-checked', 'true')
  })

  it('es el diálogo del kit: modal, con nombre, y Escape lo cierra', () => {
    const onClose = vi.fn()
    render(<GroupBuilder onSaved={vi.fn()} onClose={onClose} statuses={[]} />)
    expect(screen.getByRole('dialog', { name: 'Nuevo grupo de estados' })).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
