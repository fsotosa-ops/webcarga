import { readFile } from 'node:fs/promises'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/config', () => ({
  inventarioApi: { get: vi.fn() },
}))
import { inventarioApi } from '@/lib/api/config'

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PortadaDominios />
    </QueryClientProvider>,
  )
}

const INVENTARIO = {
  certificacion: [
    { n: 37, etiqueta: 'documentos' },
    { n: 2, etiqueta: 'con condición' },
  ],
  operaciones: [{ n: 25, etiqueta: 'estados del tablero' }],
  flota:       [{ n: 10, etiqueta: 'subtipos' }],
  personas:    [{ n: 10, etiqueta: 'usuarios' }],
}

beforeEach(() => {
  vi.mocked(inventarioApi.get).mockReset()
  vi.mocked(inventarioApi.get).mockResolvedValue(INVENTARIO)
})
import { PortadaDominios } from './PortadaDominios'
import { DOMINIOS } from './dominios'

describe('PortadaDominios', () => {
  // Se afirma sobre el registro, no sobre una lista escrita a mano: si manana
  // se agrega un dominio, este test lo cubre solo. Escribir los nombres aca
  // seria una segunda fuente de verdad de lo que hay en el modulo.
  it('muestra una tarjeta por dominio, con su proposito', () => {
    montar()
    for (const d of DOMINIOS) {
      expect(screen.getByText(d.titulo), d.clave).toBeInTheDocument()
      expect(screen.getByText(d.proposito), d.clave).toBeInTheDocument()
    }
  })

  it('cada dominio visitable enlaza a su ruta', () => {
    montar()
    // Ancorado al inicio del nombre accesible: el proposito de Flota tambien
    // menciona "Certificación" (el vocabulario que comparte con ese dominio),
    // asi que /certificación/i sin ancorar matchea las dos tarjetas.
    expect(screen.getByRole('link', { name: /^certificación/i }))
      .toHaveAttribute('href', '/dashboard/admin/configuracion/certificacion')
  })

  // El prefetch ejecuta el layout del dashboard, que habla con Auth: eso
  // produjo un 429 en produccion (Ronda 110). No es decorativo.
  // Guardarrail del 429. Sin `prefetch={false}`, Next prefetchea cada enlace
  // que entra al viewport, cada prefetch ejecuta el layout del dashboard —que
  // va a la API de Auth— y Supabase responde 429. Medido en staging el
  // 2026-08-15: 104 llamadas a /user en un minuto, sin un solo clic.
  //
  // El prop NO llega al DOM, asi que se verifica sobre el modulo, igual que en
  // CertificationStatusTable.test.tsx. La version anterior de este test miraba
  // un atributo `data-prefetch` que next/link nunca renderiza: pasaba con
  // prefetch puesto y sin poner, o sea que no protegia nada.
  it('ningun enlace de la portada prefetchea', async () => {
    const fuente = await readFile(
      'app/dashboard/admin/configuracion/PortadaDominios.tsx', 'utf-8',
    )
    const enlaces = fuente.split('<Link').slice(1)
    expect(enlaces.length).toBeGreaterThan(0)
    for (const enlace of enlaces) {
      const props = enlace.slice(0, enlace.indexOf('>'))
      expect(props, `un <Link> quedo sin prefetch={false}: ${props.trim().slice(0, 80)}`)
        .toContain('prefetch={false}')
    }
  })

  it('un dominio proximamente no es un enlace', () => {
    montar()
    expect(screen.getByText('Facturación')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /facturación/i })).not.toBeInTheDocument()
  })

  // "N secciones" describia la NAVEGACION, no el contenido: Certificacion con
  // 37 documentos se veia identica a Personas con 10 usuarios. Ahora cada fila
  // dice que gobierna su dominio, con datos reales del backend.
  it('cada dominio dice que gobierna, en numeros reales', async () => {
    montar()
    const certificacion = screen.getByText('Certificación').closest('a')!
    await waitFor(() => expect(certificacion).toHaveTextContent('37 documentos'))
    expect(certificacion).toHaveTextContent('2 con condición')
  })

  it('ya no muestra el conteo de secciones, que no informaba nada', async () => {
    montar()
    const fila = screen.getByText('Certificación').closest('a')!
    await waitFor(() => expect(fila).toHaveTextContent('37 documentos'))
    expect(screen.queryByText(/secciones/i)).not.toBeInTheDocument()
  })

  // El inventario es informativo: si el backend falla, las filas tienen que
  // seguir siendo navegables. Una portada sin conteos sirve; una que no deja
  // entrar, no.
  it('si el inventario falla las filas siguen siendo navegables', async () => {
    vi.mocked(inventarioApi.get).mockRejectedValueOnce(new Error('502'))
    montar()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /^Certificación/ })).toBeInTheDocument())
  })

  // El fallo se DICE. La primera version dejaba `{}` significando a la vez
  // "cargo vacio" y "fallo": la portada se veia igual que si no hubiera nada
  // que contar, y nadie se enteraba de que el endpoint estaba caido.
  it('si el inventario falla lo dice, en vez de parecer vacio', async () => {
    vi.mocked(inventarioApi.get).mockRejectedValueOnce(new Error('502'))
    montar()
    await waitFor(() =>
      expect(screen.getAllByText(/sin datos por ahora/i).length).toBeGreaterThan(0))
  })
})
