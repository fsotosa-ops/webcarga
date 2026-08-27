'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { driversApi } from '@/lib/api/drivers'
import { assetsApi } from '@/lib/api/assets'
import { carriersApi } from '@/lib/api/carriers'
import { taxonomiesApi } from '@/lib/api/config'
import { ApiError } from '@/lib/api/client'
import type { AssetType, ManagementType } from '@/lib/types'

const ASSET_TYPE_OPTIONS: { value: AssetType; label: string }[] = [
  { value: 'TRACTOCAMION', label: 'Tractocamión' },
  { value: 'RAMPLA',       label: 'Rampla' },
]

const INPUT = 'text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30'

interface Props {
  /** La empresa a la que se va a asignar lo que se cree. */
  carrierId: string
  /** `conductor` pide RUT y nombre; `equipo` pide tipo, subtipo, gestión y
   *  patente. Es la misma alta con distinto formulario: una variante es una
   *  prop, no un componente hermano. */
  tipo: 'conductor' | 'equipo'
  /** Lo que la empresa declaró al crearse, para preseleccionar la gestión del
   *  primer vehículo. Es una propuesta, no una restricción. */
  gestionesDeclaradas?: ManagementType[] | null
  /** Prefill que llega del flujo guiado de "Sin identificar" (el TMS ya
   *  reportó el nombre o la patente). */
  prefill?: string
  /** Se abre solo si vino un prefill: quien llegó por ese camino ya dijo que
   *  quiere dar de alta. */
  abiertoAlInicio?: boolean
  /** Modo CONTROLADO: la ficha vieja ya tiene su botón "+ Conductor" arriba a
   *  la derecha de la tarjeta, y moverlo cambiaría una pantalla que funciona
   *  sin ganar nada. Cuando llegan estas dos props, el componente no dibuja su
   *  propio disparador y el estado lo lleva quien lo aloja. Es la misma alta
   *  con otro disparador: una prop, no un componente hermano. */
  abierto?: boolean
  onAbiertoChange?: (abierto: boolean) => void
  onCreado: () => Promise<void> | void
}

/**
 * Dar de alta un conductor o un vehículo DENTRO de una empresa.
 *
 * POR QUÉ EXISTE COMO COMPONENTE. Es el bug crítico #3 de la minuta del 25/08:
 * *"no se puede crear conductor ni equipo dentro de una empresa existente desde
 * el módulo de certificaciones"*. Y era cierto: el alta sólo vivía escrita a
 * mano dentro de `/dashboard/carriers/[id]`, la ficha vieja — que además el
 * rediseño del 19/08 había sacado del menú, así que la capacidad existía y no
 * se podía alcanzar desde ninguna parte.
 *
 * Se extrajo en vez de copiarse. Dos formularios iguales en dos fichas es la
 * forma en que esta clase de arreglo vuelve: el día que se agregue un campo,
 * uno de los dos se queda corto y nadie se entera hasta que alguien lo usa.
 *
 * Los dos catálogos (`subtipo` y `gestión`) son conceptos HERMANOS y ninguno se
 * deduce del otro: la migración 20260803050000 los separó a propósito porque
 * hay 37 tractocamiones cuya gestión es "Equipo Completo".
 */
export function AltaDeFlota({
  carrierId, tipo, gestionesDeclaradas, prefill, abiertoAlInicio,
  abierto: abiertoProp, onAbiertoChange, onCreado,
}: Props) {
  const controlado = abiertoProp !== undefined
  const [abiertoLocal, setAbiertoLocal] = useState(!!abiertoAlInicio)
  const abierto = controlado ? abiertoProp : abiertoLocal
  const setAbierto = (v: boolean) => {
    if (!controlado) setAbiertoLocal(v)
    onAbiertoChange?.(v)
  }
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [taxId, setTaxId] = useState('')
  const [nombre, setNombre] = useState(tipo === 'conductor' ? prefill ?? '' : '')
  const [assetType, setAssetType] = useState<AssetType>('TRACTOCAMION')
  const [patente, setPatente] = useState(tipo === 'equipo' ? prefill ?? '' : '')
  const [subtipoId, setSubtipoId] = useState('')
  const [gestionId, setGestionId] = useState('')

  const esEquipo = tipo === 'equipo'

  const subtiposQuery = useQuery({
    queryKey: ['taxonomias', 'FLEET_SERVICE_TYPE'],
    queryFn: () => taxonomiesApi.list('FLEET_SERVICE_TYPE'),
    enabled: abierto && esEquipo,
    staleTime: 5 * 60_000,
  })
  const gestionesQuery = useQuery({
    queryKey: ['taxonomias', 'WEBCARGA_OPERATION_TYPE'],
    queryFn: () => taxonomiesApi.list('WEBCARGA_OPERATION_TYPE'),
    enabled: abierto && esEquipo,
    staleTime: 5 * 60_000,
  })

  // La gestión que la empresa declaró al crearse preselecciona la del primer
  // vehículo. NO se toca el subtipo (ver arriba). Sólo propone: el selector
  // sigue ofreciendo todas las opciones, y no pisa una elección ya hecha.
  useEffect(() => {
    if (!abierto || !esEquipo) return
    if (gestionesDeclaradas?.length !== 1) return
    const buscada = gestionesDeclaradas[0] === 'TRACTOREO' ? 'Tractoreo' : 'Equipo Completo'
    const propuesta = (gestionesQuery.data ?? []).find(t => t.label === buscada)
    if (propuesta) setGestionId(v => v || propuesta.id)
  }, [abierto, esEquipo, gestionesDeclaradas, gestionesQuery.data])

  const completo = esEquipo ? !!patente.trim() : !!taxId.trim() && !!nombre.trim()

  async function guardar() {
    if (!completo) return
    setGuardando(true)
    setError(null)
    try {
      if (esEquipo) {
        // Las cadenas vacías no viajan: la columna es uuid, y "" no es "sin
        // declarar".
        const creado = await assetsApi.create({
          asset_type: assetType,
          license_plate: patente.trim(),
          ...(subtipoId ? { fleet_service_type_id: subtipoId } : {}),
          ...(gestionId ? { webcarga_operation_type_id: gestionId } : {}),
        })
        await carriersApi.assignAsset(carrierId, creado.id)
        setPatente(''); setSubtipoId('')
      } else {
        const creado = await driversApi.create({ tax_id: taxId.trim(), full_name: nombre.trim() })
        await carriersApi.assignDriver(carrierId, creado.id)
        setTaxId(''); setNombre('')
      }
      await onCreado()
      setAbierto(false)
    } catch (e) {
      // El mensaje del backend ya nombra a la persona cuando el RUT existe;
      // tragárselo era exactamente el bug del Diario.
      setError(e instanceof ApiError ? e.message : `No se pudo crear el ${tipo}`)
    } finally {
      setGuardando(false)
    }
  }

  if (!abierto) {
    // En modo controlado el disparador lo pone quien aloja: dibujar otro acá
    // daría dos botones para lo mismo en la misma tarjeta.
    if (controlado) return null
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 text-etiqueta font-semibold text-accent hover:underline"
      >
        <Plus size={12} /> {esEquipo ? 'Agregar equipo' : 'Agregar conductor'}
      </button>
    )
  }

  return (
    <div className="p-3 rounded-lg bg-bg-main space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {esEquipo ? (
          <>
            <select aria-label="Tipo de vehículo" value={assetType}
                    onChange={e => setAssetType(e.target.value as AssetType)}
                    className={`${INPUT} w-36 bg-white`}>
              {ASSET_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select aria-label="Subtipo" value={subtipoId}
                    onChange={e => setSubtipoId(e.target.value)}
                    className={`${INPUT} w-44 bg-white`}>
              <option value="">Subtipo (opcional)</option>
              {(subtiposQuery.data ?? []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select aria-label="Tipo de gestión" value={gestionId}
                    onChange={e => setGestionId(e.target.value)}
                    className={`${INPUT} w-44 bg-white`}>
              <option value="">Gestión (opcional)</option>
              {(gestionesQuery.data ?? []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <input aria-label="Patente" placeholder="Patente" value={patente}
                   onChange={e => setPatente(e.target.value)}
                   className={`${INPUT} w-28 font-mono uppercase`} />
          </>
        ) : (
          <>
            <input aria-label="RUT" placeholder="RUT" value={taxId}
                   onChange={e => setTaxId(e.target.value)}
                   className={`${INPUT} w-36 font-mono`} />
            <input aria-label="Nombre completo" placeholder="Nombre completo" value={nombre}
                   onChange={e => setNombre(e.target.value)}
                   className={`${INPUT} flex-1 min-w-40`} />
          </>
        )}
        <button type="button" onClick={guardar} disabled={guardando || !completo}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50">
          {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
        </button>
        <button type="button" onClick={() => { setAbierto(false); setError(null) }}
                aria-label="Cerrar" disabled={guardando}
                className="p-1.5 text-informativo hover:text-text-primary disabled:opacity-50">
          <X size={14} />
        </button>
      </div>

      {esEquipo && (
        <p className="text-etiqueta text-informativo">
          La gestión decide si el equipo entra al cierre de Tractoreo. Sin ella, sus
          conductores no aparecen en la cuadratura del día.
        </p>
      )}
      {error && <p className="text-etiqueta text-status-incidente">{error}</p>}
    </div>
  )
}
