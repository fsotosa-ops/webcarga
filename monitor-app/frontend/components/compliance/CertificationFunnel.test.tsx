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
    catalogEstado: 'sin-pedir' as const,
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

    expect(screen.getByText('Sin documentos')).toBeInTheDocument()
    const enProceso = screen.getByTestId('grupo-en_proceso')
    expect(within(enProceso).getByText('2')).toBeInTheDocument()
  })

  // Los cinco nombres son del MISMO tipo: el estado en que está la empresa.
  // Antes mezclaban estado ("Recién creadas"), acción ("Hay que renovar") y
  // sobrante ("Resto del catálogo"), y esa inconsistencia es parte de por qué
  // la lista no se leía como una secuencia. El test los fija juntos, no de a
  // uno: lo que importa es que sigan siendo la misma forma gramatical.
  it('nombra los grupos por el estado de la empresa', () => {
    setup({ rows: [] })
    for (const titulo of ['Sin documentos', 'Incompletas', 'Con vencimientos', 'Al día', 'No activas']) {
      expect(screen.getByText(titulo)).toBeInTheDocument()
    }
  })

  // El grupo tiene que MANDAR sobre sus filas. Iba en un `span` de 10px
  // versalitas y quedaba más débil que las empresas que contiene, así que se
  // leía como una franja de color y no como algo que se abre. Un encabezado
  // real además deja saltar de grupo en grupo con lector de pantalla.
  it('el título del grupo es un encabezado, no un texto suelto', () => {
    setup({ rows: [fila({ funnel_group: 'en_proceso', entity_id: 'b', entity_name: 'Charlotte' })] })
    const encabezados = screen.getAllByRole('heading', { level: 2 })
    expect(encabezados.map(h => h.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Incompletas')]),
    )
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

  it('el catalogo plegado no muestra un cero: todavia no sabe cuantas son', () => {
    setup()

    // Un "0" al lado de un grupo plegado se lee como "aca no hay nada", y
    // entonces nadie lo abre: las 209 empresas del catalogo quedan invisibles
    // detras de un numero que significa "todavia no pregunte".
    expect(screen.getByTestId('grupo-catalogo')).not.toHaveTextContent('0')
  })

  it('con el catalogo ya cargado si muestra su conteo', () => {
    setup({
      catalogEstado: 'listo',
      catalogRows: [fila({
        funnel_group: 'catalogo', entity_id: 'x', entity_name: 'Vieja Ltda',
        operational_status: 'LEGACY_INACTIVE',
      })],
    })

    expect(screen.getByTestId('grupo-catalogo')).toHaveTextContent('1')
  })

  // Cargado y de verdad vacio es distinto de "todavia no pregunte": aca el cero
  // SI informa, porque hay dato detras.
  it('cargado y realmente vacio si dice cero', () => {
    setup({ catalogEstado: 'listo', catalogRows: [] })
    expect(screen.getByTestId('grupo-catalogo')).toHaveTextContent('0')
  })

  // Un fallo de red se dibujaba igual que un catalogo vacio: sin numero, sin
  // aviso, y el cuerpo desplegado decia "Ninguna aca". El usuario concluia que
  // no habia empresas cuando en realidad la consulta habia fallado.
  it('si el catalogo falla lo dice, en vez de parecer vacio', () => {
    setup({ catalogEstado: 'error', catalogRows: [] })

    const encabezado = screen.getByTestId('grupo-catalogo')
    expect(encabezado).toHaveTextContent(/no se pudo cargar/i)
    expect(encabezado).not.toHaveTextContent('0')
  })

  it('el cuerpo del catalogo fallado no dice "ninguna aca"', () => {
    setup({ catalogEstado: 'error', catalogRows: [] })

    fireEvent.click(screen.getByTestId('grupo-catalogo'))
    expect(screen.getByText(/no se pudo cargar el catálogo/i)).toBeInTheDocument()
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

  // La fila NAVEGA a la ficha, asi que es un enlace: mientras fue un
  // `role="button"` con `aria-expanded`, un lector de pantalla anunciaba
  // "boton, contraido" y activarlo sacaba de la pantalla.
  it('la fila es un enlace a la ficha, no un desplegable', () => {
    setup()

    const enlace = screen.getByRole('link', { name: /Transportes Charlotte Spa/ })
    expect(enlace).toHaveAttribute('href', '/dashboard/compliance/c1')
    expect(enlace).not.toHaveAttribute('aria-expanded')
  })

  // REGRESION (revision de rama, 2026-08-15): antes, con `rows` vacio se
  // devolvia un estado vacio ANTES de dibujar los encabezados. Como el
  // catalogo solo se carga al desplegarlo —y ese desplegable vivia dentro del
  // arbol recien cortocircuitado—, buscar el nombre de cualquiera de las 209
  // empresas no activas daba "no hay empresas" SIN forma de llegar a ellas.
  // Contradecia el contrato de alcances "disjuntos y exhaustivos".
  it('sin coincidencias activas, el catalogo sigue siendo alcanzable', () => {
    const p = setup({ rows: [] })

    expect(screen.getByTestId('grupo-catalogo')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('grupo-catalogo'))
    expect(p.onExpandCatalog).toHaveBeenCalled()
  })

  it('un grupo desplegado y vacio lo dice, en vez de quedar mudo', () => {
    setup({ rows: [] })
    expect(screen.getAllByText(/ninguna acá/i).length).toBeGreaterThan(0)
  })
})
