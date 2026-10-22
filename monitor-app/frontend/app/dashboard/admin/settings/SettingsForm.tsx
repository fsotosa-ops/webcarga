'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Estado } from '@/components/ui/Estado'
import { LastChange, useLastChanges } from './LastChange'
import { Campo } from './SettingsList'
import { usePuedeEditarSeccion, type ClaveDeSeccion } from './secciones'
import type { SettingsSource, SettingsValues } from './settings-sources'
import { useUnsavedChanges } from './unsavedChanges'

/** Una sección de valores sueltos (umbrales, alertas de vencimiento) como un
 *  formulario, no como una tabla (spec 2026-10-22 §3.1; Stripe, Linear, GitHub).
 *  Cada fila de la fuente es un grupo de campos; se guardan fila por fila y lo que
 *  falla conserva lo escrito y dice por qué. */
export function SettingsForm<Row extends { id: string }>({ source }: { source: SettingsSource<Row> }) {
  const qc = useQueryClient()
  const puedeEditar = usePuedeEditarSeccion(`${source.area}/${source.section}` as ClaveDeSeccion)
  const cambios = useLastChanges(source.area, source.section)
  const q = useQuery({ queryKey: source.queryKey, queryFn: source.list })
  // Solo lo que la persona tocó, por fila: lo demás sale de los datos guardados.
  const [editados, setEditados] = useState<Record<string, SettingsValues>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  // Las filas que se guardaron en el último intento, para decirlo en cada una.
  const [guardadas, setGuardadas] = useState<string[]>([])
  const [resumen, setResumen] = useState<string | null>(null)

  const filas = useMemo(() => q.data ?? [], [q.data])
  const originales = useMemo(() => Object.fromEntries(filas.map(r => [r.id, source.values(r)])), [filas, source])
  const valoresDe = (r: Row): SettingsValues => ({ ...originales[r.id], ...editados[r.id] })
  const cambiosDe = (r: Row): SettingsValues => Object.fromEntries(
    Object.entries(editados[r.id] ?? {}).filter(([k, v]) => v !== originales[r.id]?.[k]))
  const sucias = filas.filter(r => Object.keys(cambiosDe(r)).length > 0)
  const invalidas = sucias.filter(r => source.validate?.(valoresDe(r), r))
  useUnsavedChanges(sucias.length > 0)

  const ultimo = filas.map(r => cambios.of(r.id)).filter(Boolean)
    .sort((a, b) => b!.changedAt.localeCompare(a!.changedAt))[0]

  async function guardar() {
    setGuardando(true)
    setGuardado(false)
    setResumen(null)
    const fallas: Record<string, string> = {}
    const listas: string[] = []
    for (const r of sucias) {
      try {
        await source.save(r, cambiosDe(r))
        listas.push(r.id)
      } catch (e) {
        fallas[r.id] = e instanceof Error && e.message ? e.message : 'No se pudo guardar'
      }
    }
    setErrores(fallas)
    setGuardadas(listas)
    // Lo guardado deja de ser un cambio pendiente recién cuando los datos nuevos llegan:
    // si se soltara antes, el campo mostraría un momento (o para siempre, si la
    // consulta falla) el valor viejo.
    await qc.invalidateQueries({ queryKey: source.queryKey })
    if (!qc.getQueryState(source.queryKey)?.error) {
      setEditados(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !listas.includes(id))))
    }
    cambios.invalidate()
    setGuardando(false)
    const fallidas = Object.keys(fallas).length
    if (fallidas === 0) {
      setGuardado(true)
      setTimeout(() => setGuardado(false), 2000)
    } else if (listas.length > 0) {
      const total = listas.length + fallidas
      setResumen(`Se guardó ${listas.length} de ${total} cambios; revisa ${fallidas === 1 ? 'el que falló' : 'los que fallaron'}.`)
    }
  }

  if (q.isPending) return <Estado tipo="cargando" />
  if (q.isError) return <Estado tipo="error" titulo="No se pudieron cargar los valores" detalle="Reintenta en unos segundos." />
  if (filas.length === 0) return <Estado tipo="vacio" titulo={source.emptyText} />

  return (
    <Card>
      <form className="divide-y divide-border" onSubmit={e => { e.preventDefault(); void guardar() }}>
        {filas.map(r => {
          const valores = valoresDe(r)
          const invalido = Object.keys(cambiosDe(r)).length > 0 ? source.validate?.(valores, r) : null
          return (
            <fieldset key={r.id} aria-label={source.title(r)} className="space-y-3 py-4 first:pt-0">
              <legend className="flex items-center gap-2 text-dato font-semibold text-text-primary">
                {source.title(r)}
                {guardadas.includes(r.id) && !errores[r.id] && resumen && (
                  <span className="text-etiqueta font-normal text-resuelto">Guardado</span>
                )}
              </legend>
              <div className="grid gap-3 md:grid-cols-2">
                {source.fields(r).map(f => (
                  <Campo key={f.key} campo={f} valor={valores[f.key]} disabled={!puedeEditar || guardando}
                         onChange={v => setEditados(prev => ({ ...prev, [r.id]: { ...prev[r.id], [f.key]: v } }))} />
                ))}
              </div>
              {invalido && <p className="text-dato text-warning">{invalido}</p>}
              {errores[r.id] && <p role="alert" className="text-dato text-status-incidente">{errores[r.id]}</p>}
            </fieldset>
          )
        })}
        <div className="flex flex-wrap items-center gap-3 pt-4">
          <LastChange change={ultimo} pending={cambios.isPending} error={cambios.isError} />
          <span className="flex-1" />
          {guardado && <span role="status" className="text-etiqueta text-resuelto">Guardado</span>}
          {resumen && <span role="status" className="text-etiqueta text-warning">{resumen}</span>}
          {puedeEditar && (
            <>
              <Button disabled={sucias.length === 0 || guardando} onClick={() => { setEditados({}); setErrores({}) }}>
                Descartar
              </Button>
              <Button variant="primary" type="submit" disabled={sucias.length === 0 || invalidas.length > 0 || guardando}>
                {guardando && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Guardar cambios
              </Button>
            </>
          )}
        </div>
      </form>
    </Card>
  )
}
