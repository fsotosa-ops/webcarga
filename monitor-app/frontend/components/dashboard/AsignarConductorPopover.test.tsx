import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AsignarConductorPopover } from './AsignarConductorPopover'
import { ApiError } from '@/lib/api/client'

// El alta ahora pregunta por la empresa, y ese buscador usa react-query.
// `list` devuelve { data }, no { rows }: con la clave equivocada el picker no
// lista nada y un test de selección pasaría a verde por la razón incorrecta.
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [
    { id: 'c1', business_name: 'Transportes Sur', tax_id: '76000000-0' },
  ] }) },
}))

function render_(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const CONTENIDO = {
  driver_id: 'd1', full_name: 'Suarez Lopez Efrain Eduardo', tax_id: '16.428.339-1',
  carrier_name: 'Transportes Sur', contiene: true, similitud: 0.88,
}
const PARECIDO = {
  driver_id: 'd2', full_name: 'Gomez Sifontes Carlos Eduardo', tax_id: '13.905.774-K',
  carrier_name: 'Transportes C&M', contiene: false, similitud: 0.22,
}

const base = {
  nombreTms: 'SUAREZ LOPEZ EFRAIN EDUARDO',
  viajesDeLaPersona: 13,
  onAsignar: vi.fn(),
  onDarDeAlta: vi.fn(),
  onCancelar: vi.fn(),
}

describe('AsignarConductorPopover', () => {
  it('siempre muestra el nombre crudo que reporto el TMS', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[CONTENIDO]} />)
    expect(screen.getByText('SUAREZ LOPEZ EFRAIN EDUARDO')).toBeInTheDocument()
  })

  // El control y su consecuencia dicen lo mismo: no hay que acordarse de lo
  // que se marco dos renglones mas arriba.
  it('el boton dice a cuantos viajes se aplica, y cambia con la casilla', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[CONTENIDO]} />)
    fireEvent.click(screen.getByRole('button', { name: /Suarez Lopez Efrain/i }))

    expect(screen.getByRole('button', { name: /Asignar a 13 viajes/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /Asignar solo a este viaje/i })).toBeInTheDocument()
  })

  it('no se puede confirmar mientras cargan los candidatos', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[]} cargando />)
    expect(screen.getByRole('button', { name: /Asignar/i })).toBeDisabled()
  })

  // Medido: de las 28 personas sin identificar, 19 no tienen ningun candidato
  // contenido. Ofrecer al "mas parecido" ahi es ofrecer a otra persona: para
  // el viaje 2032999 el mejor da 0,22 y no es quien.
  it('sin ningun candidato contenido, el camino principal es dar de alta', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[PARECIDO]} />)

    const alta = screen.getByRole('button', { name: /dar de alta/i })
    expect(alta).toBeInTheDocument()
    // el parecido no se ofrece como opcion principal, queda detras de un gesto
    expect(screen.queryByRole('button', { name: /Gomez Sifontes/i })).toBeNull()
    expect(screen.getByText(/No encontramos a esta persona/i)).toBeInTheDocument()
  })

  it('los parecidos se pueden ver, pero hay que pedirlos', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[PARECIDO]} />)
    fireEvent.click(screen.getByRole('button', { name: /ver parecidos/i }))
    expect(screen.getByRole('button', { name: /Gomez Sifontes/i })).toBeInTheDocument()
  })

  // Decision del usuario (2026-08-18): el alta pide RUT. tax_id sigue siendo
  // obligatorio porque es la clave con la que el resolvedor identifica por
  // RUT — un conductor sin RUT nunca se identificaria solo.
  it('dar de alta pide el RUT, y no deja confirmar sin el', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))

    expect(screen.getByLabelText(/RUT/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Crear y asignar/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/RUT/i), { target: { value: '16.428.339-1' } })
    expect(screen.getByRole('button', { name: /Crear y asignar/i })).toBeEnabled()
  })

  it('el alta propone el nombre del TMS, ya legible', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    expect(screen.getByLabelText(/Nombre/i)).toHaveValue('Suarez Lopez Efrain Eduardo')
  })

  // ── Lo que fallaba el 25/08 ──────────────────────────────────────────────
  // El popover llamaba a la API con una promesa flotante. Si rechazaba, la
  // excepcion moria sin dueno: el popover no se cerraba, no aparecia ningun
  // mensaje, y en pantalla "no pasaba nada". Sobre 3 altas que intento Pablo,
  // 2 eran de gente que ya estaba en la base.
  async function abrirAltaYConfirmar(props: Record<string, unknown>) {
    render_(<AsignarConductorPopover {...base} {...props} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    fireEvent.change(screen.getByLabelText(/RUT/i), { target: { value: '16.428.339-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear y asignar/i }))
  }

  it('si el alta falla, lo dice en pantalla', async () => {
    const onDarDeAlta = vi.fn().mockRejectedValue(new ApiError('La red se cayo', 500, null))
    await abrirAltaYConfirmar({ onDarDeAlta })

    expect(await screen.findByText('La red se cayo')).toBeInTheDocument()
  })

  it('un error que no es de la API igual dice algo util', async () => {
    const onDarDeAlta = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await abrirAltaYConfirmar({ onDarDeAlta })

    expect(await screen.findByText(/No se pudo guardar/i)).toBeInTheDocument()
  })

  // Un 409 no puede ser un callejon sin salida: la persona que ya existe es
  // justo la que se queria asignar.
  it('si el RUT ya existe, ofrece asignarle a esa persona', async () => {
    const onDarDeAlta = vi.fn().mockRejectedValue(new ApiError(
      'Carlos Perez Santiago ya esta registrado con el RUT 16428339-1', 409,
      {
        code: 'CONDUCTOR_YA_EXISTE', driver_id: 'd-existente',
        full_name: 'Carlos Perez Santiago', tax_id: '16428339-1',
        message: 'Carlos Perez Santiago ya esta registrado con el RUT 16428339-1',
      },
    ))
    const onAsignar = vi.fn().mockResolvedValue(undefined)
    await abrirAltaYConfirmar({ onDarDeAlta, onAsignar })

    const salida = await screen.findByRole('button', { name: /Asignar a Carlos Perez Santiago/i })
    fireEvent.click(salida)

    await waitFor(() => expect(onAsignar).toHaveBeenCalledWith('d-existente', true))
  })

  it('mientras guarda, el boton se apaga y lo dice', async () => {
    let liberar: () => void = () => {}
    const onDarDeAlta = vi.fn(() => new Promise<void>(r => { liberar = r }))
    await abrirAltaYConfirmar({ onDarDeAlta })

    const boton = await screen.findByRole('button', { name: /Creando/i })
    expect(boton).toBeDisabled()
    // Y no se puede disparar una segunda alta encima de la primera.
    fireEvent.click(boton)
    expect(onDarDeAlta).toHaveBeenCalledTimes(1)

    liberar()
  })

  // Un conductor sin empresa no aparece en el cierre del dia. El alta desde
  // aca los creaba asi SIEMPRE: al 27/08, 8 conductores con 278 viajes
  // invisibles para la cuadratura, y 4 los genero la propia sesion de revision.
  it('el alta manda la empresa elegida', async () => {
    const onDarDeAlta = vi.fn().mockResolvedValue(undefined)
    render_(<AsignarConductorPopover {...base} onDarDeAlta={onDarDeAlta} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    fireEvent.change(screen.getByLabelText(/RUT/i), { target: { value: '16.428.339-1' } })

    fireEvent.change(screen.getByPlaceholderText(/Buscar empresa/i), { target: { value: 'Transportes' } })
    fireEvent.click(await screen.findByRole('button', { name: /Transportes Sur/i }))

    fireEvent.click(screen.getByRole('button', { name: /Crear y asignar/i }))

    await waitFor(() => expect(onDarDeAlta).toHaveBeenCalledWith(
      'Suarez Lopez Efrain Eduardo', '16.428.339-1', true, 'c1',
    ))
  })

  it('sin empresa se puede crear igual, pero avisa lo que cuesta', async () => {
    const onDarDeAlta = vi.fn().mockResolvedValue(undefined)
    await abrirAltaYConfirmar({ onDarDeAlta })

    await waitFor(() => expect(onDarDeAlta).toHaveBeenCalledWith(
      'Suarez Lopez Efrain Eduardo', '16.428.339-1', true, null,
    ))
  })

  it('avisa que sin empresa no va a aparecer en el cierre', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    expect(screen.getByText(/no va a aparecer en el cierre/i)).toBeInTheDocument()
  })
})
