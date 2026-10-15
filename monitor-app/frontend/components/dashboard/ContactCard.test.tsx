import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddContactForm, ContactCard } from './ContactCard'

const CONTACT = {
  id: 'k1', contact_role: 'LEGAL_REP', first_name: 'Camila', last_name: 'Haller', job_title: null,
  email: 'c@x.cl', phone: '569', is_primary: false, is_active: true,
}

// 15/10: la ficha de empresa mostraba "LEGAL_REP", el código del rol, en vez de su nombre.
describe('ContactCard', () => {
  it('muestra el rol con su nombre, no con el código', () => {
    render(<ContactCard contact={CONTACT} canEdit={false} canDelete={false} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    expect(screen.getByText('Representante legal')).toBeInTheDocument()
    expect(screen.queryByText('LEGAL_REP')).not.toBeInTheDocument()
  })

  it('un rol desconocido se muestra tal cual, sin perderse', () => {
    render(<ContactCard contact={{ ...CONTACT, contact_role: 'OTRO_ROL' }} canEdit={false} canDelete={false} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    expect(screen.getByText('OTRO_ROL')).toBeInTheDocument()
  })

  it('el selector de "Agregar contacto" ofrece los roles por su nombre', () => {
    render(<AddContactForm roleOptions={['LEGAL_REP', 'EMERGENCIA']} onAdd={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Agregar contacto/ }))
    expect(screen.getByRole('option', { name: 'Representante legal' })).toHaveValue('LEGAL_REP')
    expect(screen.getByRole('option', { name: 'Emergencia' })).toHaveValue('EMERGENCIA')
  })
})
