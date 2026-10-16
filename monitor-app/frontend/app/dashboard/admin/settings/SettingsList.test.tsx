import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let search = ''
const push = vi.fn((url: string) => { search = url.split('?')[1] ?? '' })
const replace = vi.fn((url: string) => { search = url.split('?')[1] ?? '' })
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ push, replace }),
  usePathname: () => '/dashboard/admin/settings/operations/driver-reasons',
}))
let puede = true
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => puede }))
vi.mock('@/lib/api/config', () => ({
  revisionesApi: { list: vi.fn(), confirm: vi.fn() },
}))

import { revisionesApi } from '@/lib/api/config'
import { SettingsList } from './SettingsList'
import type { SettingsSource } from './settings-sources'

type Row = { id: string; label: string; group: string }
const ROWS: Row[] = [
  { id: 'a', label: 'Panne', group: 'no_trabajando' },
  { id: 'b', label: 'Conductor backup', group: 'trabajando_sin_asignacion' },
]

function fuente(over: Partial<SettingsSource<Row>> = {}): SettingsSource<Row> {
  return {
    area: 'operations', section: 'driver-reasons',
    queryKey: ['prueba', Math.random()],
    list: vi.fn().mockResolvedValue(ROWS),
    title: r => r.label,
    columns: [
      { header: 'Motivo', cell: r => r.label },
      { header: 'Qué significa', cell: r => (r.group === 'no_trabajando' ? 'No trabajó' : 'Trabajó') },
    ],
    fields: () => [
      { key: 'label', label: 'Nombre', kind: 'text' },
      { key: 'group', label: 'Qué significa', kind: 'select',
        options: [{ id: 'no_trabajando', label: 'No trabajó' }, { id: 'trabajando_sin_asignacion', label: 'Trabajó' }] },
    ],
    values: r => ({ label: r.label, group: r.group }),
    save: vi.fn().mockResolvedValue({}),
    filters: () => [{ id: 'no_trabajando', label: 'No trabajó', match: r => r.group === 'no_trabajando' }],
    create: { noun: 'motivo', run: vi.fn().mockResolvedValue({}) },
    deactivate: { label: 'Desactivar', confirm: 'Sí, desactivar', run: vi.fn().mockResolvedValue({ en_uso_por: 0 }) },
    emptyText: 'No hay motivos todavía',
    ...over,
  }
}

function renderLista(src: SettingsSource<Row>) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsList source={src} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  search = ''; puede = true; push.mockClear(); replace.mockClear()
  vi.mocked(revisionesApi.list).mockResolvedValue([
    { element_id: 'b', reviewed_by: 'Ana', reviewed_at: '2026-10-01T12:00:00Z' },
  ] as never)
})

describe('SettingsList: una lista de lectura y un panel', () => {
  it('P1.2: las filas no tienen campos ni paletas; se leen', async () => {
    renderLista(fuente())
    const tabla = await screen.findByRole('table')
    await within(tabla).findByText('Panne')
    expect(within(tabla).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(tabla).queryAllByRole('combobox')).toHaveLength(0)
    expect(within(tabla).queryByRole('button', { name: /color/i })).toBeNull()
  })

  it('abrir una fila la pone en la URL (push) y cerrar la quita (replace)', async () => {
    renderLista(fuente())
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Panne' }))
    expect(push).toHaveBeenCalledWith('/dashboard/admin/settings/operations/driver-reasons?item=a')
  })

  it('con ?item= el panel se abre desde el dato; cerrar usa replace', async () => {
    search = 'item=a'
    renderLista(fuente())
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByRole('textbox', { name: 'Nombre' })).toHaveValue('Panne')
    fireEvent.click(within(panel).getByRole('button', { name: /cerrar/i }))
    expect(replace).toHaveBeenCalledWith('/dashboard/admin/settings/operations/driver-reasons')
  })

  it('P1.3: sin permiso se lee pero no se guarda ni se desactiva', async () => {
    puede = false; search = 'item=a'
    renderLista(fuente())
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByRole('textbox', { name: 'Nombre' })).toBeDisabled()
    expect(within(panel).queryByRole('button', { name: 'Guardar' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Desactivar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /nuevo motivo/i })).toBeNull()
  })

  it('sin cambios ofrece "Está bien así"; con cambios, Guardar envía solo lo cambiado', async () => {
    search = 'item=a'
    const src = fuente()
    renderLista(src)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByRole('button', { name: /está bien así/i })).toBeInTheDocument()
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Panne mecánica' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(src.save).toHaveBeenCalledWith(ROWS[0], { label: 'Panne mecánica' }))
  })

  it('desactivar se confirma dentro del panel y avisa si algo lo usaba', async () => {
    search = 'item=a'
    const src = fuente({ deactivate: { label: 'Desactivar', confirm: 'Sí, desactivar', run: vi.fn().mockResolvedValue({ en_uso_por: 2 }) } })
    renderLista(src)
    const panel = await screen.findByRole('dialog')
    fireEvent.click(within(panel).getByRole('button', { name: 'Desactivar' }))
    expect(src.deactivate!.run).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Sí, desactivar' }))
    await waitFor(() => expect(src.deactivate!.run).toHaveBeenCalledWith(ROWS[0]))
    expect(await screen.findByRole('status')).toHaveTextContent('2 reglas de documento')
  })

  it('los filtros cuentan desde los datos y "Sin revisar" desde las revisiones', async () => {
    renderLista(fuente())
    const filtros = await screen.findByRole('group', { name: 'Filtrar' })
    await waitFor(() => expect(within(filtros).getByRole('button', { name: /Sin revisar/ })).toHaveTextContent('1'))
    expect(within(filtros).getByRole('button', { name: /Todos/ })).toHaveTextContent('2')
    expect(within(filtros).getByRole('button', { name: /No trabajó/ })).toHaveTextContent('1')
    fireEvent.click(within(filtros).getByRole('button', { name: /Sin revisar/ }))
    expect(screen.queryByText('Conductor backup')).toBeNull()
  })

  it('"Sin revisar" no muestra un 0 mientras las revisiones cargan', async () => {
    vi.mocked(revisionesApi.list).mockReturnValue(new Promise(() => {}))
    renderLista(fuente())
    const filtros = await screen.findByRole('group', { name: 'Filtrar' })
    expect(within(filtros).getByRole('button', { name: /Sin revisar/ })).not.toHaveTextContent(/\d/)
  })

  it('vacío: lo dice; error: ofrece reintentar', async () => {
    renderLista(fuente({ list: vi.fn().mockResolvedValue([]) }))
    expect(await screen.findByText('No hay motivos todavía')).toBeInTheDocument()
  })

  it('si no se pudo cargar, lo dice', async () => {
    renderLista(fuente({ list: vi.fn().mockRejectedValue(new Error('x')) }))
    expect(await screen.findByText(/No se pudo cargar/)).toBeInTheDocument()
  })

  it('"+ Nuevo motivo" abre el panel vacío y crea', async () => {
    const src = fuente()
    renderLista(src)
    fireEvent.click(await screen.findByRole('button', { name: '+ Nuevo motivo' }))
    expect(push).toHaveBeenCalledWith('/dashboard/admin/settings/operations/driver-reasons?item=nuevo')
  })

  it('el orden se cuenta sobre el catálogo completo, aunque haya un filtro', async () => {
    search = 'item=b'
    const src = fuente({ move: vi.fn().mockResolvedValue([]) })
    renderLista(src)
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('2 de 2')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: /Subir/ }))
    await waitFor(() => expect(src.move).toHaveBeenCalledWith(ROWS[1], 'up'))
    expect(within(panel).getByRole('button', { name: /Bajar/ })).toBeDisabled()
  })

  it('un elemento que no existe en el catálogo no abre ningún panel', async () => {
    search = 'item=inventado'
    renderLista(fuente())
    await screen.findByText('Panne')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('si guardar falla, el panel lo dice y no se cierra', async () => {
    search = 'item=a'
    renderLista(fuente({ save: vi.fn().mockRejectedValue(new Error('Nombre repetido')) }))
    const panel = await screen.findByRole('dialog')
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Otro' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Nombre repetido')
  })

  it('desactivar algo que nadie usaba no deja aviso', async () => {
    search = 'item=a'
    renderLista(fuente())
    const panel = await screen.findByRole('dialog')
    fireEvent.click(within(panel).getByRole('button', { name: 'Desactivar' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Sí, desactivar' }))
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('una validación de la fuente impide guardar y lo dice antes de enviar', async () => {
    search = 'item=a'
    const src = fuente({ validate: v => (String(v.label).length < 3 ? 'El nombre es muy corto.' : null) })
    renderLista(src)
    const panel = await screen.findByRole('dialog')
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Pa' } })
    expect(within(panel).getByText('El nombre es muy corto.')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(src.save).not.toHaveBeenCalled()
  })

  it('las reglas que se revisan como un formulario muestran la misma revisión en cada fila', async () => {
    vi.mocked(revisionesApi.list).mockResolvedValue([
      { element_id: 'reglas', reviewed_by: 'Ana', reviewed_at: '2026-10-01T12:00:00Z' },
    ] as never)
    renderLista(fuente({ revisionId: () => 'reglas' }))
    const filtros = await screen.findByRole('group', { name: 'Filtrar' })
    await waitFor(() => expect(within(filtros).getByRole('button', { name: /Sin revisar/ })).toHaveTextContent('0'))
  })
})
