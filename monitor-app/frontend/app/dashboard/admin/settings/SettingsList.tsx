'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, ChevronRight, ChevronUp, Loader2, Plus } from 'lucide-react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Estado } from '@/components/ui/Estado'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import type { Direccion } from '@/lib/api/config'
import { LastChange, useLastChanges, type LastChangeInfo } from './LastChange'
import { usePuedeEditarSeccion, type ClaveDeSeccion } from './secciones'
import type { SettingsField, SettingsSource, SettingsValues } from './settings-sources'
import { INPUT } from './shared'

const NUEVO = 'nuevo'
// El campo de texto del módulo (shared.INPUT), a todo el ancho del panel.
const CAMPO = `${INPUT} mt-1 w-full disabled:bg-bg-main disabled:text-informativo`
const BOTON = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-dato font-semibold '
  + 'text-text-primary hover:bg-bg-main disabled:opacity-50'

/** Una sección de Configuración que es una lista (spec 2026-10-22 §3.1): la tabla
 *  del kit, como la Flota del día —buscador, "+ Filtro" por columna, "+ Nuevo" en la
 *  barra—, y el panel lateral como única forma de editar. El elemento abierto viaja en
 *  la URL (`?item=`): abrir es `push` (atrás cierra el panel) y cerrar, `replace`.
 *  Sin "Sin revisar": la trazabilidad es el registro de cambios ("Última modificación"). */
export function SettingsList<Row extends { id: string }>({ source }: { source: SettingsSource<Row> }) {
  const qc = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const puedeEditar = usePuedeEditarSeccion(`${source.area}/${source.section}` as ClaveDeSeccion)
  const cambios = useLastChanges(source.area, source.section)
  const q = useQuery({ queryKey: source.queryKey, queryFn: source.list })
  const [view, setView] = useUrlView()
  const [aviso, setAviso] = useState<string | null>(null)

  const abierto = params.get('item')
  const abrir = useCallback((id: string | null) => {
    const sp = new URLSearchParams(params.toString())
    if (id) sp.set('item', id); else sp.delete('item')
    const s = sp.toString()
    const destino = s ? `${pathname}?${s}` : pathname
    if (id) router.push(destino); else router.replace(destino)
  }, [router, pathname, params])

  const filas = useMemo(() => q.data ?? [], [q.data])
  // Una lista que se ordena a mano (Subir/Bajar) muestra SU orden: ordenar por columna lo escondería.
  const ordenable = !!source.move
  const columnas = useMemo<DataColumn<Row>[]>(() => [
    ...source.columns.map((c, i) => ({
      id: c.id, header: c.header, value: c.value, hideable: i > 0, sortable: !ordenable,
      render: (r: Row) => (i === 0
        ? <button type="button" onClick={() => abrir(r.id)} className="text-left hover:underline">{c.cell ? c.cell(r) : c.value(r)}</button>
        : c.cell ? c.cell(r) : (c.value(r) ?? '—')),
    })),
    { id: 'open', header: 'Abrir', value: () => null, filter: false as const, sortable: false, hideable: false,
      render: (r: Row) => (
        <button type="button" aria-label={`Abrir ${source.title(r)}`} onClick={() => abrir(r.id)}
                className="rounded text-informativo hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      ) },
  ], [source, ordenable, abrir])
  const model = useDataTable({
    rows: filas, columns: columnas, getRowId: r => r.id, view, onViewChange: setView, pageSize: 50,
    search: (r, texto) => source.columns.some(c => (c.value(r) ?? '').toLowerCase().includes(texto)),
  })

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: source.queryKey })
    cambios.invalidate()
  }

  if (q.isPending) return <Estado tipo="cargando" />
  if (q.isError) {
    return (
      <Estado tipo="error" titulo="No se pudo cargar la lista" detalle="Reintenta en unos segundos.">
        <button type="button" onClick={() => q.refetch()} className="text-accion hover:underline">Reintentar</button>
      </Estado>
    )
  }

  const fila = abierto && abierto !== NUEVO ? filas.find(r => r.id === abierto) : undefined
  const creando = abierto === NUEVO && !!source.create && puedeEditar
  const nuevo = source.create && puedeEditar ? (
    <Button variant="primary" onClick={() => abrir(NUEVO)}>
      <Plus size={14} aria-hidden="true" /> Nuevo {source.create.noun}
    </Button>
  ) : null

  return (
    <Card className="space-y-3">
      <TableToolbar model={model} searchPlaceholder="Buscar…" actions={nuevo} />
      {aviso && <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-dato text-warning">{aviso}</p>}
      {filas.length === 0
        ? <Estado tipo="vacio" titulo={source.emptyText} />
        : <DataTable model={model} label={source.columns[0]?.header ?? 'Lista'} empty="Nada coincide con el filtro."
                     isRowActive={r => r.id === abierto} />}
      {(fila || creando) && (
        <PanelElemento
          key={fila?.id ?? NUEVO}
          source={source}
          fila={fila}
          hermanos={filas}
          puedeEditar={puedeEditar}
          ultimo={fila ? cambios.of(fila.id) : undefined}
          cargandoUltimo={cambios.isPending}
          onCambio={refrescar}
          onDesactivado={n => setAviso(n > 0
            ? `Se desactivó, y ${n === 1 ? 'una regla de documento seguía usándolo' : `${n} reglas de documento seguían usándolo`}. Revísalas en Certificación.`
            : null)}
          onCerrar={() => abrir(null)}
        />
      )}
    </Card>
  )
}

function PanelElemento<Row extends { id: string }>({
  source, fila, hermanos, puedeEditar, ultimo, cargandoUltimo, onCambio, onDesactivado, onCerrar,
}: {
  source: SettingsSource<Row>
  fila: Row | undefined
  hermanos: Row[]
  puedeEditar: boolean
  ultimo: LastChangeInfo | undefined
  cargandoUltimo: boolean
  onCambio: () => void
  onDesactivado: (enUsoPor: number) => void
  onCerrar: () => void
}) {
  const originales = useMemo<SettingsValues>(() => (fila ? source.values(fila) : {}), [fila, source])
  const [valores, setValores] = useState<SettingsValues>(originales)
  const [confirmarBaja, setConfirmarBaja] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const cambios = useMemo(() => Object.fromEntries(
    Object.entries(valores).filter(([k, v]) => v !== originales[k])), [valores, originales])
  const sucio = Object.keys(cambios).length > 0
  const invalido = source.validate?.(valores, fila) ?? null

  const guardar = useMutation({
    mutationFn: () => (fila ? source.save(fila, cambios) : source.create!.run(valores)),
    onSuccess: () => {
      onCambio()
      if (!fila) { onCerrar(); return }
      setGuardado(true)
      setTimeout(() => setGuardado(false), 2000)
    },
  })
  const mover = useMutation({ mutationFn: (d: Direccion) => source.move!(fila!, d), onSuccess: onCambio })
  const desactivar = useMutation({
    mutationFn: () => source.deactivate!.run(fila!),
    onSuccess: r => { onDesactivado((r as { en_uso_por?: number } | undefined)?.en_uso_por ?? 0); onCambio(); onCerrar() },
  })
  const error = [guardar, mover, desactivar].find(m => m.isError)?.error
  const posicion = fila ? hermanos.findIndex(h => h.id === fila.id) : -1

  const pie = !puedeEditar ? null : (
    <div className="flex flex-wrap items-center gap-2">
      {fila && source.deactivate && (confirmarBaja ? (
        <>
          <button type="button" onClick={() => desactivar.mutate()} disabled={desactivar.isPending}
                  className="rounded-md bg-status-incidente px-2.5 py-1.5 text-dato font-semibold text-white disabled:opacity-50">
            {source.deactivate.confirm}
          </button>
          <button type="button" onClick={() => setConfirmarBaja(false)} className={BOTON}>Volver</button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirmarBaja(true)} className={BOTON}>{source.deactivate.label}</button>
      ))}
      <span className="flex-1" />
      {guardado && <span role="status" className="text-etiqueta text-resuelto">Guardado</span>}
      <button type="button" onClick={() => guardar.mutate()}
              disabled={guardar.isPending || !!invalido || (fila ? !sucio : !String(valores.label ?? '').trim())}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
        {guardar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        {fila ? 'Guardar' : 'Crear'}
      </button>
    </div>
  )

  return (
    <PanelLateral titulo={fila ? source.title(fila) : `Nuevo ${source.create!.noun}`} onCerrar={onCerrar} pie={pie}>
      <div className="space-y-4">
        {fila && <LastChange change={ultimo} pending={cargandoUltimo} />}
        {source.note && <p className="text-dato text-informativo">{source.note}</p>}
        {source.fields(fila).map(f => (
          <Campo key={f.key} campo={f} valor={valores[f.key]} disabled={!puedeEditar}
                 onChange={v => setValores(prev => ({ ...prev, [f.key]: v }))} />
        ))}
        {fila && source.move && (
          <div>
            <span className="text-etiqueta text-informativo">Orden</span>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-dato tabular-nums text-informativo">{posicion + 1} de {hermanos.length}</span>
              <button type="button" onClick={() => mover.mutate('up')} disabled={!puedeEditar || posicion <= 0 || mover.isPending} className={BOTON}>
                <ChevronUp size={12} aria-hidden="true" /> Subir
              </button>
              <button type="button" onClick={() => mover.mutate('down')} disabled={!puedeEditar || posicion >= hermanos.length - 1 || mover.isPending} className={BOTON}>
                <ChevronDown size={12} aria-hidden="true" /> Bajar
              </button>
            </div>
            <p className="mt-1 text-etiqueta text-informativo">Se aplica al instante, sin Guardar.</p>
          </div>
        )}
        {invalido && sucio && <p className="text-dato text-warning">{invalido}</p>}
        {error && <p role="alert" className="text-dato text-status-incidente">{error instanceof Error ? error.message : 'No se pudo guardar'}</p>}
      </div>
    </PanelLateral>
  )
}

function Campo({ campo, valor, disabled, onChange }: {
  campo: SettingsField
  valor: SettingsValues[string]
  disabled: boolean
  onChange: (v: string | number | null) => void
}) {
  return (
    <label className="block">
      <span className="text-etiqueta text-informativo">{campo.label}</span>
      {campo.kind === 'select' ? (
        <select aria-label={campo.label} value={String(valor ?? '')} disabled={disabled}
                onChange={e => onChange(e.target.value)} className={CAMPO}>
          {/* Sin valor (un estado que llegó sin columna): se pide elegirlo. */}
          {(valor ?? '') === '' && <option value="" disabled>Elige…</option>}
          {campo.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : (
        <input aria-label={campo.label} type={campo.kind === 'number' ? 'number' : 'text'}
               min={campo.kind === 'number' ? campo.min : undefined}
               value={valor ?? ''} disabled={disabled}
               onChange={e => onChange(campo.kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
               className={CAMPO} />
      )}
      {campo.help && <span className="mt-1 block text-etiqueta text-informativo">{campo.help}</span>}
    </label>
  )
}
