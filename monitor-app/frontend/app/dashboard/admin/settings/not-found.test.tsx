import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/admin/settings/facturacion' }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  useAcceso: () => ({ permissions: ['users.manage', 'certification.configure', 'operations.configure'] }),
}))
vi.mock('@/lib/api/config', () => ({ inventarioApi: { get: vi.fn().mockResolvedValue({}) } }))

import AreaNoEncontrada from './not-found'

function montar() {
  render(<QueryClientProvider client={new QueryClient()}><AreaNoEncontrada /></QueryClientProvider>)
}

describe('sección de configuración no encontrada', () => {
  it('ofrece la vuelta al índice', () => {
    montar()
    expect(screen.getByRole('link', { name: /^Configuración/ })).toHaveAttribute('href', '/dashboard/admin/settings')
  })

  // La salida útil es la lista de lo que sí existe: quien teclea /facturacion
  // tiene que poder ir a donde quería de un clic.
  it('lista las secciones que sí existen, sin el área reservada', () => {
    montar()
    expect(screen.getByRole('link', { name: 'Motivos de conductor' }))
      .toHaveAttribute('href', '/dashboard/admin/settings/operations/driver-reasons')
    // Se mudó a Certificación › Documentos exigidos (Parte 2).
    expect(screen.queryByRole('link', { name: 'Condiciones de documentos' })).toBeNull()
    expect(screen.queryByText('Facturación')).toBeNull()
  })
})
