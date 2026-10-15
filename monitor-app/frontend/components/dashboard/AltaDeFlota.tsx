'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { driversApi } from '@/lib/api/drivers'
import { assetsApi } from '@/lib/api/assets'
import { carriersApi } from '@/lib/api/carriers'
import { locationsApi } from '@/lib/api/locations'
import { taxonomiesApi } from '@/lib/api/config'
import { taxonomyKey } from '@/lib/queries/taxonomies'
import { ApiError } from '@/lib/api/client'
import { CarrierSearchPicker, type CarrierSearchResult } from './CarrierSearchPicker'
import { useAssetTypes } from '@/hooks/useAssetTypes'
import type { AssetType, ManagementType } from '@/lib/types'
import { nombreLegible } from '@/lib/utils/nombres'

/** Lo que devuelve el backend en un 409 al dar de alta un RUT que ya existe.
 *  Trae el id porque sin él el mensaje sería un callejón sin salida: la persona
 *  que ya existe suele ser exactamente la que se quería usar. */
export type ConductorYaExiste = { code: string; message: string; driver_id: string; full_name: string }

function conductorYaExiste(e: unknown): ConductorYaExiste | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const d = e.detail as Partial<ConductorYaExiste> | null
  return d && d.code === 'CONDUCTOR_YA_EXISTE' && d.driver_id ? (d as ConductorYaExiste) : null
}

// En un contenedor angosto (el popover del Monitor) cada campo toma la fila
// entera; en uno ancho (la ficha) van en una sola fila. Container query: el
// alta se adapta a donde la pongan, sin una variante por anfitrión.
const INPUT = 'text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 @max-md:basis-full @max-md:w-full'

interface Props {
  /** La empresa a la que se va a asignar lo que se cree. `null`: se pregunta en
   *  el mismo formulario (el alta desde el Cierre, donde todavía no se sabe). */
  carrierId: string | null
  /** El RUT ya conocido, que no se edita: el que el TMS informó y por el que el
   *  viaje está bloqueando el cierre (alta desde el Cierre, F-23). */
  rutFijo?: string
  /** El texto del disparador, si no es el de siempre. */
  etiqueta?: string
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
  /** Recibe la empresa a la que quedó asignado (o `null`), para refrescar su
   *  roster, y lo creado, para quien tiene que seguir con él (el Monitor le
   *  asigna los viajes). Si rechaza, el error se muestra acá y el alta no se
   *  cierra. */
  onCreado: (carrierId: string | null, creado: { id: string; full_name?: string }) => Promise<void> | void
  /** Solo conductores. Con ella, un 409 "ese RUT ya existe" ofrece una salida
   *  en vez de un callejón sin salida. Qué hace la salida lo decide quien aloja
   *  el alta: el Monitor asigna los viajes a esa persona; el Cierre solo se
   *  relee, porque el pendiente era que no estuviera registrada. */
  yaExiste?: {
    /** El texto del botón, con el nombre de quien ya existe. */
    accion: (nombre: string) => string
    usar: (existente: ConductorYaExiste) => Promise<void> | void
  }
  /** El texto del botón de guardar, si no es "Guardar". */
  etiquetaGuardar?: string
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
  carrierId, rutFijo, etiqueta, tipo, gestionesDeclaradas, prefill, abiertoAlInicio,
  abierto: abiertoProp, onAbiertoChange, onCreado, yaExiste: salida, etiquetaGuardar,
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
  const [yaExiste, setYaExiste] = useState<ConductorYaExiste | null>(null)

  const [taxId, setTaxId] = useState('')
  const [nombre, setNombre] = useState(tipo === 'conductor' ? prefill ?? '' : '')
  const { types: assetTypes } = useAssetTypes()
  // Sin elección, el primero del catálogo.
  const [chosenAssetType, setAssetType] = useState<AssetType>('')
  const assetType = chosenAssetType || assetTypes[0]?.code || ''
  const [patente, setPatente] = useState(tipo === 'equipo' ? prefill ?? '' : '')
  const [subtipoId, setSubtipoId] = useState('')
  const [gestionId, setGestionId] = useState('')
  const [cdBaseId, setCdBaseId] = useState('')
  // Sin empresa de antemano, se elige acá. Sin empresa no entra al cierre.
  const [empresa, setEmpresa] = useState<CarrierSearchResult | null>(null)
  const [busquedaEmpresa, setBusquedaEmpresa] = useState('')
  const empresaId = carrierId ?? empresa?.id ?? null
  const rut = rutFijo ?? taxId.trim()

  const esEquipo = tipo === 'equipo'

  const subtiposQuery = useQuery({
    queryKey: taxonomyKey('FLEET_SERVICE_TYPE'),
    queryFn: () => taxonomiesApi.list('FLEET_SERVICE_TYPE'),
    enabled: abierto && esEquipo,
    staleTime: 5 * 60_000,
  })
  const gestionesQuery = useQuery({
    queryKey: taxonomyKey('WEBCARGA_OPERATION_TYPE'),
    queryFn: () => taxonomiesApi.list('WEBCARGA_OPERATION_TYPE'),
    enabled: abierto && esEquipo,
    staleTime: 5 * 60_000,
  })
  // Origen habitual (HU-28), sólo para conductores: el CD se le asigna a la persona,
  // no a la patente, porque puede cambiar de tracto cuando queda en panne.
  const cdsQuery = useQuery({
    queryKey: ['origenes'],
    queryFn: () => locationsApi.list({ origin: true, operational_status: 'ACTIVE', limit: 200 }),
    enabled: abierto && !esEquipo,
    staleTime: 5 * 60_000,
  })

  // La gestión que la empresa declaró al crearse preselecciona la del primer
  // vehículo. NO se toca el subtipo (ver arriba). Sólo propone: el selector
  // sigue ofreciendo todas las opciones, y no pisa una elección ya hecha.
  useEffect(() => {
    if (!abierto || !esEquipo) return
    if (gestionesDeclaradas?.length !== 1) return
    // Por código, no por etiqueta: renombrarla en Configuración no rompe la propuesta.
    const propuesta = (gestionesQuery.data ?? []).find(t => t.code === gestionesDeclaradas[0])
    if (propuesta) setGestionId(v => v || propuesta.id)
  }, [abierto, esEquipo, gestionesDeclaradas, gestionesQuery.data])

  const completo = esEquipo ? !!patente.trim() : !!rut && !!nombre.trim()

  async function guardar() {
    if (!completo) return
    setGuardando(true)
    setError(null)
    setYaExiste(null)
    try {
      let creado: { id: string; full_name?: string }
      if (esEquipo) {
        // Las cadenas vacías no viajan: la columna es uuid, y "" no es "sin
        // declarar".
        creado = await assetsApi.create({
          asset_type: assetType,
          license_plate: patente.trim(),
          ...(subtipoId ? { fleet_service_type_id: subtipoId } : {}),
          ...(gestionId ? { webcarga_operation_type_id: gestionId } : {}),
        })
        if (empresaId) await carriersApi.assignAsset(empresaId, creado.id)
        setPatente(''); setSubtipoId('')
      } else {
        creado = await driversApi.create({
          tax_id: rut, full_name: nombre.trim(),
          // Opcional: se puede enrolar a alguien antes de saber de qué CD sale.
          ...(cdBaseId ? { home_location_id: cdBaseId } : {}),
        })
        if (empresaId) await carriersApi.assignDriver(empresaId, creado.id)
        setTaxId(''); setNombre(''); setCdBaseId('')
      }
      await onCreado(empresaId, creado)
      setAbierto(false)
    } catch (e) {
      // El mensaje del backend ya nombra a la persona cuando el RUT existe;
      // tragárselo era exactamente el bug del Diario.
      setYaExiste(salida ? conductorYaExiste(e) : null)
      setError(e instanceof ApiError ? e.message : `No se pudo crear el ${tipo}`)
    } finally {
      setGuardando(false)
    }
  }

  async function usarExistente(existente: ConductorYaExiste) {
    setGuardando(true)
    setError(null)
    try {
      await salida?.usar(existente)
      setYaExiste(null)
      setAbierto(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar. Vuelve a intentarlo.')
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
        <Plus size={12} /> {etiqueta ?? (esEquipo ? 'Agregar equipo' : 'Agregar conductor')}
      </button>
    )
  }

  return (
    <div className="@container p-3 rounded-lg bg-bg-main">
      {/* Un solo contenedor: en angosto, el orden pone los botones al final,
          después de la empresa, como en cualquier formulario. */}
      <div className="flex items-center gap-2 flex-wrap">
        {esEquipo ? (
          <>
            <select aria-label="Tipo de vehículo" value={assetType}
                    onChange={e => setAssetType(e.target.value as AssetType)}
                    className={`${INPUT} w-36 bg-white`}>
              {assetTypes.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
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
            {rutFijo
              ? <span className={`${INPUT} w-36 font-mono bg-white`} aria-label="RUT">{rutFijo}</span>
              : <input aria-label="RUT" placeholder="RUT" value={taxId}
                       onChange={e => setTaxId(e.target.value)}
                       className={`${INPUT} w-36 font-mono`} />}
            <input aria-label="Nombre completo" placeholder="Nombre completo" value={nombre}
                   onChange={e => setNombre(e.target.value)}
                   className={`${INPUT} flex-1 min-w-40`} />
            <select aria-label="Origen habitual" value={cdBaseId}
                    onChange={e => setCdBaseId(e.target.value)}
                    className={`${INPUT} w-44`}>
              <option value="">Origen habitual (opcional)</option>
              {(cdsQuery.data?.data ?? []).map(cd => (
                <option key={cd.id} value={cd.id}>{cd.name}</option>
              ))}
            </select>
          </>
        )}
        <div className="flex items-center gap-2 @max-md:order-last">
          <button type="button" onClick={guardar} disabled={guardando || !completo}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50">
            {guardando ? <Loader2 size={13} className="animate-spin" aria-label="Guardando" /> : etiquetaGuardar ?? 'Guardar'}
          </button>
          <button type="button" onClick={() => { setAbierto(false); setError(null) }}
                  aria-label="Cerrar" disabled={guardando}
                  className="p-1.5 text-informativo hover:text-text-primary disabled:opacity-50">
            <X size={14} />
          </button>
        </div>

      {carrierId === null && (
        empresa ? (
          <p className="basis-full flex items-center gap-1.5 text-etiqueta text-text-primary">
            Empresa: <span className="font-semibold">{empresa.business_name}</span>
            <button type="button" onClick={() => { setEmpresa(null); setBusquedaEmpresa('') }}
                    className="text-informativo underline hover:text-text-primary">cambiar</button>
          </p>
        ) : (
          <div className="basis-full space-y-0.5">
            <CarrierSearchPicker query={busquedaEmpresa} onQueryChange={setBusquedaEmpresa} onPick={setEmpresa}
                                 placeholder="Buscar empresa…" size="sm" maxHeightClass="max-h-28" />
            <p className="text-etiqueta text-informativo">Sin empresa no entra al cierre, y mañana vuelve a bloquear.</p>
          </div>
        )
      )}
      {esEquipo && (
        <p className="basis-full text-etiqueta text-informativo">
          La gestión decide si el equipo entra al cierre de Tractoreo. Sin ella, sus
          conductores no aparecen en la cuadratura del día.
        </p>
      )}
      {error && <p className="basis-full @max-md:order-1 text-etiqueta text-status-incidente">{error}</p>}
      {/* La salida del callejón: si ya existe, usarla es lo que se venía a hacer. */}
      {yaExiste && salida && (
        <button type="button" disabled={guardando} onClick={() => usarExistente(yaExiste)}
                className="basis-full @max-md:order-1 rounded-lg border border-status-incidente/35 bg-white px-3 py-1.5 text-etiqueta font-medium text-status-incidente hover:bg-status-incidente/10 disabled:opacity-50">
          {salida.accion(nombreLegible(yaExiste.full_name))}
        </button>
      )}
      </div>
    </div>
  )
}
