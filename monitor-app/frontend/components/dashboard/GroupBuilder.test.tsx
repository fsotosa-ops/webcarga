import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
          { id: 'ASIGNADO', label: 'Asignado', bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
          { id: 'RUTA',     label: 'Ruta',     bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
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
          { id: 'ASIGNADO', label: 'Asignado', bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
          { id: 'RUTA',     label: 'Ruta',     bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
          { id: 'ORIGEN',   label: 'Origen',   bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
        ]}
      />
    )
    expect(screen.getByText('(2 seleccionados)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Mi grupo')).toBeInTheDocument()
  })
})
