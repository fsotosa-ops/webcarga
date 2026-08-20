import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import FichaEmpresaPage from './page'
import type { Carrier, PendingComplianceRow } from '@/lib/types'

vi.mock('next/navigation', () => ({ useParams: vi.fn() }))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn(),
    get: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue({ status: 'APPROVED_MANUAL' }),
  },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: {
    get: vi.fn(),
    unassignDriver: vi.fn(),
    unassignAsset: vi.fn(),
    assignDriver: vi.fn(),
    assignAsset: vi.fn(),
  },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: vi.fn(() => true) }))

import { useParams } from 'next/navigation'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import { useCanEdit } from '@/hooks/useCanEdit'

const CARRIER: Carrier = {
  id: 'c1', tax_id: '1-9', country_code: 'CL', business_name: 'Transportes Demo Spa',
  operational_status: 'ACTIVE', management_types: null,
  legacy_admin_id: null, erp_id: null, is_manual_override: false,
  overridden_by: null, overridden_at: null, created_at: null, updated_at: null,
  contacts: [], compliance_records: [],
}

function fila(over: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Demo Spa', carrier_tax_id: '1-9',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_id: 'r1', requirement_code: 'F30', document_name: 'F30',
    status: 'MISSING', expiration_date: null, tiene_archivo: false,
    urgencia: 'FALTA', expiration_policy: 'NONE',
    ...over,
  } as PendingComplianceRow
}

/** Arma el QueryClientProvider y mockea `complianceApi.listPending`, mismo
 *  patrón que `CarrierDrawer.test.tsx`.
 *
 *  Ronda de arreglo 1: la página pide `estado='todos'` UNA sola vez —ya no
 *  cuatro variantes por bucket— y filtra en el cliente sobre `urgencia`. Por
 *  eso `montar()` mockea un solo `mockResolvedValue`, no cuatro. */
function montar(rows: PendingComplianceRow[], total = rows.length) {
  vi.mocked(useParams).mockReturnValue({ carrierId: 'c1' })
  vi.mocked(carriersApi.get).mockResolvedValue(CARRIER)
  vi.mocked(complianceApi.listPending).mockResolvedValue({ total, rows })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FichaEmpresaPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` no deshace un `mockReturnValue` puesto por un test
  // anterior (sólo limpia el historial de llamadas): sin este reset, un
  // test que apaga `canEdit` deja apagado a todos los que corren después.
  vi.mocked(useCanEdit).mockReturnValue(true)
})

describe('FichaEmpresaPage', () => {
  // La promesa de la pantalla —empresa, conductores y vehiculos JUNTOS— se
  // cumple ahora con tres filas de primer nivel y no con una por sujeto: con 20
  // conductores serian 21 filas y la lista volveria a ser larga. Los nombres
  // aparecen al abrir su grupo.
  it('muestra la empresa, sus conductores y sus vehículos juntos', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'CARRIER', subject_name: null }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
      fila({ id: 'p3', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' }),
    ])
    expect(await screen.findByRole('button', { name: /De la empresa/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Conductores/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vehículos/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Conductores/ }))
    expect(screen.getByRole('button', { name: /Juan Pérez/ })).toBeInTheDocument()
  })

  // La cuenta del grupo contesta "cuantos conductores tiene y como van" sin
  // abrir nada, que es la pregunta con la que se llega a la ficha.
  it('cada grupo dice cuántos son, cuántos requisitos y cómo van', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd2', subject_name: 'Ana Soto',
             urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p3', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' }),
    ])

    const conductores = await screen.findByRole('button', { name: /Conductores/ })
    expect(conductores).toHaveTextContent('2 conductores · 2 requisitos')
    expect(conductores).toHaveTextContent('1 al día · 1 falta')

    expect(screen.getByRole('button', { name: /Vehículos/ }))
      .toHaveTextContent('1 vehículo · 1 requisito')
  })

  it('empieza mostrando TODO, no sólo lo que falta', async () => {
    // Es la razon de ser de la pantalla: los 23 documentos cargados de la
    // unica empresa con documentacion no aparecian en ningun lado del modulo.
    montar([fila()])
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'todos' }),
    ))
    // La llamada sola no alcanza: es la UNICA que la pagina hace, siempre con
    // estado:'todos', sin importar el filtro activo — filtrar es trabajo del
    // cliente desde la ronda de arreglo 1. Lo que prueba que arranca
    // mostrando TODO es el filtro activo, no la llamada.
    await screen.findByText('De la empresa')
    expect(screen.getByRole('button', { name: /^Todo/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('cambiar el filtro cambia lo que se ve, sin volver a pedir nada', async () => {
    // Ronda de arreglo 1: una sola consulta (estado='todos'); el filtro
    // reparte lo que ya llegó usando `urgencia`, no dispara una consulta
    // nueva por click.
    montar([
      fila({ id: 'p1', document_name: 'Certificado al día', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA' }),
      fila({ id: 'p2', document_name: 'Rol SII', status: 'MISSING', urgencia: 'FALTA' }),
    ])
    await screen.findByText('Certificado al día')
    expect(screen.getByText('Rol SII')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Al día/i }))

    expect(screen.getByText('Certificado al día')).toBeInTheDocument()
    expect(screen.queryByText('Rol SII')).not.toBeInTheDocument()
    expect(complianceApi.listPending).toHaveBeenCalledTimes(1)
  })

  it('un documento cargado se puede ver; uno que falta se puede cargar', async () => {
    montar([
      // `tiene_archivo: true` explicito: el test dice "un documento CARGADO", y
      // el default de la fixture es sin archivo. Sin esto describia un
      // documento que se puede ver y no tiene nada que mostrar.
      fila({
        id: 'p1', status: 'APPROVED_MANUAL', document_name: 'Certificado de Vigencia',
        urgencia: 'AL_DIA', tiene_archivo: true,
      }),
      fila({ id: 'p2', status: 'MISSING', document_name: 'Rol SII' }),
    ])
    expect(await screen.findByRole('button', { name: /ver/i })).toBeInTheDocument()
    expect(screen.getByTestId('archivo-p2')).toBeInTheDocument()
  })

  // Ronda de arreglo: la ficha anunciaba "Aprobado (manual)" sobre un
  // documento vencido hace un año, mientras el filtro que lo contenía decía
  // "Falta" y el embudo lo contaba en "Hay que renovar". Son 9 registros
  // reales. La fila y el filtro tienen que leer `urgencia`, que es la única
  // fuente de esa verdad y ya viene en cada fila.
  it('un vencido se anuncia vencido, aunque su status diga "Aprobado (manual)"', async () => {
    montar([fila({
      id: 'p1', document_name: 'Certificado de Vigencia', status: 'APPROVED_MANUAL',
      expiration_date: '2025-08-12', urgencia: 'VENCIDO', tiene_archivo: true,
    })])

    expect(await screen.findByText('Certificado de Vigencia')).toBeInTheDocument()
    expect(screen.getByText(/^vencido hace \d+ días?$/)).toBeInTheDocument()
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })

  // El mismo defecto al revés: un vencido TIENE archivo —venció porque
  // alguien lo subió— y la ficha, que existe para hacer visible lo cargado,
  // lo mandaba al renglón de carga y escondía el archivo.
  it('un vencido con archivo se puede ver, además de reemplazar', async () => {
    montar([fila({ id: 'p1', status: 'EXPIRED', urgencia: 'VENCIDO', tiene_archivo: true })])

    expect(await screen.findByRole('button', { name: 'Ver' })).toBeInTheDocument()
    expect(screen.getByTestId('archivo-p1')).toBeInTheDocument()
  })

  it('lo que falta y no tiene archivo no ofrece verlo', async () => {
    montar([fila({ id: 'p1', status: 'MISSING', urgencia: 'FALTA', tiene_archivo: false })])

    expect(await screen.findByTestId('archivo-p1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver' })).not.toBeInTheDocument()
  })

  // El "por vencer" caía en la fila de documento cargado con el badge de su
  // status ("Aprobado"), o sea la misma contradicción que el vencido: el
  // filtro decía "Por vencer" y el renglón decía "Aprobado".
  it('un por vencer dice cuándo vence, no "Aprobado"', async () => {
    const enDiezDias = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
    montar([fila({
      id: 'p1', status: 'APPROVED_MANUAL', expiration_date: enDiezDias,
      urgencia: 'POR_VENCER', tiene_archivo: true,
    })])

    expect(await screen.findByText(/^vence en \d+ días?$/)).toBeInTheDocument()
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })

  // "Falló" es uno de los cuatro estados obligatorios de pantalla, y su regla
  // es que no puede parecer que no pasó nada. Antes: el modal sólo se montaba
  // con `file_url`, así que si la consulta fallaba el spinner se apagaba y no
  // ocurría nada — y volver a tocar "Ver" con el mismo id no cambiaba estado,
  // así que el botón quedaba muerto hasta recargar la página.
  it('si "Ver" falla, lo dice en el renglón y deja reintentar', async () => {
    vi.mocked(complianceApi.get).mockRejectedValue(new Error('sesión vencida'))
    montar([fila({ id: 'p1', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA', tiene_archivo: true })])

    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo abrir/i)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(complianceApi.get).toHaveBeenCalledTimes(2))
  })

  // El otro camino al mismo lugar: un registro en revisión o rechazado puede
  // no tener archivo, y ofrecía "Ver" igual.
  it('un registro sin archivo que abrir lo dice, en vez de no hacer nada', async () => {
    vi.mocked(complianceApi.get).mockResolvedValue({ file_url: null } as never)
    montar([fila({ id: 'p1', status: 'PENDING_REVIEW', urgencia: 'AL_DIA', tiene_archivo: true })])

    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no tiene un archivo/i)
  })

  // Estar al dia NO implica tener archivo: una aprobacion manual sin evidencia
  // adjunta es al dia y no tiene blob. Son 62 renglones repartidos en 37 de las
  // 38 empresas activas, y con un "Ver" incondicional cada uno abria un boton
  // que solo podia contestar que no hay nada que abrir. La otra mitad de la
  // lista ya lo resolvia bien; esta la ofrecia igual.
  it('una fila al día SIN archivo no ofrece "Ver", porque no hay nada que ver', async () => {
    montar([fila({
      id: 'p1', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA',
      tiene_archivo: false, document_name: 'Carta de compromiso',
    })])

    expect(await screen.findByText('Carta de compromiso')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver' })).not.toBeInTheDocument()
  })

  // "Todavia no llego" y "no se va a mostrar" son mensajes distintos, y esta
  // pantalla necesita los dos. Sin `cargando`, las cuatro cifras arrancaban en
  // guion —negando de entrada un dato que venia en camino— y el guion perdia su
  // unico significado, que es el de la respuesta truncada.
  it('mientras la consulta viaja, las cifras no niegan el dato', async () => {
    // La empresa resuelve y los pendientes NO: es la ventana real donde la
    // pantalla ya se dibujó y las cifras todavía no tienen su número. Con las
    // dos consultas en vuelo la página entera muestra su estado de carga y
    // este test no podría distinguir nada.
    let resolver: (v: unknown) => void = () => {}
    vi.mocked(useParams).mockReturnValue({ carrierId: 'c1' })
    vi.mocked(carriersApi.get).mockResolvedValue(CARRIER)
    vi.mocked(complianceApi.listPending).mockReturnValue(
      new Promise(r => { resolver = r }) as never,
    )
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FichaEmpresaPage />
      </QueryClientProvider>,
    )
    // Esperar a que la empresa llegue: recién ahí se dibujan las cifras.
    await screen.findAllByText(CARRIER.business_name)

    // La asercion va SINCRONICA, sin `waitFor`. Con `waitFor` este test no
    // mataba nada: reintenta hasta que pasa, asi que el guion inicial se
    // desvanecia solo al resolverse la promesa y el test daba verde con el
    // defecto puesto. Lo que se afirma es el PRIMER render, que es justo el
    // momento en que las cifras negaban un dato que venia en camino.
    expect(screen.queryByText('—')).not.toBeInTheDocument()

    resolver({ total: 0, rows: [] })
    await waitFor(() => expect(screen.getAllByText('0').length).toBeGreaterThan(0))
  })

  // El mockup acordado dibuja cada sujeto como una tarjeta con cabecera: icono,
  // nombre, QUE ES y cuantos requisitos, y su avance. Sin eso —un <p> con el
  // nombre y todos los requisitos desplegados— la ficha medía 6,4 pantallas: el
  // primer conductor caía bajo el pliegue y el primer vehículo 4,3 pantallas más
  // abajo. Que la empresa CONTIENE conductores y vehículos dejaba de verse.
  it('cada sujeto dice qué es, cuántos requisitos tiene y cómo va', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'CARRIER', urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p2', entity_type: 'CARRIER', urgencia: 'FALTA' }),
      fila({ id: 'p3', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
      fila({ id: 'p4', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             urgencia: 'POR_VENCER', tiene_archivo: true }),
      fila({ id: 'p5', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' }),
    ])

    const empresa = await screen.findByRole('button', { name: /De la empresa/ })
    expect(empresa).toHaveTextContent('2 requisitos')
    expect(empresa).toHaveTextContent('1 al día · 1 falta')

    fireEvent.click(screen.getByRole('button', { name: /Conductores/ }))
    const conductor = screen.getByRole('button', { name: /Juan Pérez/ })
    expect(conductor).toHaveTextContent('Conductor · 2 requisitos')
    expect(conductor).toHaveTextContent('1 por vencer · 1 falta')
    // Y NO escribe el cero: este conductor no tiene ninguno al día, y
    // "0 al día" ocupa el mismo espacio que un dato sin decir nada. La
    // asercion de arriba sola no lo defiende —`toHaveTextContent` busca
    // subcadena, asi que "0 al día · 1 por vencer · 1 falta" tambien la
    // cumpliria—, y sin esta linea la mutacion sobrevivia.
    expect(conductor).not.toHaveTextContent('0 al día')

    fireEvent.click(screen.getByRole('button', { name: /Vehículos/ }))
    expect(screen.getByRole('button', { name: /HKXW55/ }))
      .toHaveTextContent('Vehículo · 1 requisito')
  })

  // Los tres sujetos se ven JUNTOS, que es lo que la ficha vino a resolver: sus
  // cuerpos van plegados y la cabecera carga el total. En el mockup cada sujeto
  // declara "12 requisitos" y muestra UNA fila.
  it('conductores y vehículos se ven sin desplegar nada, y se abren al tocarlos', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             document_name: 'Licencia de Conducir' }),
      fila({ id: 'p2', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
             document_name: 'Revisión Técnica' }),
    ])

    // Los dos grupos, visibles de entrada; sus sujetos, al abrirlos.
    expect(await screen.findByRole('button', { name: /Conductores/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vehículos/ })).toBeInTheDocument()

    // Y arrancan PLEGADOS: es lo unico que mantiene la lista en tres filas por
    // grande que sea la flota. Sin esta asercion, hacer que el grupo se abra
    // solo no rompia ningun test —los nombres aparecerian y el resto seguiria
    // pasando— y la lista larga volvia sin que nadie se enterara.
    expect(screen.getByRole('button', { name: /Conductores/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /Juan Pérez/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Conductores/ }))
    expect(screen.getByRole('button', { name: /Juan Pérez/ })).toBeInTheDocument()

    // Sus requisitos, no: por eso caben juntos en una pantalla.
    expect(screen.queryByText('Licencia de Conducir')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Juan Pérez/ })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: /Juan Pérez/ }))

    expect(screen.getByText('Licencia de Conducir')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Juan Pérez/ })).toHaveAttribute('aria-expanded', 'true')
    // Abrir uno no abre el resto.
    expect(screen.queryByText('Revisión Técnica')).not.toBeInTheDocument()
  })

  // Medido en vivo: con "De la empresa" abierta sus 13 casilleros ocupan 571 px
  // y empujaban la primera cabecera de conductor a 873 px, bajo el pliegue de
  // una pantalla de 689. Volvia a pasar lo que esta pantalla vino a arreglar.
  it('la empresa también arranca plegada, para que se vea el conjunto', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'CARRIER', document_name: 'Rol SII' }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
    ])

    expect(await screen.findByRole('button', { name: /De la empresa/ }))
      .toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Rol SII')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /De la empresa/ }))
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
  })

  // Plegar existe para dejar ver el conjunto. Con un solo sujeto no hay
  // conjunto: seria llegar a una fila cerrada y nada mas.
  it('una empresa sin flota asignada abre su único sujeto', async () => {
    montar([fila({ id: 'p1', entity_type: 'CARRIER', document_name: 'Rol SII' })])

    expect(await screen.findByText('Rol SII')).toBeInTheDocument()
  })

  // Con `estado='todos'`, cero filas NO significa "nadie cargó nada": significa
  // que la empresa no tiene ni un `compliance_record`. Las 32 empresas sin
  // documentos sí tienen registros MISSING, así que nunca ven este mensaje; lo
  // ve la empresa a la que todavía no se le sembró el catálogo, y decirle
  // "carga documentos" es decirle lo que no es — cargar no lo arregla.
  it('sin requisitos asignados lo dice, en vez de culpar a nadie por no cargar', async () => {
    montar([])
    expect(await screen.findByText(/no tiene requisitos/i)).toBeInTheDocument()
    expect(screen.queryByText(/nadie cargó documentos/i)).not.toBeInTheDocument()
  })

  // "La preselección de empresa no es comodidad: es precisión" — el motor
  // acota el universo a las entidades de esa empresa (~2 conductores y ~3
  // vehículos contra 87 y 124). El enlace pelado dejaba esa capacidad sin
  // puerta, que es palabra por palabra la crítica que la spec le hacía al
  // estado anterior.
  it('el puente a la Bandeja llega con la empresa ya elegida', async () => {
    montar([fila()])
    const enlace = await screen.findByRole('link', { name: /bandeja/i })
    expect(enlace).toHaveAttribute('href', '/dashboard/compliance/inbox?empresa=c1')
  })

  it('un lector ve todo y no puede cargar nada', async () => {
    vi.mocked(useCanEdit).mockReturnValue(false)
    montar([fila({ id: 'p1', status: 'MISSING' })])
    expect(await screen.findByText('De la empresa')).toBeInTheDocument()
    expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
  })

  it('si la lista vino truncada, sólo la cifra de "todos" afirma un número', async () => {
    // rows.length (2) < total (500): contar sobre lo que llego para las
    // otras tres cifras mentiria — son una muestra, no el universo. Dicen que
    // no hay dato en vez de latir para siempre prometiendo uno.
    montar([fila({ id: 'p1' }), fila({ id: 'p2', requirement_id: 'r2' })], 500)
    await screen.findByText('De la empresa')
    expect(screen.getAllByText('500').length).toBeGreaterThan(0)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  it('sin flota conocida, el chip de tipo de operación lo dice en vez de desaparecer', async () => {
    montar([])
    expect(await screen.findByText('Tipo de operación sin determinar')).toBeInTheDocument()
  })

  // Una afirmación derivada no se muestra sin el dato. Si la consulta falló no
  // sabemos que el tipo esté sin determinar: no pudimos preguntarlo.
  it('si la consulta falló, el chip se calla en vez de afirmar "sin determinar"', async () => {
    vi.mocked(useParams).mockReturnValue({ carrierId: 'c1' })
    vi.mocked(carriersApi.get).mockResolvedValue(CARRIER)
    vi.mocked(complianceApi.listPending).mockRejectedValue(new Error('500'))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FichaEmpresaPage />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/no se pudo cargar la documentación/i)).toBeInTheDocument()
    expect(screen.queryByText('Tipo de operación sin determinar')).not.toBeInTheDocument()
  })

  // Task 5: dar de baja y transferir sin salir de la ficha.
  it('dar de baja a un conductor lo saca de la ficha, sin tocar sus documentos', async () => {
    vi.mocked(carriersApi.unassignDriver).mockResolvedValue({ ok: true })
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
    ])

    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

    await waitFor(() => expect(carriersApi.unassignDriver).toHaveBeenCalledWith('c1', 'd1'))
    // Nada se borra: la baja es un estado de la asignacion.
    expect(complianceApi.uploadFile).not.toHaveBeenCalled()
  })

  // Hallazgo 1 de la revisión final (bloqueante): `cuantosDocumentos` salía
  // de `s.filas`, que son las filas del sujeto YA FILTRADAS por el estado
  // activo — no todas las suyas. Con el filtro en "Falta" —la forma natural
  // de trabajar esta pantalla— un conductor con documentos al día perdía la
  // única frase que ese diálogo existe para decir.
  it('con el filtro en "Falta", el diálogo de baja sigue contando los documentos que sí tiene', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             requirement_id: 'r2', urgencia: 'FALTA', tiene_archivo: false }),
    ])

    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Falta/i }))

    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(/1 documento/)
  })

  it('un vehículo se da de baja por su propio endpoint, no por el de conductores', async () => {
    // El sujeto sabe lo que es; sin esto, una sola rama trataria a los dos igual
    // y el vehiculo se iria contra /drivers/{id}.
    vi.mocked(carriersApi.unassignAsset).mockResolvedValue({ ok: true })
    montar([fila({ id: 'p1', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' })])

    fireEvent.click(await screen.findByRole('button', { name: /Vehículos/ }))
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

    await waitFor(() => expect(carriersApi.unassignAsset).toHaveBeenCalledWith('c1', 'a1'))
    expect(carriersApi.unassignDriver).not.toHaveBeenCalled()
  })

  it('transferir usa el modal que ya existe y excluye a la empresa actual', async () => {
    montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Transferir/ }))

    expect(screen.getByPlaceholderText(/empresa destino/i)).toBeInTheDocument()
  })

  it('un viewer no ve el menú', async () => {
    vi.mocked(useCanEdit).mockReturnValue(false)
    montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
    expect(screen.queryByRole('button', { name: /acciones/i })).not.toBeInTheDocument()
  })

  it('dar de baja al último conductor deja la ficha usable, sin el grupo vacío', async () => {
    // A3. El agrupado ya descarta los grupos sin sujetos, pero nada lo afirmaba:
    // el dia que alguien "simplifique" ese filter, la ficha muestra un grupo
    // "Conductores · 0 conductores" y parece rota.
    vi.mocked(carriersApi.unassignDriver).mockResolvedValue({ ok: true })
    montar([fila({ id: 'p1', entity_type: 'CARRIER' })])   // ya sin conductores

    expect(await screen.findByRole('button', { name: /De la empresa/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Conductores/ })).not.toBeInTheDocument()
  })

  it('dar de baja dos veces lo dice, en vez de romperse', async () => {
    // A6: doble clic, o la misma ficha abierta en dos pestañas. El backend
    // responde 404 "Asignación activa no encontrada" y eso hay que mostrarlo.
    //
    // Ronda de arreglo 1: el motivo se dice DENTRO del diálogo, no en la
    // tarjeta. `ConfirmarBaja` ya lo endureció (ronda anterior) para no
    // cerrarse solo ante Escape ni el fondo mientras hay un request en
    // vuelo; dejar que el padre lo cierre ante un error tiraría esa garantía
    // por la puerta de atrás — un diálogo que se desvanece se lee "listo".
    vi.mocked(carriersApi.unassignDriver).mockRejectedValue(
      new Error('Asignación activa no encontrada'),
    )
    montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/no encontrada/i)
    // Sigue abierto y ofrece reintentar sin volver a confirmar desde cero.
    expect(screen.getByRole('button', { name: /^Dar de baja$/ })).toBeInTheDocument()
  })

  it('si la baja falla, el diálogo lo dice ahí mismo y no se cierra solo', async () => {
    // El diálogo no se desvanece ante el fallo: si se cerrara, quien mira
    // leería "listo" y tendría que ir a buscar una nota en otro lado para
    // enterarse de que no pasó. El sujeto, además, sigue asignado —nada lo
    // sacó de la ficha detrás del diálogo.
    vi.mocked(carriersApi.unassignDriver).mockRejectedValue(new Error('sesión vencida'))
    montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/sesión vencida/i)
    expect(screen.getByRole('button', { name: /Juan Pérez/ })).toBeInTheDocument()
  })
})
