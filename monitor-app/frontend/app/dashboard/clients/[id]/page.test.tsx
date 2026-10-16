import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 's1' }) }))
vi.mock('@/components/directory/ClientProfile', () => ({ ClientProfile: ({ id }: { id: string }) => <p>ficha {id}</p> }))

import ClientPage from './page'

describe('/dashboard/clients/[id]', () => {
  it('abre la ficha del cliente de la dirección', () => {
    render(<ClientPage />)
    expect(screen.getByText('ficha s1')).toBeInTheDocument()
  })
})
