import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import FichaEmpresaPage from './page'
import type { Carrier, ComplianceSummaryResponse, ComplianceSummarySubject, PendingComplianceRow } from '@/lib/types'

vi.mock('next/navigation', () => ({ useParams: vi.fn() }))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn(),
    summary: vi.fn(),
    patch: vi.fn(),
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
    patch: vi.fn(),
  },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: vi.fn(() => true) }))
// Por defecto NO es admin: el default de un mock de permisos tiene que ser
// el permiso más chico, o un test que se olvide de declararlo pasa por la
// puerta más ancha sin decirlo.
vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: vi.fn(() => false) }))

import { useParams } from 'next/navigation'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { useCanEdit } from '@/hooks/useCanEdit'

const CARRIER: Carrier = {
  id: 'c1', tax_id: '1-9', country_code: 'CL', business_name: 'Transportes Demo Spa',
  operational_status: 'ACTIVE', management_types: null,
  legacy_admin_id: null, erp_id: null, is_manual_override: false,
  overridden_by: null, overridden_at: null, created_at: null, updated_at: null,
  contacts: [], compliance_records: [],
}

/** Una fila de detalle que además puede declarar qué ES el vehículo. En el
 *  backend esos cuatro campos viajan en el RESUMEN, no en el detalle; acá se
 *  cuelgan de la fila porque `resumenDesdeFilas` arma los sujetos a partir de
 *  ellas, y así el test declara el sujeto completo en un solo lugar. */
type FilaDePrueba = PendingComplianceRow & Partial<Pick<
  ComplianceSummarySubject,
  'asset_type' | 'fleet_service_type_label'
  | 'fleet_service_type_bg_color' | 'fleet_service_type_text_color'
>>

function fila(over: Partial<FilaDePrueba> = {}): FilaDePrueba {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Demo Spa', carrier_tax_id: '1-9',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_id: 'r1', requirement_code: 'F30', document_name: 'F30',
    status: 'MISSING', expiration_date: null, tiene_archivo: false,
    urgencia: 'FALTA', expiration_policy: 'NONE',
    ...over,
  } as FilaDePrueba
}

/** El resumen que el backend calcularía sobre este mismo set de filas —
 *  misma partición que `_SUMMARY_SQL` (Task 2): `al_dia`/`por_vencer` cuentan
 *  su rama exacta de `urgencia`, `falta` junta FALTA y VENCIDO. */
function resumenDesdeFilas(rows: FilaDePrueba[]): ComplianceSummaryResponse {
  const porSujeto = new Map<string, ComplianceSummarySubject>()
  for (const r of rows) {
    const clave = `${r.entity_type}:${r.entity_id}`
    if (!porSujeto.has(clave)) {
      porSujeto.set(clave, {
        entity_type: r.entity_type, entity_id: r.entity_id, subject_name: r.subject_name,
        todos: 0, al_dia: 0, por_vencer: 0, falta: 0,
        // Null es el default correcto, no un relleno: es lo que el backend
        // manda para una empresa o un conductor.
        asset_type:                    r.asset_type ?? null,
        fleet_service_type_label:      r.fleet_service_type_label ?? null,
        fleet_service_type_bg_color:   r.fleet_service_type_bg_color ?? null,
        fleet_service_type_text_color: r.fleet_service_type_text_color ?? null,
      })
    }
    const s = porSujeto.get(clave)!
    s.todos += 1
    if (r.urgencia === 'AL_DIA') s.al_dia += 1
    else if (r.urgencia === 'POR_VENCER') s.por_vencer += 1
    else s.falta += 1 // FALTA o VENCIDO
  }
  const sujetos = [...porSujeto.values()]
  const totales = sujetos.reduce(
    (acc, s) => ({
      todos: acc.todos + s.todos, al_dia: acc.al_dia + s.al_dia,
      por_vencer: acc.por_vencer + s.por_vencer, falta: acc.falta + s.falta,
    }),
    { todos: 0, al_dia: 0, por_vencer: 0, falta: 0 },
  )
  return { totales, sujetos, completo: true, carrier_operation_types: rows[0]?.carrier_operation_types ?? [] }
}

/** Lo que `GET /pending?estado=X` devolvería sobre las filas de UN sujeto —
 *  mismo criterio que `pendiente_predicate`: 'falta' es "no está al día"
 *  (incluye lo por vencer), no el casillero exclusivo del resumen. */
function filasParaEstado(rows: FilaDePrueba[], estado?: string): FilaDePrueba[] {
  switch (estado) {
    case 'al_dia':     return rows.filter(r => r.urgencia === 'AL_DIA')
    case 'por_vencer': return rows.filter(r => r.urgencia === 'POR_VENCER')
    case 'falta':      return rows.filter(r => r.urgencia !== 'AL_DIA')
    default:           return rows // 'todos' o sin filtro
  }
}

/** Arma el QueryClientProvider y mockea `complianceApi.summary` (el resumen
 *  que la ficha pide al llegar) y `complianceApi.listPending` (el detalle de
 *  UN sujeto, que se pide recién al desplegarlo) — las dos derivadas del
 *  MISMO set de filas, para que el test siga escribiendo un solo fixture,
 *  como antes de la Task 2. */
function montar(rows: FilaDePrueba[], empresa: Carrier = CARRIER) {
  vi.mocked(useParams).mockReturnValue({ carrierId: 'c1' })
  vi.mocked(carriersApi.get).mockResolvedValue(empresa)
  vi.mocked(complianceApi.summary).mockResolvedValue(resumenDesdeFilas(rows))
  vi.mocked(complianceApi.listPending).mockImplementation(async (params = {}) => {
    const delSujeto = rows.filter(r => r.entity_id === params.entityId)
    const filtradas = filasParaEstado(delSujeto, params.estado)
    return { total: filtradas.length, rows: filtradas }
  })
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
  vi.mocked(useCanAdmin).mockReturnValue(false)
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
  // abrir nada, que es la pregunta con la que se llega a la ficha. Sale del
  // resumen, no de contar filas — por eso no hace falta desplegar nada.
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

  // La razon de ser de la Task 2: al llegar, la ficha pide el RESUMEN — no
  // las 457 filas de detalle que antes bajaba sólo para dibujar nueve
  // cabeceras.
  it('al llegar pide el resumen, no el detalle de nadie', async () => {
    montar([fila()])
    await waitFor(() => expect(complianceApi.summary).toHaveBeenCalledWith('c1'))
    await screen.findByText('De la empresa')
    expect(screen.getByRole('button', { name: /^Todo/i })).toHaveAttribute('aria-pressed', 'true')
    // El sujeto único arranca desplegado (ver test de más abajo), así que
    // esto SÍ dispara un listPending — pero ninguno antes de que el resumen
    // resuelva y decida qué sujetos hay.
    expect(complianceApi.summary).toHaveBeenCalledTimes(1)
  })

  // Con más de un sujeto, nadie arranca desplegado: no hay ningun detalle
  // que pedir hasta que alguien despliegue algo. Es la baja de 457 filas a
  // "cero" en la primera carga.
  it('con varios sujetos, no se pide el detalle de ninguno hasta desplegar', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
      fila({ id: 'p2', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' }),
    ])
    await screen.findByRole('button', { name: /Conductores/ })
    expect(complianceApi.listPending).not.toHaveBeenCalled()
  })

  // Hallazgo 4 de la revision final: con `estadoFiltro` en la clave de
  // cache, cada clic de filtro invalidaba la consulta de TODOS los sujetos
  // desplegados y volvia a la red — con nueve sujetos abiertos, un clic son
  // nueve peticiones. El detalle de un sujeto se pide UNA sola vez, con
  // `estado='todos'` fijo; el filtro reparte en el cliente sobre `urgencia`,
  // la MISMA particion que ya trae cada fila.
  it('cambiar el filtro cambia lo que se ve, sin volver a pedir nada', async () => {
    montar([
      fila({ id: 'p1', document_name: 'Certificado al día', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA' }),
      fila({ id: 'p2', document_name: 'Rol SII', status: 'MISSING', urgencia: 'FALTA' }),
    ])
    await screen.findByText('Certificado al día')
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'c1', estado: 'todos' }),
    ))
    expect(complianceApi.listPending).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /^Al día/i }))

    // Sincrónico: el filtro ya cambió lo que se ve sin que medie ninguna
    // consulta nueva — si hiciera falta un `waitFor` acá para que la fila
    // vieja desaparezca, sería porque está esperando a la red de nuevo.
    expect(screen.getByText('Certificado al día')).toBeInTheDocument()
    expect(screen.queryByText('Rol SII')).not.toBeInTheDocument()
    expect(complianceApi.listPending).toHaveBeenCalledTimes(1)
  })

  // El avance de la cabecera sale del resumen (`sujeto.al_dia`/`por_vencer`/
  // `falta`), que no cambia con el filtro activo — a diferencia de la
  // version anterior, que contaba sobre las filas YA filtradas y mostraba
  // sólo el subconjunto elegido. La cabecera dice cómo va ESE conductor, no
  // cómo va dentro del filtro: con "Falta" activo, un conductor con 1 al día
  // y 1 falta seguía mostrando su "1 al día" en la cabecera, aunque la lista
  // de abajo sólo mostrara la fila que falta.
  it('el avance de la cabecera muestra el desglose completo, no sólo lo que deja ver el filtro activo', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             requirement_id: 'r2', urgencia: 'FALTA' }),
    ])
    // Sujeto único: arranca desplegado, así que la cabecera ya muestra su
    // avance completo antes de tocar ningún filtro.
    const cabecera = await screen.findByRole('button', { name: /Juan Pérez/ })
    expect(cabecera).toHaveTextContent('1 al día · 1 falta')
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'd1', estado: 'todos' }),
    ))

    fireEvent.click(screen.getByRole('button', { name: /^Falta/i }))

    // La lista de abajo SÍ se acota al filtro (ya probado arriba, sin pedir
    // nada nuevo); la cabecera, no — sigue diciendo "1 al día · 1 falta", no
    // sólo "1 falta". Y el detalle de este sujeto se pidió una sola vez.
    expect(screen.getByRole('button', { name: /Juan Pérez/ })).toHaveTextContent('1 al día · 1 falta')
    expect(complianceApi.listPending).toHaveBeenCalledTimes(1)
  })

  // Hallazgo 1 de la revision final: el chip "Falta" leía el balde exclusivo
  // del resumen (`totales.falta` = FALTA + VENCIDO, sin lo por vencer) y la
  // lista, al hacer clic, venía de `/pending?estado=falta`, que SÍ incluye
  // lo por vencer -mismo rótulo, dos conjuntos. Con 1 al día + 1 por vencer +
  // 1 falta, el chip decía "Falta 1" y la lista mostraba 2. Repartir en el
  // cliente sobre la MISMA partición exclusiva que ya trae `urgencia` hace
  // que la contradicción no pueda existir: hay una sola definición de "falta".
  it('el número del chip "Falta" es la cantidad de filas que ese chip deja ver', async () => {
    montar([
      fila({ id: 'p1', document_name: 'Doc al día', urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p2', document_name: 'Doc por vencer', urgencia: 'POR_VENCER', tiene_archivo: true }),
      fila({ id: 'p3', document_name: 'Doc falta', urgencia: 'FALTA' }),
    ])
    await screen.findByText('Doc al día')

    const chipFalta = screen.getByRole('button', { name: /^Falta/i })
    const conteoDelChip = Number(within(chipFalta).getByText(/^\d+$/).textContent)

    fireEvent.click(chipFalta)

    const filasVisibles = ['Doc al día', 'Doc por vencer', 'Doc falta']
      .filter(nombre => screen.queryByText(nombre) !== null)

    // MISMA aserción: el número que el chip ya mostraba tiene que coincidir
    // con cuántas filas deja ver al activarlo — no dos números distintos con
    // la misma etiqueta al lado.
    expect(filasVisibles).toHaveLength(conteoDelChip)
    expect(filasVisibles).toEqual(['Doc falta'])
  })

  // Hallazgo 1c: con la caché compartida (misma clave `estado='todos'` para
  // el detalle y para el diálogo de baja), un sujeto que YA está desplegado
  // no dispara una segunda consulta al abrir "Dar de baja" — antes, la
  // consulta del diálogo llevaba `estado='todos'` fijo mientras la del
  // detalle llevaba `estadoFiltro`, así que con el filtro en "Falta" las
  // claves nunca coincidían y el diálogo SIEMPRE viajaba en blanco.
  it('con el sujeto ya desplegado, el diálogo de baja no espera una segunda consulta', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             requirement_id: 'r2', urgencia: 'FALTA', tiene_archivo: false }),
    ])

    // Sujeto único: arranca desplegado y su detalle ya está en caché.
    await screen.findByRole('button', { name: /Juan Pérez/ })
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledTimes(1))

    // Con el filtro en "Falta" -la forma natural de trabajar esta pantalla-,
    // antes esto NO compartía caché con el diálogo de baja.
    fireEvent.click(screen.getByRole('button', { name: /^Falta/i }))

    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))

    // SINCRÓNICO, sin `findByRole` ni `waitFor`: si el diálogo dependiera de
    // una consulta recién arrancada (cache fría), esto fallaría porque esa
    // consulta todavía no habría resuelto en este mismo instante. React
    // Query SÍ revalida en segundo plano al montar un segundo observador de
    // la misma clave (`staleTime` por defecto es 0) — por eso no se afirma
    // "una sola llamada de por vida", sólo que el dato YA estaba disponible
    // sin esperar nada.
    expect(screen.getByRole('dialog')).toHaveTextContent(/1 documento/)
  })

  // El otro lado del mismo hallazgo: un sujeto que NUNCA se desplegó no
  // tiene nada en caché, así que su diálogo de baja sí viaja en blanco por
  // un instante. Mientras tanto, `cuantosDocumentos` tiene que ser
  // `undefined` -no `0`- para que el diálogo no afirme "cero documentos"
  // (que es indistinguible de "no tiene ninguno") mientras todavía no sabe.
  it('con el detalle todavía en vuelo, el diálogo de baja no afirma nada sobre documentos', async () => {
    let resolver: (v: unknown) => void = () => {}
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez', urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd2', subject_name: 'Ana Soto', requirement_id: 'r2' }),
    ])
    vi.mocked(complianceApi.listPending).mockImplementation((params = {}) => {
      if (params.entityId === 'd1') return new Promise(r => { resolver = r }) as never
      return Promise.resolve({ total: 0, rows: [] })
    })

    // Dos sujetos: ninguno arranca desplegado, así que "Juan Pérez" no tiene
    // nada pedido todavía cuando se abre su menú. Son dos "Acciones" en
    // pantalla (uno por sujeto): `accionesDe` acota al de Juan Pérez.
    await screen.findByRole('button', { name: /Juan Pérez/ })
    fireEvent.click(accionesDe(/Juan Pérez/))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))

    const dialogo = screen.getByRole('dialog')
    // Sincrónico: sin esto, la promesa ya resuelta por el propio test runner
    // desvanecería la ventana en la que el dato todavía no llegó.
    expect(dialogo).not.toHaveTextContent(/se conservan/i)

    resolver({ total: 1, rows: [{ ...fila(), tiene_archivo: true }] })
    await waitFor(() => expect(dialogo).toHaveTextContent(/se conservan/i))
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
  // que solo podia contestar que no hay nada. La otra mitad de la lista ya lo
  // resolvia bien; esta la ofrecia igual.
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
  // guion —negando de entrada un dato que venia en camino. El resumen nunca
  // viene truncado (a diferencia de la lista vieja), asi que ya no hace falta
  // un segundo estado para "no se va a mostrar".
  it('mientras la consulta viaja, las cifras no niegan el dato', async () => {
    // La empresa resuelve y el resumen NO: es la ventana real donde la
    // pantalla ya se dibujó y las cifras todavía no tienen su número.
    let resolver: (v: unknown) => void = () => {}
    vi.mocked(useParams).mockReturnValue({ carrierId: 'c1' })
    vi.mocked(carriersApi.get).mockResolvedValue(CARRIER)
    vi.mocked(complianceApi.summary).mockReturnValue(
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

    resolver({
      totales: { todos: 0, al_dia: 0, por_vencer: 0, falta: 0 },
      sujetos: [], completo: true, carrier_operation_types: [],
    })
    await waitFor(() => expect(screen.getAllByText('0').length).toBeGreaterThan(0))
  })

  // Hallazgo 3 de la revisión final: `SUMMARY_LIMIT` entra como LIMIT DENTRO
  // de la CTE, antes del GROUP BY — si una empresa lo superara, el resumen
  // contaría sobre una lista recortada y las cuatro cifras quedarían mal, EN
  // SILENCIO. La guarda `completa` que existía para esto se borró apoyada en
  // la afirmación de que "el resumen nunca viene truncado" (falsa). Con
  // `completo: false`, la pantalla no muestra las cuatro cifras — un `—`,
  // no un número que podría estar mal.
  it('si el resumen viene truncado, la pantalla no afirma las cifras', async () => {
    vi.mocked(useParams).mockReturnValue({ carrierId: 'c1' })
    vi.mocked(carriersApi.get).mockResolvedValue(CARRIER)
    vi.mocked(complianceApi.summary).mockResolvedValue({
      totales: { todos: 42, al_dia: 10, por_vencer: 2, falta: 30 },
      sujetos: [],
      completo: false,
      carrier_operation_types: [],
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FichaEmpresaPage />
      </QueryClientProvider>,
    )

    await screen.findAllByText(CARRIER.business_name)
    await waitFor(() => expect(complianceApi.summary).toHaveBeenCalled())

    // Ninguna de las cuatro cifras se muestra — ni siquiera la que coincide
    // con el total real: mientras `completo` sea false no hay forma de saber
    // CUÁL de las cuatro está mal, así que ninguna se afirma.
    expect(await screen.findAllByText('—')).toHaveLength(4)
    expect(screen.queryByText('42')).not.toBeInTheDocument()
    expect(screen.queryByText('30')).not.toBeInTheDocument()
  })

  // El mockup acordado dibuja cada sujeto como una tarjeta con cabecera: icono,
  // nombre, QUE ES y cuantos requisitos, y su avance. Sin eso —un <p> con el
  // nombre y todos los requisitos desplegados— la ficha medía 6,4 pantallas: el
  // primer conductor caía bajo el pliegue y el primer vehículo 4,3 pantallas más
  // abajo. Que la empresa CONTIENE conductores y vehículos dejaba de verse.
  //
  // Las cifras de la cabecera salen del resumen: no hace falta desplegar
  // ningún sujeto para verlas.
  it('cada sujeto dice qué es, cuántos requisitos tiene y cómo va', async () => {
    montar([
      fila({ id: 'p1', entity_type: 'CARRIER', urgencia: 'AL_DIA', tiene_archivo: true }),
      fila({ id: 'p2', entity_type: 'CARRIER', urgencia: 'FALTA' }),
      fila({ id: 'p3', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
      fila({ id: 'p4', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
             urgencia: 'POR_VENCER', tiene_archivo: true }),
      fila({ id: 'p5', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
             asset_type: 'TRACTOCAMION' }),
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
    const vehiculo = screen.getByRole('button', { name: /HKXW55/ })
    // Antes decía "Vehículo · 1 requisito". La palabra genérica la reemplaza
    // el chasis real, que ahora viaja en el resumen: decir "Vehículo" al lado
    // de una patente no agregaba nada que la patente no dijera ya.
    expect(vehiculo).toHaveTextContent('Tracto')
    expect(vehiculo).toHaveTextContent('1 requisito')
    expect(vehiculo).not.toHaveTextContent('Vehículo ·')
  })

  // Los tres sujetos se ven JUNTOS, que es lo que la ficha vino a resolver: sus
  // cuerpos van plegados y la cabecera carga el total. En el mockup cada sujeto
  // declara "12 requisitos" y muestra UNA fila. Desplegar un sujeto dispara su
  // propio pedido de detalle — ya no hay una lista pre-cargada que filtrar.
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

    // Sus requisitos, no: por eso caben juntos en una pantalla. Y todavía no
    // se pidió ningún detalle.
    expect(screen.queryByText('Licencia de Conducir')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Juan Pérez/ })).toHaveAttribute('aria-expanded', 'false')
    expect(complianceApi.listPending).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Juan Pérez/ }))

    // Recién ahora se pidió SU detalle — no el de nadie más.
    expect(await screen.findByText('Licencia de Conducir')).toBeInTheDocument()
    expect(complianceApi.listPending).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'd1' }),
    )
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
    expect(await screen.findByText('Rol SII')).toBeInTheDocument()
  })

  // Plegar existe para dejar ver el conjunto. Con un solo sujeto no hay
  // conjunto: seria llegar a una fila cerrada y nada mas. Arranca desplegado,
  // asi que su detalle se pide sin que nadie toque nada.
  it('una empresa sin flota asignada abre su único sujeto', async () => {
    montar([fila({ id: 'p1', entity_type: 'CARRIER', document_name: 'Rol SII' })])

    expect(await screen.findByText('Rol SII')).toBeInTheDocument()
  })

  // Con el resumen, cero sujetos NO significa "nadie cargó nada": significa
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
    // Espera el renglon (su detalle se pide al desplegar, y este sujeto
    // único arranca desplegado): recien con el renglon montado tiene sentido
    // afirmar que el input de carga NO esta.
    expect(await screen.findByTestId('renglon-p1')).toBeInTheDocument()
    expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
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
    vi.mocked(complianceApi.summary).mockRejectedValue(new Error('500'))
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
  // única frase que ese diálogo existe para decir. Sigue valiendo con la
  // Task 2: el conteo del diálogo se pide aparte, con `estado='todos'` fijo,
  // sin importar el filtro activo de la pantalla.
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

  // HU-26. Corregir una fecha mal escrita era lo unico que todavia obligaba a
  // salir de Certificacion al modulo Empresas viejo. La celda ya existia y ya
  // estaba probada; vivia en el lugar equivocado.
  it('la fecha de un documento cargado se corrige sin salir del módulo', async () => {
    vi.mocked(complianceApi.patch).mockResolvedValue({} as never)
    montar([fila({
      id: 'p1', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA', tiene_archivo: true,
      document_name: 'Licencia de Conducir', expiration_date: '2026-09-04',
      expiration_policy: 'REQUIRED',
    })])

    fireEvent.click(await screen.findByRole('button', { name: /editar vencimiento/i }))
    const campo = screen.getByLabelText('Fecha de vencimiento')
    fireEvent.change(campo, { target: { value: '2027-03-31' } })
    fireEvent.blur(campo)

    await waitFor(() => expect(complianceApi.patch).toHaveBeenCalledWith(
      'p1', { expiration_date: '2027-03-31' },
    ))
  })

  // El unico gate que puede mentir en silencio: un viewer que ve un control de
  // edicion y recibe un 403 al usarlo.
  // El caso que motivó la correccion: una empresa SIN un solo documento
  // cargado —382 registros y cero archivos, medido en produccion— tiene que
  // poder declarar vencimientos igual. Condicionarlo a `tiene_archivo` dejaba
  // la pantalla sin un solo control en esas empresas, que son la mayoria.
  it('un requisito sin archivo también deja declarar su vencimiento', async () => {
    montar([fila({
      id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez',
      document_name: 'Licencia de Conducir', urgencia: 'FALTA',
      tiene_archivo: false, expiration_date: null, expiration_policy: 'REQUIRED',
    })])

    expect(await screen.findByRole('button', { name: /agregar vencimiento/i })).toBeInTheDocument()
  })

  // Y el que NO vence no lo ofrece: el catalogo manda.
  it('un requisito con política NONE no ofrece vencimiento', async () => {
    montar([fila({
      id: 'p1', document_name: 'Padrón', urgencia: 'FALTA',
      tiene_archivo: false, expiration_date: null, expiration_policy: 'NONE',
    })])

    expect(await screen.findByText('Padrón')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /vencimiento/i })).not.toBeInTheDocument()
  })

  it('un viewer ve la fecha pero no puede corregirla', async () => {
    vi.mocked(useCanEdit).mockReturnValue(false)
    montar([fila({
      id: 'p1', status: 'APPROVED_MANUAL', urgencia: 'AL_DIA', tiene_archivo: true,
      document_name: 'Licencia de Conducir',
      expiration_date: '2026-09-04', expiration_policy: 'REQUIRED',
    })])

    // Esperar a que la FILA exista, no sólo la cabecera: afirmar la ausencia
    // del botón antes de que el renglón se dibuje pasa siempre, con gate y
    // sin gate. Se comprobó mutando —`canEdit={true}`— y el test sobrevivía.
    expect(await screen.findByText('Licencia de Conducir')).toBeInTheDocument()
    expect(screen.getByText(/2026|04-09/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editar vencimiento/i })).not.toBeInTheDocument()
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

  // Hallazgo 5 de la revision final: el efecto que resetea enviando/error
  // depende sólo de `abierto`, y el padre deja el diálogo montado siempre.
  // Sin trampa de foco, sólo el ⋮ del sujeto EN CURSO queda deshabilitado —
  // el de cualquier otro sigue disponible— así que se puede disparar la baja
  // de un segundo sujeto sin haber cerrado la del primero, y el diálogo
  // cambia de nombre sin limpiar el error que traía.
  function accionesDe(nombreSujeto: RegExp) {
    const cabecera = screen.getByRole('button', { name: nombreSujeto })
    return within(cabecera.closest('div')!).getByRole('button', { name: /acciones/i })
  }

  it('un error mostrado para un sujeto no aparece al abrir el diálogo del siguiente', async () => {
    vi.mocked(carriersApi.unassignDriver).mockRejectedValueOnce(new Error('sesión vencida'))
    montar([
      fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Ana Torres' }),
      fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd2', subject_name: 'Beto Rojas', requirement_id: 'r2' }),
    ])
    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))

    // La baja de Ana falla y el diálogo queda abierto mostrando el error.
    fireEvent.click(accionesDe(/Ana Torres/))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(/sesión vencida/i)

    // Sin cerrarlo, se dispara la baja de Beto: su ⋮ nunca estuvo
    // deshabilitado — sólo lo estaba el de Ana.
    fireEvent.click(accionesDe(/Beto Rojas/))
    fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent(/Beto Rojas/)
    expect(dialogo).not.toHaveTextContent(/sesión vencida/i)
  })

  // ── La empresa se da de baja sin salir del módulo ──────────────────────
  //
  // Dar de baja a un conductor DE la empresa y dar de baja a la empresa DEL
  // sistema comparten el nombre y no son lo mismo: distinto endpoint y
  // distinto permiso. Estos tests fijan esa frontera.

  it('un admin puede dar de baja a la empresa desde la ficha', async () => {
    vi.mocked(useCanAdmin).mockReturnValue(true)
    vi.mocked(carriersApi.patch).mockResolvedValue(CARRIER)
    montar([fila()])

    fireEvent.click(await screen.findByRole('button', { name: /^Dar de baja$/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Confirmar baja/ }))

    await waitFor(() => expect(carriersApi.patch).toHaveBeenCalledWith(
      'c1', { operational_status: 'INACTIVE' },
    ))
  })

  it('la baja refresca la certificación, no sólo la cabecera', async () => {
    // El defecto: invalidar sólo `carrier-detail` dejaba la cabecera diciendo
    // "Inactivo" y el cuerpo mostrando 457 requisitos durante los 60 s de
    // `staleTime` (y `refetchOnWindowFocus` está apagado, así que volver a la
    // pestaña tampoco lo arreglaba). Las raíces de Certificación viven en
    // `RAICES_DE_CERTIFICACION` justamente porque esta lista "ya perdió una
    // raíz dos veces".
    vi.mocked(useCanAdmin).mockReturnValue(true)
    vi.mocked(carriersApi.patch).mockResolvedValue(CARRIER)
    montar([fila()])

    fireEvent.click(await screen.findByRole('button', { name: /^Dar de baja$/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Confirmar baja/ }))

    // Se afirma que el resumen se vuelve a pedir. Contar llamadas es lo que
    // distingue "invalidó" de "no invalidó": el mock resuelve igual en los dos
    // casos, así que mirar lo que se ve en pantalla no lo detecta.
    await waitFor(() => expect(
      vi.mocked(complianceApi.summary).mock.calls.length,
    ).toBeGreaterThan(1))
  })

  it('un editor no ve la baja de la empresa: sigue siendo de admin', async () => {
    vi.mocked(useCanEdit).mockReturnValue(true)
    vi.mocked(useCanAdmin).mockReturnValue(false)
    montar([fila()])

    // Algo del editor tiene que aparecer primero, o el test no distingue
    // "todavía no cargó" de "no le corresponde".
    expect(await screen.findByRole('heading', { name: 'Transportes Demo Spa' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Dar de baja$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reactivar$/ })).not.toBeInTheDocument()
  })

  it('una empresa dada de baja ofrece reactivarla, no darla de baja otra vez', async () => {
    vi.mocked(useCanAdmin).mockReturnValue(true)
    vi.mocked(carriersApi.patch).mockResolvedValue(CARRIER)
    montar([fila()], { ...CARRIER, operational_status: 'INACTIVE' })

    fireEvent.click(await screen.findByRole('button', { name: /^Reactivar$/ }))

    // Reactivar no pregunta: no destruye nada y es el camino de vuelta del
    // error. Por eso va directo al PATCH, sin diálogo.
    await waitFor(() => expect(carriersApi.patch).toHaveBeenCalledWith(
      'c1', { operational_status: 'ACTIVE' },
    ))
    expect(screen.queryByRole('button', { name: /^Dar de baja$/ })).not.toBeInTheDocument()
  })

  // ── Qué es el vehículo, no sólo su patente ────────────────────────────

  it('un vehículo muestra su chasis y su carrocería, con el color del catálogo', async () => {
    montar([fila({
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'ABCD12', category: 'EQUIPO',
      asset_type: 'RAMPLA',
      fleet_service_type_label: 'Furgón Seco',
      fleet_service_type_bg_color: '#eeeeee',
      fleet_service_type_text_color: '#111111',
    })])

    expect(await screen.findByText('Rampla')).toBeInTheDocument()
    const carroceria = screen.getByText('Furgón Seco')
    expect(carroceria).toHaveStyle({ backgroundColor: '#eeeeee', color: '#111111' })

    // La palabra genérica que estas dos insignias vinieron a reemplazar.
    expect(screen.queryByText(/Vehículo ·/)).not.toBeInTheDocument()
  })

  it('un tractocamión muestra sólo su chasis: la carrocería no le aplica', async () => {
    montar([fila({
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'ABCD12', category: 'EQUIPO',
      asset_type: 'TRACTOCAMION',
      fleet_service_type_label: null,
    })])

    expect(await screen.findByText('Tracto')).toBeInTheDocument()
    // Sin insignia de carrocería y sin relleno: los 87 tractocamiones reales
    // tienen `fleet_service_type_id` en null y eso no es un dato faltante.
    expect(screen.queryByText('Rampla')).not.toBeInTheDocument()
  })
})
