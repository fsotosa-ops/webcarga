'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, ChevronRight, ChevronUp, Loader2 } from 'lucide-react'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Estado } from '@/components/ui/Estado'
import type { Direccion } from '@/lib/api/config'
import { BotonConfirmar, MarcaDeRevision, SIN_REVISAR, useRevisiones } from './revision'
import { usePuedeEditarSeccion, type ClaveDeSeccion } from './secciones'
import type { SettingsField, SettingsSource, SettingsValues } from './settings-sources'

const NUEVO = 'nuevo'
const TODOS = 'todos'
const CAMPO = 'mt-1 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-dato text-text-primary '
  + 'focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:bg-bg-main disabled:text-informativo'
const BOTON = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-dato font-semibold '
  + 'text-text-primary hover:bg-bg-main disabled:opacity-50'

/** Una sección de Configuración: una lista de lectura y un panel lateral para el
 *  elemento abierto (Configuración, Parte 1). Es la única forma de editar en el
 *  módulo: ninguna fila tiene un campo, una paleta ni flechas. El elemento abierto
 *  viaja en la URL (`?item=`): abrir es `push` (atrás cierra el panel) y cerrar,
 *  `replace`. */
export function SettingsList<Row extends { id: string }>({ source }: { source: SettingsSource<Row> }) {
  const qc = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const puedeEditar = usePuedeEditarSeccion(`${source.area}/${source.section}` as ClaveDeSeccion)
  // Lo que se revisa: la fila, o el formulario entero (las reglas del Monitor).
  const rid = (r: Row) => source.revisionId?.(r) ?? r.id
  const revisiones = useRevisiones(source.area, source.section)
  const q = useQuery({ queryKey: source.queryKey, queryFn: source.list })
  const [filtro, setFiltro] = useState<string>(TODOS)
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
  const extra = useMemo(() => source.filters?.(filas) ?? [], [source, filas])
  const visibles = useMemo(() => {
    if (filtro === SIN_REVISAR) return filas.filter(r => revisiones.sinRevisar(rid(r)))
    const f = extra.find(e => e.id === filtro)
    return f ? filas.filter(f.match) : filas
    // `revisiones.sinRevisar` se recrea en cada render; lo que cambia es `datos`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, filtro, extra, revisiones.datos])

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: source.queryKey })
    revisiones.invalidar()
  }

  if (q.isPending) return <Estado tipo="cargando" />
  if (q.isError) {
    return (
      <Estado tipo="error" titulo="No se pudo cargar la lista" detalle="Reintenta en unos segundos.">
        <button type="button" onClick={() => q.refetch()} className="text-accion hover:underline">Reintentar</button>
      </Estado>
    )
  }

  const opciones = [
    { id: TODOS, label: 'Todos', badge: String(filas.length) },
    // Sin cifra mientras las revisiones cargan: un "0" ahí afirma algo falso.
    { id: SIN_REVISAR, label: 'Sin revisar',
      badge: revisiones.cargando ? undefined : String(filas.filter(r => revisiones.sinRevisar(rid(r))).length) },
    ...extra.map(e => ({ id: e.id, label: e.label, badge: String(filas.filter(e.match).length) })),
  ]
  const fila = abierto && abierto !== NUEVO ? filas.find(r => r.id === abierto) : undefined
  const creando = abierto === NUEVO && !!source.create && puedeEditar

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-dato text-informativo">{source.description}</p>
        {source.create && puedeEditar && (
          <button type="button" onClick={() => abrir(NUEVO)}
                  className="rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90">
            + Nuevo {source.create.noun}
          </button>
        )}
      </div>
      {aviso && <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-dato text-warning">{aviso}</p>}
      {filas.length === 0 ? (
        <Estado tipo="vacio" titulo={source.emptyText} />
      ) : (
        <>
          <SegmentedControl label="Filtrar" options={opciones} value={filtro} onChange={setFiltro} />
          <div className="overflow-x-auto rounded-md border border-border bg-white">
            <table className="w-full text-dato">
              <thead>
                <tr className="border-b border-border bg-bg-main">
                  {source.columns.map(c => <th key={c.header} scope="col" className={CABECERA}>{c.header}</th>)}
                  <th scope="col" className={CABECERA}>Revisión</th>
                  <th scope="col" className="w-10"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(r => (
                  <tr key={r.id} onClick={() => abrir(r.id)}
                      className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg-main ${r.id === abierto ? 'bg-accion/5' : ''}`}>
                    {source.columns.map(c => <td key={c.header} className="px-3 py-2.5">{c.cell(r)}</td>)}
                    <td className="px-3 py-2.5"><MarcaDeRevision revision={revisiones.revisionDe(rid(r))} /></td>
                    <td className="pr-2 text-right">
                      <button type="button" aria-label={`Abrir ${source.title(r)}`}
                              onClick={e => { e.stopPropagation(); abrir(r.id) }}
                              className="rounded text-informativo hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr><td colSpan={source.columns.length + 2} className="px-3 py-6 text-center text-informativo">Nada coincide con el filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(fila || creando) && (
        <PanelElemento
          key={fila?.id ?? NUEVO}
          source={source}
          fila={fila}
          hermanos={filas}
          puedeEditar={puedeEditar}
          revision={fila ? revisiones.revisionDe(rid(fila)) : undefined}
          onConfirmar={() => fila && revisiones.confirmar.mutate(rid(fila))}
          confirmando={revisiones.confirmar.isPending}
          onCambio={refrescar}
          onDesactivado={n => setAviso(n > 0
            ? `Se desactivó, y ${n === 1 ? 'una regla de documento seguía usándolo' : `${n} reglas de documento seguían usándolo`}. Revísalas en Certificación.`
            : null)}
          onCerrar={() => abrir(null)}
        />
      )}
    </div>
  )
}

function PanelElemento<Row extends { id: string }>({
  source, fila, hermanos, puedeEditar, revision, onConfirmar, confirmando, onCambio, onDesactivado, onCerrar,
}: {
  source: SettingsSource<Row>
  fila: Row | undefined
  hermanos: Row[]
  puedeEditar: boolean
  revision: ReturnType<ReturnType<typeof useRevisiones>['revisionDe']>
  onConfirmar: () => void
  confirmando: boolean
  onCambio: () => void
  onDesactivado: (enUsoPor: number) => void
  onCerrar: () => void
}) {
  const originales = useMemo<SettingsValues>(() => (fila ? source.values(fila) : {}), [fila, source])
  const [valores, setValores] = useState<SettingsValues>(originales)
  const [confirmarBaja, setConfirmarBaja] = useState(false)
  const cambios = useMemo(() => Object.fromEntries(
    Object.entries(valores).filter(([k, v]) => v !== originales[k])), [valores, originales])
  const sucio = Object.keys(cambios).length > 0
  const invalido = source.validate?.(valores) ?? null

  const guardar = useMutation({
    mutationFn: () => (fila ? source.save(fila, cambios) : source.create!.run(valores)),
    onSuccess: () => { onCambio(); if (!fila) onCerrar() },
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
      {fila && !sucio
        ? <BotonConfirmar revisado={!!revision} pendiente={confirmando} onConfirmar={onConfirmar} />
        : (
          <button type="button" onClick={() => guardar.mutate()} disabled={guardar.isPending || !!invalido || (!fila && !String(valores.label ?? '').trim())}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
            {guardar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            {fila ? 'Guardar' : 'Crear'}
          </button>
        )}
    </div>
  )

  return (
    <PanelLateral titulo={fila ? source.title(fila) : `Nuevo ${source.create!.noun}`} onCerrar={onCerrar} pie={pie}>
      <div className="space-y-4">
        {fila && <MarcaDeRevision revision={revision} />}
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
