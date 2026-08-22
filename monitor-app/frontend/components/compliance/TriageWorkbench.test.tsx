import { render, screen, fireEvent, waitFor, createEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageWorkbench } from './TriageWorkbench'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn(), previewUrl: vi.fn(), upload: vi.fn(),
    remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'

const row = (id: string, carrier: string) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  created_at: '2026-08-14T10:00:00Z',
  carrier_id: carrier.toLowerCase(), carrier_name: carrier,
  confidence: null, suggested_requirement_name: null, candidate_count: 0,
  mismo_casillero: 1, mismo_contenido: 1, casillero_ocupado: false,
})

function setup(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageWorkbench {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listQueue).mockReset().mockResolvedValue({
    total: 2, rows: [row('i1', 'ACME'), row('i2', 'NORTE')],
  })
  vi.mocked(documentIngestApi.previewUrl).mockReset()
    .mockResolvedValue({ preview_url: 'https://x/1' })
  vi.mocked(documentIngestApi.upload).mockReset().mockResolvedValue({ items: [], errors: [] } as never)
  vi.mocked(documentIngestApi.remove).mockReset()
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({
    total: 1,
    rows: [{
      id: 'r1', carrier_id: 'acme', carrier_name: 'ACME', carrier_tax_id: '1-9',
      carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
      requirement_code: 'PADRON', document_name: 'Padrón',
      status: 'MISSING', expiration_date: null,
    }],
  } as never)
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue({ data: [] } as never)
})

describe('TriageWorkbench', () => {
  it('sin empresa pide la cola completa', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(documentIngestApi.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: undefined }),
    )
  })

  it('con empresa acota la cola a esa empresa', async () => {
    setup({ carrierId: 'acme', carrierName: 'ACME' })
    await screen.findByText('i1.png')
    expect(documentIngestApi.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: 'acme' }),
    )
  })

  it('no abre ningun modal', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('la barra contextual aparece al seleccionar', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    expect(await screen.findByText(/^1 seleccionado$/i)).toBeInTheDocument()
  })

  it('marcar un archivo de otra empresa reemplaza la seleccion', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /i2\.png/ }))

    // El formulario aplica un requisito de UNA entidad: mezclar empresas
    // dejaria la eleccion de sujeto sin sentido.
    expect(await screen.findByText(/^1 seleccionado$/i)).toBeInTheDocument()
  })

  // El bloqueo real para meter los 2.000 documentos: sin empresa no habia
  // forma de soltar archivos.
  it('sin empresa igual se pueden cargar archivos', async () => {
    setup()
    expect(await screen.findByTestId('triage-dropzone')).toBeInTheDocument()
  })

  // La bandeja de ACME tiene archivos, así que la zona está encogida: la
  // etiqueta accesible tiene que decir lo mismo que el texto visible, no
  // "Arrastra aquí" a un recuadro que ya no existe.
  it('desde la ficha si se puede subir', async () => {
    setup({ carrierId: 'acme', carrierName: 'ACME' })
    expect(await screen.findByLabelText(/agrega los documentos de ACME a la bandeja/i))
      .toBeInTheDocument()
  })

  it('vacía, la etiqueta accesible sí dice "arrastra aquí"', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup({ carrierId: 'acme', carrierName: 'ACME' })
    expect(await screen.findByLabelText(/arrastra aquí los documentos de ACME/i))
      .toBeInTheDocument()
  })

  it('pide la url firmada solo del archivo enfocado', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByText('i1.png'))
    await waitFor(() => {
      expect(documentIngestApi.previewUrl).toHaveBeenCalledWith('i1')
    })
    expect(documentIngestApi.previewUrl).toHaveBeenCalledTimes(1)
  })

  it('deriva los sujetos de la empresa de la seleccion', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    await waitFor(() => {
      expect(complianceApi.listPending).toHaveBeenCalledWith(
        expect.objectContaining({ carrierId: 'acme' }),
      )
    })
  })

  // Acotar el universo a una empresa es lo que hace que el clasificador
  // acierte: ~2 conductores y ~3 vehiculos en vez de 87 y 124.
  it('la Bandeja global deja acotar el lote a una empresa antes de subir', async () => {
    vi.mocked(carriersApi.list).mockResolvedValue({
      data: [{ id: 'c1', business_name: 'Transportes Charlotte Spa', tax_id: '76.111.111-1' }],
    } as never)
    setup()

    fireEvent.change(await screen.findByPlaceholderText(/elegir empresa/i), { target: { value: 'char' } })
    fireEvent.click(await screen.findByText('Transportes Charlotte Spa'))

    // El dropzone no expone un testid para su input: se selecciona por su
    // aria-label, y soltar se prueba con `fireEvent.drop` sobre
    // `getByTestId('triage-dropzone')` — el patrón que TriageDropzone.test.tsx
    // ya usa.
    fireEvent.drop(screen.getByTestId('triage-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
    })

    // El cliente ya sabe rutear: con carrierId va a /{id}/files, que es lo que
    // acota el universo del clasificador.
    await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledWith(
      'c1', expect.any(Array),
    ))
  })

  it('sin elegir empresa sigue pudiendo subir a la bandeja global', async () => {
    setup()
    fireEvent.drop(screen.getByTestId('triage-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledWith(
      undefined, expect.any(Array),
    ))
  })

  // Esconder el selector escondio un estado que seguia actuando: con la
  // seleccion activa `empresaDelLote` sigue vivo y la zona de arrastre seguia
  // montada, asi que una segunda tanda se subia atribuida a una empresa que
  // ya no se ve en pantalla. Subir y mover son dos gestos distintos.
  it('con seleccion activa, la zona de carga entera da un paso atras', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.getByTestId('triage-dropzone')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))

    expect(screen.queryByTestId('triage-dropzone')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/elegir empresa/i)).not.toBeInTheDocument()
  })

  // El otro camino a la misma zona: soltar FUERA del recuadro lo encamina a la
  // bandeja igual. Esconder el recuadro sin cerrar este camino dejaria el
  // defecto entero.
  it('con seleccion activa, soltar en cualquier parte no sube en silencio', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))

    fireEvent.drop(window, {
      dataTransfer: { files: [new File(['x'], 'b.pdf', { type: 'application/pdf' })] },
    })

    expect(documentIngestApi.upload).not.toHaveBeenCalled()
    expect(await screen.findByTestId('triage-notice')).toHaveTextContent(/seleccionados/i)
  })

  // Dos cajas que dicen "Buscar empresa" y significan cosas distintas —"¿de
  // quién es lo que voy a subir?" vs. "¿a qué empresa muevo lo seleccionado?"—
  // nunca son relevantes a la vez: seleccionar archivos es entrar en un modo,
  // y la barra contextual es la dueña de ese modo.
  it('al elegir empresa el buscador se reemplaza por su nombre, con forma de quitarla', async () => {
    // El modelo cambio: antes el buscador se escondia y volvia segun la
    // seleccion, y el indicador vivia aparte. Ahora es UN control que cambia de
    // forma -- buscador cuando no hay empresa, nombre + boton de quitar cuando
    // si. Ver `useEmpresaDeTrabajo`.
    vi.mocked(carriersApi.list).mockResolvedValue({
      data: [{ id: 'c1', business_name: 'Transportes Charlotte Spa', tax_id: '76.111.111-1' }],
    } as never)
    setup()
    await screen.findByText('i1.png')

    fireEvent.change(await screen.findByPlaceholderText(/elegir empresa/i), { target: { value: 'char' } })
    fireEvent.click(await screen.findByText('Transportes Charlotte Spa'))

    // El buscador se fue; el nombre quedo, con su inverso.
    expect(screen.queryByPlaceholderText(/elegir empresa/i)).not.toBeInTheDocument()
    expect(screen.getByText('Transportes Charlotte Spa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Quitar Transportes Charlotte Spa/ })).toBeInTheDocument()

    // Y la eleccion gobierna la subida sin una precedencia propia.
    fireEvent.drop(screen.getByTestId('triage-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'b.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledWith(
      'c1', expect.any(Array),
    ))
  })

  it('quitar la empresa devuelve el buscador, y no la resucita', async () => {
    // El inverso que no existia: una vez elegida, no habia forma de sacarla sin
    // recargar la pagina.
    vi.mocked(carriersApi.list).mockResolvedValue({
      data: [{ id: 'c1', business_name: 'Transportes Charlotte Spa', tax_id: '76.111.111-1' }],
    } as never)
    setup()
    await screen.findByText('i1.png')

    fireEvent.change(await screen.findByPlaceholderText(/elegir empresa/i), { target: { value: 'char' } })
    fireEvent.click(await screen.findByText('Transportes Charlotte Spa'))
    fireEvent.click(screen.getByRole('button', { name: /Quitar Transportes Charlotte Spa/ }))

    expect(await screen.findByPlaceholderText(/elegir empresa/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
  })

  // ── Paso 2 del funnel: esto es una COLA, no un formulario ──────────────

  /** La fila de la LISTA, no el nombre que el panel derecho repite. */
  const filaDe = (nombre: string) =>
    screen.getByRole('checkbox', { name: new RegExp(`Seleccionar ${nombre}`) }).closest('tr')!

  it('despues de clasificar, el foco salta solo al siguiente archivo', async () => {
    // Clasificar 40 documentos era 40 veces "clasificar, buscar el siguiente
    // con el mouse, hacer clic". El foco se marca con `aria-current`.
    vi.mocked(documentIngestApi.classifyBatch).mockResolvedValue({ applied: ['i1'], errors: [] })
    // El mock compartido no trae `requirement_id`, y sin el la Slot queda
    // incompleta y "Clasificar" nunca se habilita.
    vi.mocked(complianceApi.listPending).mockResolvedValue({
      total: 1,
      rows: [{
        id: 'r1', carrier_id: 'acme', carrier_name: 'ACME', carrier_tax_id: '1-9',
        carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
        entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
        requirement_id: 'req-1', requirement_code: 'PADRON', document_name: 'Padrón',
        status: 'MISSING', expiration_date: null,
      }],
    } as never)
    setup()
    await screen.findByText('i1.png')

    fireEvent.click(filaDe('i1.png'))
    await waitFor(() => expect(filaDe('i1.png')).toHaveAttribute('aria-current', 'true'))

    // Clasificar el enfocado: se marca y se usa el camino real del panel.
    // Elegir el casillero -- el gesto del paso 2 -- y aplicar.
    fireEvent.click(await screen.findByRole('button', { name: /Padrón/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Clasificar$/ }))

    // El foco quedo en el que ocupa su lugar, no en ninguno ni en el mismo.
    await waitFor(() => expect(filaDe('i2.png')).toHaveAttribute('aria-current', 'true'))
    expect(filaDe('i1.png')).not.toHaveAttribute('aria-current')
  })

  // Es la SEGUNDA vez que esta pantalla pierde esta invariante. La primera fue
  // esconder el selector con la seleccion activa; la segunda, esconderlo
  // mientras el panel derecho pregunta la empresa de un archivo -- y en las dos
  // se fue con el la linea que DICE cual es la empresa activa. La zona de
  // arrastre sigue aceptando archivos, asi que el estado gobierna a que empresa
  // se atribuyen sin estar en pantalla.
  //
  // Lo que colisiona son las dos CAJAS DE BUSQUEDA. El indicador no es una caja.
  it('un HECHO gana sobre una eleccion: marcar un archivo de ACME manda sobre lo elegido', async () => {
    // La precedencia del modelo, vista en la pantalla. No es un capricho: una
    // eleccion que contradice al dato no se puede aplicar -- ese archivo ES de
    // ACME, y decir que el trabajo es de Charlotte seria mentir.
    vi.mocked(carriersApi.list).mockResolvedValue({
      data: [{ id: 'c1', business_name: 'Transportes Charlotte Spa', tax_id: '76.111.111-1' }],
    } as never)
    setup()
    await screen.findByText('i1.png')

    fireEvent.change(await screen.findByPlaceholderText(/elegir empresa/i), { target: { value: 'char' } })
    fireEvent.click(await screen.findByText('Transportes Charlotte Spa'))

    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))

    // La empresa se sigue DICIENDO -- la zona de arrastre acepta archivos y
    // atribuirlos a una empresa fuera de pantalla es el defecto que este
    // archivo ya tuvo DOS veces -- pero dice la del archivo, no la elegida.
    expect(await screen.findByText(/Los archivos marcados ya son de ella/)).toBeInTheDocument()
    // Y no se ofrece quitarla: no es una eleccion, es un hecho del dato.
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
  })
})

// El caso de uso que justifica toda la bandeja: soltar la carpeta de 120
// documentos. El backend corta en 50 por request y devuelve 422; mandarlos
// todos juntos no subía NADA y la pantalla no decía una palabra.
describe('TriageWorkbench — soltar más de 50 archivos', () => {
  const archivos = (n: number) =>
    Array.from({ length: n }, (_, i) => new File(['x'], `d${i}.pdf`, { type: 'application/pdf' }))

  function subida(files: File[]) {
    return {
      batch_id: 'b1',
      items: files.map((f, i) => ({
        id: `n${i}`, file_name: f.name, mime_type: f.type, size_bytes: 1,
        storage_path: `s/${f.name}`, match_status: 'UNMATCHED' as const,
        preview_url: null,
      })),
      errors: [] as { file_name: string; error: string }[],
    }
  }

  async function zona() {
    return screen.findByLabelText(/agrega los documentos a la bandeja/i)
  }

  it('parte la tanda en lotes de 50 y los encadena de a uno', async () => {
    let enVuelo = 0
    let maxEnVuelo = 0
    vi.mocked(documentIngestApi.upload).mockImplementation(async (_c, files) => {
      enVuelo += 1
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
      await new Promise(r => setTimeout(r, 0))
      enVuelo -= 1
      return subida(files)
    })
    setup()

    fireEvent.change(await zona(), { target: { files: archivos(120) } })

    await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledTimes(3))
    expect(vi.mocked(documentIngestApi.upload).mock.calls.map(c => c[1].length))
      .toEqual([50, 50, 20])
    // Son subidas a Storage: encadenadas, nunca tres tandas simultáneas.
    expect(maxEnVuelo).toBe(1)
  })

  it('con 50 o menos sigue siendo un solo request', async () => {
    vi.mocked(documentIngestApi.upload).mockImplementation(async (_c, files) => subida(files))
    setup()

    fireEvent.change(await zona(), { target: { files: archivos(50) } })

    await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledTimes(1))
  })

  it('acumula los errores de cada lote', async () => {
    vi.mocked(documentIngestApi.upload).mockImplementation(async (_c, files) => ({
      ...subida(files),
      errors: [{ file_name: `${files[0].name}`, error: 'Tipo no permitido' }],
    }))
    setup()

    fireEvent.change(await zona(), { target: { files: archivos(120) } })

    // Uno por lote: los tres tienen que sobrevivir, no sólo el último.
    await waitFor(() => expect(screen.getAllByText(/tipo no permitido/i)).toHaveLength(3))
  })

  it('si la subida falla, lo dice en vez de volver al estado vacío', async () => {
    vi.mocked(documentIngestApi.upload)
      .mockRejectedValue(new Error('Máximo 50 archivos por carga'))
    setup()

    fireEvent.change(await zona(), { target: { files: archivos(120) } })

    expect(await screen.findByText(/no se pudieron subir todos los archivos/i))
      .toBeInTheDocument()
    expect(screen.getByText(/máximo 50 archivos por carga/i)).toBeInTheDocument()
  })

  // Soltar fuera del recuadro hacía que el navegador NAVEGARA al archivo y
  // sacara a la persona de la aplicación.
  it('soltar en cualquier parte de la pantalla no navega al archivo', async () => {
    vi.mocked(documentIngestApi.upload).mockImplementation(async (_c, files) => subida(files))
    setup()
    await screen.findByText('i1.png')

    const evento = createEvent.drop(window, { dataTransfer: { files: archivos(2) } })
    fireEvent(window, evento)

    expect(evento.defaultPrevented).toBe(true)
    await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledTimes(1))
  })

  // EL CRUCE, que es donde vivía la falla: la zona de carga atiende el drop y
  // el evento sigue burbujeando hasta el listener de `window`. Los dos tests
  // que ya existían cubrían un lado cada uno —TriageDropzone.test.tsx suelta
  // sobre la zona sin listener global, y el de arriba suelta sobre `window`
  // sin pasar por la zona—, así que ninguno veía que corrieran los dos
  // caminos y cada archivo entrara DUPLICADO a la bandeja.
  it('soltar SOBRE la zona de carga sube los archivos una sola vez', async () => {
    vi.mocked(documentIngestApi.upload).mockImplementation(async (_c, files) => subida(files))
    setup()
    await screen.findByText('i1.png')

    fireEvent.drop(screen.getByTestId('triage-dropzone'), {
      dataTransfer: { files: archivos(2) },
    })

    await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalled())
    // Un tick más: la segunda subida saldría en el mismo dispatch, así que si
    // waitFor se conformara con la primera igual la veríamos acá.
    await new Promise(r => setTimeout(r, 0))
    expect(documentIngestApi.upload).toHaveBeenCalledTimes(1)
    expect(vi.mocked(documentIngestApi.upload).mock.calls[0][1]).toHaveLength(2)
  })
})

describe('TriageWorkbench — descartar en lote', () => {
  beforeEach(() => {
    // Dos archivos de la MISMA empresa: la selección no puede cruzarlas.
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({
      total: 2, rows: [row('i1', 'ACME'), row('i2', 'ACME')],
    })
  })

  async function descartarLosDos() {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /i2\.png/ }))
    fireEvent.click(await screen.findByRole('button', { name: /descartar los 2/i }))
    fireEvent.click(await screen.findByRole('button', { name: /sí, descartar 2/i }))
  }

  // Con `Promise.all` una baja que falla rechazaba el conjunto: no se
  // invalidaba nada, no se mostraba nada, y los ya borrados seguían en
  // pantalla. Con la barra ofreciendo "Descartar los 200" eso es grave.
  it('una baja que falla no se lleva puesto al resto', async () => {
    vi.mocked(documentIngestApi.remove).mockImplementation(id =>
      id === 'i2' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined as never),
    )

    await descartarLosDos()

    expect(await screen.findByText(/1 de 2 descartados · 1 no se pudo descartar/i))
      .toBeInTheDocument()
    expect(documentIngestApi.remove).toHaveBeenCalledTimes(2)
  })

  it('sin fallas dice cuántos se descartaron', async () => {
    vi.mocked(documentIngestApi.remove).mockResolvedValue(undefined as never)

    await descartarLosDos()

    expect(await screen.findByText(/^2 descartados$/i)).toBeInTheDocument()
  })
})
