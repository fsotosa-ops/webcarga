import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsignarConductorPopover } from './AsignarConductorPopover'
import { ApiError } from '@/lib/api/client'

// El alta ahora pregunta por la empresa, y ese buscador usa react-query.
// `list` devuelve { data }, no { rows }: con la clave equivocada el picker no
// lista nada y un test de selección pasaría a verde por la razón incorrecta.
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: {
    list: vi.fn().mockResolvedValue({ data: [
      { id: 'c1', business_name: 'Transportes Sur', tax_id: '76000000-0' },
    ] }),
    assignDriver: vi.fn().mockResolvedValue(undefined),
  },
}))
// El alta es la común (AltaDeFlota, D5): crea con la API y pide el origen habitual.
vi.mock('@/lib/api/drivers', () => ({ driversApi: { create: vi.fn() } }))
vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn().mockResolvedValue({ data: [{ id: 'cd1', name: 'CD Quilicura' }] }) },
}))

import { driversApi } from '@/lib/api/drivers'
import { carriersApi } from '@/lib/api/carriers'

beforeEach(() => {
  vi.mocked(driversApi.create).mockReset().mockResolvedValue({ id: 'd-nuevo', full_name: 'Suarez Lopez Efrain Eduardo' } as never)
  vi.mocked(carriersApi.assignDriver).mockClear()
})

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
  puedeDarDeAlta: true,
  onCancelar: vi.fn(),
}

describe('AsignarConductorPopover', () => {
  it('siempre muestra el nombre crudo que reporto el TMS', () => {
    render_(<AsignarConductorPopover {...base} candidatos={[CONTENIDO]} />)
    expect(screen.getByText('SUAREZ LOPEZ EFRAIN EDUARDO')).toBeInTheDocument()
  })

  // El control y su consecuencia dicen lo mismo: no hay que acordarse de lo
  // que se marco dos renglones mas arriba.
  it('con un solo viaje no ofrece la casilla y dice "Asignar a este viaje", no "a 1 viajes"', () => {
    render_(<AsignarConductorPopover {...base} viajesDeLaPersona={1} candidatos={[CONTENIDO]} />)
    fireEvent.click(screen.getByRole('button', { name: /Suarez Lopez Efrain/i }))
    expect(screen.getByRole('button', { name: 'Asignar a este viaje' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/1 viajes/)).not.toBeInTheDocument()
  })

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
  it('sin directory.edit no ofrece el alta', () => {
    render_(<AsignarConductorPopover {...base} puedeDarDeAlta={false} candidatos={[]} />)
    expect(screen.getByText(/No encontramos a esta persona/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dar de alta/i })).not.toBeInTheDocument()
  })

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
    expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('Suarez Lopez Efrain Eduardo')
  })

  // Era lo único que esta alta no tenía frente a la común (HU-28).
  it('el alta ofrece el origen habitual', async () => {
    render_(<AsignarConductorPopover {...base} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    expect(await screen.findByRole('option', { name: 'CD Quilicura' })).toBeInTheDocument()
  })

  // ── Lo que fallaba el 25/08 ──────────────────────────────────────────────
  // El popover llamaba a la API con una promesa flotante. Si rechazaba, la
  // excepcion moria sin dueno: el popover no se cerraba, no aparecia ningun
  // mensaje, y en pantalla "no pasaba nada". Sobre 3 altas que intento Pablo,
  // 2 eran de gente que ya estaba en la base.
  function abrirAltaYConfirmar(props: Record<string, unknown> = {}) {
    render_(<AsignarConductorPopover {...base} {...props} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    fireEvent.change(screen.getByLabelText(/RUT/i), { target: { value: '16.428.339-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear y asignar/i }))
  }

  it('si el alta falla, lo dice en pantalla', async () => {
    vi.mocked(driversApi.create).mockRejectedValue(new ApiError('La red se cayo', 500, null))
    abrirAltaYConfirmar()
    expect(await screen.findByText('La red se cayo')).toBeInTheDocument()
  })

  // Un 409 no puede ser un callejon sin salida: la persona que ya existe es
  // justo la que se queria asignar.
  it('si el RUT ya existe, ofrece asignarle a esa persona', async () => {
    vi.mocked(driversApi.create).mockRejectedValue(new ApiError(
      'Carlos Perez Santiago ya esta registrado con el RUT 16428339-1', 409,
      {
        code: 'CONDUCTOR_YA_EXISTE', driver_id: 'd-existente',
        full_name: 'Carlos Perez Santiago', tax_id: '16428339-1',
        message: 'Carlos Perez Santiago ya esta registrado con el RUT 16428339-1',
      },
    ))
    const onAsignar = vi.fn().mockResolvedValue(undefined)
    abrirAltaYConfirmar({ onAsignar })

    fireEvent.click(await screen.findByRole('button', { name: /Asignar a Carlos Perez Santiago/i }))
    await waitFor(() => expect(onAsignar).toHaveBeenCalledWith('d-existente', true))
  })

  it('mientras guarda, el boton se apaga y no se puede disparar una segunda alta', async () => {
    vi.mocked(driversApi.create).mockReturnValue(new Promise(() => {}) as never)
    abrirAltaYConfirmar()
    const boton = await screen.findByRole('button', { name: /Guardando/i })
    expect(boton).toBeDisabled()
    fireEvent.click(boton)
    expect(driversApi.create).toHaveBeenCalledTimes(1)
  })

  // Un conductor sin empresa no aparece en el cierre del dia. El alta desde
  // aca los creaba asi SIEMPRE: al 27/08, 8 conductores con 278 viajes
  // invisibles para la cuadratura, y 4 los genero la propia sesion de revision.
  it('crea con la empresa elegida y asigna a la persona creada a sus N viajes', async () => {
    const onAsignar = vi.fn().mockResolvedValue(undefined)
    render_(<AsignarConductorPopover {...base} onAsignar={onAsignar} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    fireEvent.change(screen.getByLabelText(/RUT/i), { target: { value: '16.428.339-1' } })
    fireEvent.change(screen.getByPlaceholderText(/Buscar empresa/i), { target: { value: 'Transportes' } })
    fireEvent.click(await screen.findByRole('button', { name: /Transportes Sur/i }))

    fireEvent.click(screen.getByRole('button', { name: /Crear y asignar/i }))

    await waitFor(() => expect(onAsignar).toHaveBeenCalledWith('d-nuevo', true))
    expect(driversApi.create).toHaveBeenCalledWith({ tax_id: '16.428.339-1', full_name: 'Suarez Lopez Efrain Eduardo' })
    expect(carriersApi.assignDriver).toHaveBeenCalledWith('c1', 'd-nuevo')
  })

  it('sin empresa se puede crear igual, y avisa lo que cuesta', async () => {
    const onAsignar = vi.fn().mockResolvedValue(undefined)
    render_(<AsignarConductorPopover {...base} onAsignar={onAsignar} candidatos={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /dar de alta/i }))
    expect(screen.getByText(/Sin empresa no entra al cierre/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/RUT/i), { target: { value: '16.428.339-1' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear y asignar/i }))

    await waitFor(() => expect(onAsignar).toHaveBeenCalledWith('d-nuevo', true))
    expect(carriersApi.assignDriver).not.toHaveBeenCalled()
  })

  it('creado y asignado con aviso: muestra solo el aviso y cierra recién con Continuar', async () => {
    const message = 'Transportes Sur no está habilitada: tiene obligatorios vencidos.'
    const onAsignar = vi.fn().mockResolvedValue([{ code: 'CARRIER_NOT_ENABLED', message }])
    const onCancelar = vi.fn()
    abrirAltaYConfirmar({ onAsignar, onCancelar })
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/No encontramos a esta persona/)).not.toBeInTheDocument()
    expect(onCancelar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(onCancelar).toHaveBeenCalled()
  })

  // ── Guarda de asignación (D1 §7.1) ───────────────────────────────────────
  it('si la API rechaza la asignación (409) muestra su mensaje y no cierra', async () => {
    const message = 'Transportes Sur está dada de baja: no se le asignan viajes.'
    const onAsignar = vi.fn().mockRejectedValue(new ApiError(message, 409, { code: 'CARRIER_NOT_ACTIVE', message }))
    const onCancelar = vi.fn()
    render_(<AsignarConductorPopover {...base} onAsignar={onAsignar} onCancelar={onCancelar} candidatos={[CONTENIDO]} />)
    fireEvent.click(screen.getByRole('button', { name: /Suarez Lopez Efrain/i }))
    fireEvent.click(screen.getByRole('button', { name: /Asignar a 13 viajes/i }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(onCancelar).not.toHaveBeenCalled()
  })

  it('asignado con aviso de empresa no habilitada: lo muestra y cierra recién con Continuar', async () => {
    const message = 'Transportes Sur no está habilitada: tiene obligatorios vencidos.'
    const onAsignar = vi.fn().mockResolvedValue([{ code: 'CARRIER_NOT_ENABLED', message }])
    const onCancelar = vi.fn()
    render_(<AsignarConductorPopover {...base} onAsignar={onAsignar} onCancelar={onCancelar} candidatos={[CONTENIDO]} />)
    fireEvent.click(screen.getByRole('button', { name: /Suarez Lopez Efrain/i }))
    fireEvent.click(screen.getByRole('button', { name: /Asignar a 13 viajes/i }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(onCancelar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(onCancelar).toHaveBeenCalled()
  })
})
