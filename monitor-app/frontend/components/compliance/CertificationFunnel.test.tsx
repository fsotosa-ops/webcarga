import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CertificationFunnel } from './CertificationFunnel'
import type { CertificationStatusRow, FunnelGroup } from '@/lib/types'

function fila(over: Partial<CertificationStatusRow> = {}): CertificationStatusRow {
  return {
    entity_id: 'c1', entity_name: 'Transportes Charlotte Spa',
    carrier_id: 'c1', carrier_name: 'Transportes Charlotte Spa',
    operational_status: 'ACTIVE',
    total_count: 93, satisfied_count: 3, pending_count: 90,
    pending_mandatory: 88, unclassified_count: 0,
    expired_count: 0, management_types: ['TRACTOREO'], trips_30d: 0,
    funnel_group: 'en_proceso' as FunnelGroup,
    ...over,
  }
}

type Props = Parameters<typeof CertificationFunnel>[0]

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    rows: [fila()],
    catalogRows: [],
    catalogLoading: false,
    onExpandCatalog: vi.fn(),
    ...over,
  }
  render(<CertificationFunnel {...props} />)
  return props
}

describe('CertificationFunnel', () => {
  it('agrupa por etapa y nombra la cantidad de cada grupo', () => {
    setup({
      rows: [
        fila({ funnel_group: 'sin_documentos', entity_id: 'a', entity_name: 'Los Nogales' }),
        fila({ funnel_group: 'en_proceso', entity_id: 'b', entity_name: 'Charlotte' }),
        fila({ funnel_group: 'en_proceso', entity_id: 'c', entity_name: 'Parras' }),
      ],
    })

    expect(screen.getByText(/recién creadas/i)).toBeInTheDocument()
    const enProceso = screen.getByTestId('grupo-en_proceso')
    expect(within(enProceso).getByText('2')).toBeInTheDocument()
  })

  // El orden es el del embudo, no el alfabetico ni el de completitud: la
  // pantalla sirve a mover empresas de izquierda a derecha.
  it('respeta el orden del embudo', () => {
    setup({
      rows: [
        fila({ funnel_group: 'al_dia', entity_id: 'd', entity_name: 'Ya Lista' }),
        fila({ funnel_group: 'renovar', entity_id: 'c', entity_name: 'Aguilera' }),
        fila({ funnel_group: 'sin_documentos', entity_id: 'a', entity_name: 'Nogales' }),
        fila({ funnel_group: 'en_proceso', entity_id: 'b', entity_name: 'Charlotte' }),
      ],
    })

    const encabezados = screen.getAllByTestId(/^grupo-/).map(e => e.dataset.testid)
    expect(encabezados).toEqual([
      'grupo-sin_documentos', 'grupo-en_proceso', 'grupo-renovar',
      'grupo-al_dia', 'grupo-catalogo',
    ])
  })

  it('un grupo vacio no desaparece: dice cero', () => {
    setup({ rows: [fila({ funnel_group: 'en_proceso' })] })

    const alDia = screen.getByTestId('grupo-al_dia')
    expect(within(alDia).getByText('0')).toBeInTheDocument()
  })

  it('muestra el avance de cada empresa', () => {
    setup({ rows: [fila({ satisfied_count: 3, total_count: 93 })] })
    expect(screen.getByText('3 de 93')).toBeInTheDocument()
  })

  // Spec §9: el rojo #b00020 tiene UN significado, "hay archivos esperando".
  // El mockup del brainstorming pintaba "opera · N viajes" en rojo; se
  // descarta a proposito, porque si todo tiene color el color deja de avisar.
  it('la marca de actividad no usa el rojo reservado a los archivos que esperan', () => {
    setup({ rows: [fila({ trips_30d: 14, unclassified_count: 0 })] })

    const marca = screen.getByText(/14 viajes/i)
    expect(marca.className).not.toMatch(/red/)
  })

  it('los archivos esperando si van en rojo, y dicen cuantos', () => {
    setup({ rows: [fila({ unclassified_count: 12 })] })
    const marca = screen.getByTestId('espera-c1')
    expect(marca.textContent).toContain('12')
  })

  it('no inventa actividad cuando no hay viajes', () => {
    setup({ rows: [fila({ trips_30d: 0 })] })
    expect(screen.queryByText(/viajes/i)).not.toBeInTheDocument()
  })

  it('muestra el tipo de gestion de la empresa', () => {
    setup({ rows: [fila({ management_types: ['TRACTOREO'] })] })
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })

  // Hay 1 empresa mixta real y el spec pide mostrarla como tal, no esconder
  // una de las dos.
  it('la empresa mixta muestra las dos gestiones', () => {
    setup({ rows: [fila({ management_types: ['TRACTOREO', 'EQUIPO_COMPLETO'] })] })
    expect(screen.getByText('Tractoreo + Equipo Completo')).toBeInTheDocument()
  })

  it('sin gestion declarada ni flota no muestra marca', () => {
    setup({ rows: [fila({ management_types: null })] })
    expect(screen.queryByText(/tractoreo/i)).not.toBeInTheDocument()
  })

  it('el catalogo esta plegado y solo se pide al abrirlo', () => {
    const p = setup()

    expect(p.onExpandCatalog).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('grupo-catalogo'))
    expect(p.onExpandCatalog).toHaveBeenCalled()
  })

  it('al abrir el catalogo muestra sus filas', () => {
    setup({
      catalogRows: [fila({
        funnel_group: 'catalogo', entity_id: 'x', entity_name: 'Vieja Ltda',
        operational_status: 'LEGACY_INACTIVE',
      })],
    })

    fireEvent.click(screen.getByTestId('grupo-catalogo'))
    expect(screen.getByText('Vieja Ltda')).toBeInTheDocument()
  })

  it('abrir una fila avisa cual', () => {
    const onToggle = vi.fn()
    setup({ onToggleRow: onToggle })

    fireEvent.click(screen.getByText('Transportes Charlotte Spa'))
    expect(onToggle).toHaveBeenCalledWith('c1')
  })

  it('sin empresas lo dice', () => {
    setup({ rows: [] })
    expect(screen.getByText(/no hay empresas/i)).toBeInTheDocument()
  })

  // La fila se abre HACIA ABAJO: sin panel lateral, sin modal, sin pagina
  // nueva. El panel lateral del intento anterior apretaba la lista a media
  // pantalla y se revirtio entero en la Ronda 109.
  it('la fila abierta despliega su cajon debajo, en la misma lista', () => {
    setup({
      openRowId: 'c1',
      renderDrawer: (r: CertificationStatusRow) =>
        <div data-testid="cajon">cajón de {r.entity_name}</div>,
    })

    expect(screen.getByTestId('cajon')).toHaveTextContent('cajón de Transportes Charlotte Spa')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('las filas cerradas no montan su cajon', () => {
    setup({
      rows: [fila({ entity_id: 'c1' }), fila({ entity_id: 'c2', entity_name: 'Otra' })],
      openRowId: 'c1',
      renderDrawer: (r: CertificationStatusRow) =>
        <div data-testid={`cajon-${r.entity_id}`} />,
    })

    expect(screen.getByTestId('cajon-c1')).toBeInTheDocument()
    expect(screen.queryByTestId('cajon-c2')).not.toBeInTheDocument()
  })
})
