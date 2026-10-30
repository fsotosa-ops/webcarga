'use client'

import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
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
import { Field, inputClass } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { PanelLateral } from '@/components/ui/PanelLateral'

/** Lo que devuelve el backend en un 409 al dar de alta un RUT que ya existe.
 *  Trae el id porque sin él el mensaje sería un callejón sin salida: la persona
 *  que ya existe suele ser exactamente la que se quería usar. */
export type ConductorYaExiste = { code: string; message: string; driver_id: string; full_name: string }

function conductorYaExiste(e: unknown): ConductorYaExiste | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const d = e.detail as Partial<ConductorYaExiste> | null
  return d && d.code === 'CONDUCTOR_YA_EXISTE' && d.driver_id ? (d as ConductorYaExiste) : null
}

const INPUT = `${inputClass()} w-full`

interface Props {
  /** La empresa a la que se va a asignar lo que se cree. `null`: se pregunta en
   *  el mismo formulario (el alta desde el Cierre, donde todavía no se sabe). */
  carrierId: string | null
  /** El nombre de esa empresa, para decir en el diálogo a quién queda asignado. */
  nombreEmpresa?: string
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
 *
 * POR QUÉ UN DIÁLOGO (30/10). Era una franja que se desplegaba dentro de la
 * página y se acomodaba al ancho de su lugar con container queries. En
 * Certificación, ese lugar era un ítem de una fila flex, que se mide por su
 * contenido, y un contenedor de consultas cuenta su contenido como vacío: el
 * alta quedaba del ancho del padding y los campos se montaban. Además los
 * campos no tenían etiqueta (solo placeholder) y los botones no eran del kit.
 * Crear un registro de tres o cuatro campos es un diálogo centrado (el
 * estándar de Salesforce, Linear y Stripe, y el `placement="center"` del kit):
 * se abre igual desde los cuatro anfitriones, sin depender de su ancho.
 */
export function AltaDeFlota({
  carrierId, nombreEmpresa, rutFijo, etiqueta, tipo, gestionesDeclaradas, prefill, abiertoAlInicio,
  abierto: abiertoProp, onAbiertoChange, onCreado, yaExiste: salida, etiquetaGuardar,
}: Props) {
  const controlado = abiertoProp !== undefined
  const [abiertoLocal, setAbiertoLocal] = useState(!!abiertoAlInicio)
  const abierto = controlado ? abiertoProp : abiertoLocal
  const setAbierto = (v: boolean) => {
    if (!controlado) setAbiertoLocal(v)
    onAbiertoChange?.(v)
  }
  const formId = useId()
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [yaExiste, setYaExiste] = useState<ConductorYaExiste | null>(null)

  const [taxId, setTaxId] = useState('')
  const [nombre, setNombre] = useState(tipo === 'conductor' ? prefill ?? '' : '')
  const { types: assetTypes } = useAssetTypes()
  // Sin elección, el primero del catálogo.
  const [chosenAssetType, setAssetType] = useState<AssetType>('')
  const assetType = chosenAssetType || assetTypes[0]?.code || ''
  // El subtipo es la carrocería (Furgón Seco, Sider…): un tracto no tiene; su tipo ya lo dice.
  const llevaCarroceria = assetTypes.find(t => t.code === assetType)?.is_power_unit === false
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
          ...(subtipoId && llevaCarroceria ? { fleet_service_type_id: subtipoId } : {}),
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

  // Cancelar descarta lo escrito: el componente sigue montado en el modo no
  // controlado, y sin esto lo de una persona aparecía al abrir para la
  // siguiente. Lo que llegó precargado (el nombre o la patente del TMS) vuelve.
  function cerrar() {
    setTaxId(''); setNombre(tipo === 'conductor' ? prefill ?? '' : '')
    setPatente(tipo === 'equipo' ? prefill ?? '' : '')
    setAssetType(''); setSubtipoId(''); setGestionId(''); setCdBaseId('')
    setEmpresa(null); setBusquedaEmpresa('')
    setError(null); setYaExiste(null)
    setAbierto(false)
  }

  const textoPorDefecto = esEquipo ? 'Agregar equipo' : 'Agregar conductor'

  return (
    <>
      {/* En modo controlado el disparador lo pone quien aloja: dibujar otro acá
          daría dos botones para lo mismo en la misma tarjeta. */}
      {!controlado && (
        <Button variant="link" size="sm" onClick={() => setAbierto(true)}>
          <Plus size={12} aria-hidden="true" /> {etiqueta ?? textoPorDefecto}
        </Button>
      )}
      {abierto && (
        <PanelLateral
          placement="center"
          titulo={etiqueta ?? textoPorDefecto}
          description={carrierId && nombreEmpresa ? `Queda asignado a ${nombreEmpresa}.` : undefined}
          onCerrar={cerrar}
          // Mientras guarda no se cierra: cerrar parecería cancelar algo que ya viajó.
          dismissible={!guardando}
          pie={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={cerrar} disabled={guardando}>Cancelar</Button>
              <Button variant="primary" type="submit" form={formId} disabled={guardando || !completo}>
                {guardando && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                {guardando ? 'Guardando…' : etiquetaGuardar ?? textoPorDefecto}
              </Button>
            </div>
          }
        >
          <form id={formId} onSubmit={e => { e.preventDefault(); void guardar() }} className="space-y-4">
            {esEquipo ? (
              <>
                <Field label="Patente" required>
                  {(id, d) => (
                    <input id={id} aria-describedby={d} value={patente} autoFocus
                           onChange={e => setPatente(e.target.value)}
                           className={`${INPUT} font-identificador uppercase`} />
                  )}
                </Field>
                <Field label="Tipo de vehículo">
                  {(id, d) => (
                    <select id={id} aria-describedby={d} value={assetType}
                            onChange={e => setAssetType(e.target.value as AssetType)} className={INPUT}>
                      {assetTypes.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                    </select>
                  )}
                </Field>
                {llevaCarroceria && (
                  <Field label="Carrocería" hint="Opcional.">
                    {(id, d) => (
                      <select id={id} aria-describedby={d} value={subtipoId}
                              onChange={e => setSubtipoId(e.target.value)} className={INPUT}>
                        <option value="">Sin definir</option>
                        {(subtiposQuery.data ?? []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    )}
                  </Field>
                )}
                <Field label="Tipo de gestión"
                       hint="Opcional. Decide si el equipo entra al cierre de Tractoreo: sin ella, sus conductores no aparecen en la cuadratura del día.">
                  {(id, d) => (
                    <select id={id} aria-describedby={d} value={gestionId}
                            onChange={e => setGestionId(e.target.value)} className={INPUT}>
                      <option value="">Sin definir</option>
                      {(gestionesQuery.data ?? []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  )}
                </Field>
              </>
            ) : (
              <>
                <Field label="RUT" required hint={rutFijo ? 'Lo informó el TMS.' : undefined}>
                  {(id, d) => rutFijo
                    ? <input id={id} aria-describedby={d} value={rutFijo} readOnly
                             className={`${INPUT} font-identificador bg-bg-main`} />
                    : <input id={id} aria-describedby={d} value={taxId} autoFocus placeholder="12.345.678-9"
                             onChange={e => setTaxId(e.target.value)}
                             className={`${INPUT} font-identificador`} />}
                </Field>
                <Field label="Nombre completo" required>
                  {(id, d) => (
                    <input id={id} aria-describedby={d} value={nombre} autoFocus={!!rutFijo}
                           placeholder="Como figura en su licencia"
                           onChange={e => setNombre(e.target.value)} className={INPUT} />
                  )}
                </Field>
                <Field label="Origen habitual" hint="Opcional. El CD desde el que suele salir; se puede definir después.">
                  {(id, d) => (
                    <select id={id} aria-describedby={d} value={cdBaseId}
                            onChange={e => setCdBaseId(e.target.value)} className={INPUT}>
                      <option value="">Sin definir</option>
                      {(cdsQuery.data?.data ?? []).map(cd => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
                    </select>
                  )}
                </Field>
              </>
            )}

            {carrierId === null && (
              <Field label="Empresa" hint="Sin empresa no entra al cierre del día, y mañana vuelve a bloquear.">
                {(id, d) => empresa ? (
                  <p id={id} className="flex items-center gap-2 text-dato text-text-primary">
                    <span className="font-semibold">{empresa.business_name}</span>
                    <Button variant="link" size="sm" onClick={() => { setEmpresa(null); setBusquedaEmpresa('') }}>
                      Cambiar
                    </Button>
                  </p>
                ) : (
                  <CarrierSearchPicker query={busquedaEmpresa} onQueryChange={setBusquedaEmpresa} onPick={setEmpresa}
                                       inputId={id} describedBy={d} placeholder="Buscar empresa…" maxHeightClass="max-h-40" />
                )}
              </Field>
            )}

            {error && <p role="alert" className="text-etiqueta text-status-incidente">{error}</p>}
            {/* La salida del callejón: si ya existe, usarla es lo que se venía a hacer. */}
            {yaExiste && salida && (
              <Button variant="secondary" className="w-full" disabled={guardando} onClick={() => usarExistente(yaExiste)}>
                {salida.accion(nombreLegible(yaExiste.full_name))}
              </Button>
            )}
          </form>
        </PanelLateral>
      )}
    </>
  )
}
