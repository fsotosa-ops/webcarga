'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronDown, ChevronRight, Eye, Loader2, Truck, User } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import { useCanEdit } from '@/hooks/useCanEdit'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { AccionesDeSujeto } from '@/components/compliance/AccionesDeSujeto'
import { AvisoDeFila } from '@/components/compliance/AvisoDeFila'
import { ConfirmarBaja } from '@/components/compliance/ConfirmarBaja'
import { PuenteALaBandeja } from '@/components/compliance/PuenteALaBandeja'
import { RenglonPendiente } from '@/components/compliance/RenglonPendiente'
import { FiltroDeEstado } from '@/components/compliance/FiltroDeEstado'
import { DocumentPreviewModal } from '@/components/dashboard/DocumentPreviewModal'
import { TransferModal } from '@/components/dashboard/TransferModal'
import { Cifra } from '@/components/ui/Cifra'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { STATUS_LABELS, STATUS_CLS } from '@/components/dashboard/TransporterCard'
import { COMPLIANCE_STATUS_CONFIG, formatExpiry } from '@/lib/compliance'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { agruparPorSujeto } from '@/lib/utils/agruparPorSujeto'
import type { EstadoDocumental, PendingComplianceRow } from '@/lib/types'
import type { Sujeto } from '@/lib/utils/agruparPorSujeto'

/** Las cuatro cifras, con el matiz de `<Cifra>` que le corresponde a cada
 *  una. "Requisitos" es la única que se apoya en `total` —exacto, viene del
 *  servidor— y por eso es también la única que se muestra siempre; las otras
 *  tres cuentan sobre las filas QUE LLEGARON, así que dependen de que
 *  llegaron TODAS (ver `completa` más abajo). */
const CIFRAS: { estado: EstadoDocumental; etiqueta: string; tono: 'normal' | 'atencion' | 'urgente' | 'resuelto' }[] = [
  { estado: 'todos',      etiqueta: 'requisitos',  tono: 'normal' },
  { estado: 'al_dia',     etiqueta: 'al día',      tono: 'resuelto' },
  { estado: 'falta',      etiqueta: 'faltan',      tono: 'urgente' },
  { estado: 'por_vencer', etiqueta: 'por vencer',  tono: 'atencion' },
]

/** Qué mostrar de `allRows` para cada botón del filtro — de la MISMA
 *  `urgencia` que ya trae cada fila, no un date-math nuevo del lado del
 *  cliente. 'falta' es "no está al día" (`urgencia !== 'AL_DIA'`), la MISMA
 *  definición que `pendiente_predicate` en el backend: ese predicado es
 *  exactamente el complemento de "al día" (`compliance.py`, rama `AL_DIA`
 *  del `CASE` de urgencia, ronda de arreglo 1). Escribir acá una lista de
 *  estados a mano sería la QUINTA copia del mismo criterio. */
function filasDelEstado(rows: PendingComplianceRow[], estado: EstadoDocumental): PendingComplianceRow[] {
  switch (estado) {
    case 'todos':      return rows
    case 'al_dia':     return rows.filter(r => r.urgencia === 'AL_DIA')
    case 'por_vencer': return rows.filter(r => r.urgencia === 'POR_VENCER')
    case 'falta':      return rows.filter(r => r.urgencia !== 'AL_DIA')
  }
}

/** Qué es cada sujeto y con qué icono se lo reconoce. El mockup dice
 *  "Tractocamión" para los vehículos; acá dice "Vehículo" porque el tipo de
 *  chasis no viaja en `/pending` y **inventarlo sería peor que ser genérico**. */
const SUJETO = {
  CARRIER: { icono: Building2, clase: null },
  DRIVER:  { icono: User,     clase: 'Conductor' },
  ASSET:   { icono: Truck,    clase: 'Vehículo' },
} as const

/** El avance del sujeto, en el orden en que se mira: lo resuelto primero, lo
 *  urgente al final. **Un cero no se escribe**: "0 por vencer" ocupa el mismo
 *  espacio que un dato y no dice nada. */
function avanceDelSujeto(filas: PendingComplianceRow[]): string {
  const al_dia     = filas.filter(f => f.urgencia === 'AL_DIA').length
  const por_vencer = filas.filter(f => f.urgencia === 'POR_VENCER').length
  const faltan     = filas.length - al_dia - por_vencer
  return [
    al_dia     && `${al_dia} al día`,
    por_vencer && `${por_vencer} por vencer`,
    faltan     && `${faltan} ${faltan === 1 ? 'falta' : 'faltan'}`,
  ].filter(Boolean).join(' · ')
}

/** La cabecera de un sujeto, tal como la dibuja el mockup acordado: icono,
 *  nombre, qué es y cuántos requisitos tiene, y su avance.
 *
 *  Es lo que hace visible que una empresa CONTIENE conductores y vehículos.
 *  Sin esto —un `<p>` con el nombre y los 93 requisitos desplegados debajo— la
 *  ficha medía 6,4 pantallas: el primer conductor caía bajo el pliegue y el
 *  primer vehículo 4,3 pantallas más abajo. El dato estaba y no se veía, que
 *  para quien mira es lo mismo que no estar.
 *
 *  Por eso el cuerpo va plegado y la cabecera carga el total: en el mockup
 *  cada sujeto declara "12 requisitos" y muestra UNA fila. */
function CabeceraDeSujeto({ sujeto, abierto, onAlternar, canEdit, nombreEmpresa, onTransferir, onDarDeBaja, accionesDeshabilitadas }: {
  sujeto:     Sujeto
  abierto:    boolean
  onAlternar: () => void
  canEdit:    boolean
  /** Con qué empresa dialoga el menú — "Dar de baja de {nombreEmpresa}". */
  nombreEmpresa: string
  onTransferir:  () => void
  onDarDeBaja:   () => void
  accionesDeshabilitadas?: boolean
}) {
  const { icono: Icono, clase } = SUJETO[sujeto.entityType]
  const cuenta = `${sujeto.filas.length} ${sujeto.filas.length === 1 ? 'requisito' : 'requisitos'}`
  // La empresa no se da de baja de sí misma: el menú es sólo para conductor
  // y vehículo, y sólo si se puede escribir.
  const puedeAccionar = canEdit && (sujeto.entityType === 'DRIVER' || sujeto.entityType === 'ASSET')
  return (
    <div className="w-full flex items-center gap-2 px-3 py-2 bg-accent/5 border-b border-border">
      {/* Contenedor, no botón: `AccionesDeSujeto` trae su propio <button> y un
       *  botón dentro de otro botón es HTML inválido — el clic se lo lleva el
       *  de afuera. Por eso el botón que pliega y el menú son hermanos. */}
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        className="flex-1 min-w-0 flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
      >
        {abierto
          ? <ChevronDown size={14} className="shrink-0 text-informativo" aria-hidden="true" />
          : <ChevronRight size={14} className="shrink-0 text-informativo" aria-hidden="true" />}
        <Icono size={14} className="shrink-0 text-informativo" aria-hidden="true" />
        <span className="text-dato font-semibold text-text-primary truncate">{sujeto.titulo}</span>
        <span className="shrink-0 text-etiqueta text-informativo">
          {clase ? `${clase} · ${cuenta}` : cuenta}
        </span>
        <span className="ml-auto shrink-0 text-etiqueta text-informativo tabular-nums">
          {avanceDelSujeto(sujeto.filas)}
        </span>
      </button>
      {puedeAccionar && (
        <AccionesDeSujeto
          nombreEmpresa={nombreEmpresa}
          onTransferir={onTransferir}
          onDarDeBaja={onDarDeBaja}
          deshabilitado={accionesDeshabilitadas}
        />
      )}
    </div>
  )
}

/** Los sujetos de una empresa, agrupados por lo que son. Sin esto, una empresa
 *  con 20 conductores son 21 filas de primer nivel y la lista vuelve a ser
 *  larga; con esto son **tres, sin importar el tamaño de la flota**: la
 *  empresa, Conductores y Vehículos.
 *
 *  La empresa NO se agrupa: es un sujeto único, y meterla en un grupo de uno
 *  sería un envoltorio que sólo agrega un clic. */
type Grupo = { tipo: PendingComplianceRow['entity_type']; sujetos: Sujeto[] }

function agruparPorTipo(sujetos: Sujeto[]): Grupo[] {
  const orden: PendingComplianceRow['entity_type'][] = ['CARRIER', 'DRIVER', 'ASSET']
  return orden
    .map(tipo => ({ tipo, sujetos: sujetos.filter(s => s.entityType === tipo) }))
    .filter(g => g.sujetos.length > 0)
}

const GRUPO = {
  DRIVER: { titulo: 'Conductores', uno: 'conductor', varios: 'conductores', icono: User },
  ASSET:  { titulo: 'Vehículos',   uno: 'vehículo',  varios: 'vehículos',   icono: Truck },
} as const

/** La cabecera de un grupo: cuántos sujetos, cuántos requisitos entre todos y
 *  el avance agregado. Contesta "¿cuántos conductores tiene y cómo van?" sin
 *  abrir nada, que es la pregunta con la que se llega a la ficha. */
function CabeceraDeGrupo({ grupo, abierto, onAlternar }: {
  grupo:      Grupo
  abierto:    boolean
  onAlternar: () => void
}) {
  const cfg = GRUPO[grupo.tipo as 'DRIVER' | 'ASSET']
  const filas = grupo.sujetos.flatMap(s => s.filas)
  const cuantos = grupo.sujetos.length
  const Icono = cfg.icono
  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-expanded={abierto}
      className="w-full flex items-center gap-2 px-3 py-2 bg-accent/5 border-b border-border text-left hover:bg-accent/10 transition-colors"
    >
      {abierto
        ? <ChevronDown size={14} className="shrink-0 text-informativo" aria-hidden="true" />
        : <ChevronRight size={14} className="shrink-0 text-informativo" aria-hidden="true" />}
      <Icono size={14} className="shrink-0 text-informativo" aria-hidden="true" />
      <span className="text-dato font-semibold text-text-primary">{cfg.titulo}</span>
      <span className="shrink-0 text-etiqueta text-informativo tabular-nums">
        {cuantos} {cuantos === 1 ? cfg.uno : cfg.varios}
        {' · '}
        {filas.length} {filas.length === 1 ? 'requisito' : 'requisitos'}
      </span>
      <span className="ml-auto shrink-0 text-etiqueta text-informativo tabular-nums">
        {avanceDelSujeto(filas)}
      </span>
    </button>
  )
}

/** Una fila AL DÍA: nombre, fecha, estado y "Ver". La otra mitad de la misma
 *  lista —`RenglonPendiente`, para todo lo que NO está al día— ya existe y no
 *  se reescribe; ésta es su variante para lo que ya no pide nada, que el
 *  cajón nunca necesitó mostrar porque sólo pide `estado='falta'`.
 *
 *  El badge sale de `status` y no de `urgencia` **porque acá `urgencia` ya no
 *  aporta**: la partición garantiza que todas estas filas son `AL_DIA`, y
 *  pintar "Al día" borraría la diferencia entre "Aprobado", "En revisión" y
 *  "Rechazado", que son cosas distintas. La contradicción que había —"Aprobado
 *  (manual)" sobre un documento vencido hace un año— no se arregló acá sino
 *  en la partición: esas filas ya no llegan a este componente. */
function FilaDocumento({ fila, viendo, avisoVer, onVer }: {
  fila:     PendingComplianceRow
  viendo:   boolean
  /** Por qué "Ver" no abrió nada, dicho en este renglón y con reintento. */
  avisoVer: string | null
  /** Ausente cuando no hay archivo que abrir. Estar al día no implica tenerlo:
   *  son 62 renglones repartidos en 37 de las 38 empresas activas —una
   *  aprobación manual sin evidencia adjunta es al día y no tiene blob—, y con
   *  un "Ver" incondicional cada uno abría un botón que sólo podía contestar
   *  que no hay nada. Lo mismo hace `RenglonPendiente` en la otra mitad de
   *  esta lista: el hecho lo dice `tiene_archivo`, no el estado. */
  onVer?:   () => void
}) {
  const cfg = COMPLIANCE_STATUS_CONFIG[fila.status]
  return (
    <div className="border-b border-border last:border-b-0 px-3 py-2 min-h-10">
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 truncate text-dato text-text-primary">{fila.document_name}</span>
        {fila.expiration_date && (
          <span className="shrink-0 text-etiqueta text-informativo tabular-nums">
            {formatExpiry(fila.expiration_date)}
          </span>
        )}
        <span className={`shrink-0 text-etiqueta font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
          {cfg.label}
        </span>
        {onVer && (
          <button
            type="button"
            onClick={onVer}
            disabled={viendo}
            className="shrink-0 inline-flex items-center gap-1.5 text-etiqueta font-semibold text-accion transition-opacity hover:opacity-70 disabled:opacity-50"
          >
            {viendo ? <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
            Ver
          </button>
        )}
      </div>
      {avisoVer && <AvisoDeFila mensaje={avisoVer} onReintentar={onVer} />}
    </div>
  )
}

/** La ficha de una empresa: su documentación, la de sus conductores y la de
 *  sus vehículos, juntas.
 *
 *  Es la pantalla que le da sentido a `estado='todos'` (Task 1): antes,
 *  Certificación sólo sabía enseñar lo que a una empresa le FALTA —el cajón
 *  pide `estado='falta'` a propósito, para no repetir 91 líneas dos veces—,
 *  así que los documentos que sí tiene cargados eran invisibles en todo el
 *  módulo. Medido: 32 de 34 empresas activas no tienen ni un documento
 *  cargado, y la única con 23 no los podía ver en ningún lado.
 *
 *  **UNA sola consulta** (ronda de arreglo 1): `estado='todos'`, una vez,
 *  con `limit: 500`. La primera versión pedía las cuatro variantes en
 *  paralelo porque `urgencia` sólo distinguía VENCIDO/POR_VENCER/FALTA — una
 *  fila al día cargaba el mismo `'FALTA'` que una que de verdad faltaba, así
 *  que no había forma de contar "al día" sin pedirlo aparte. Con la cuarta
 *  rama del CASE (`'AL_DIA'`, `compliance.py`), la única fuente de verdad
 *  para las cuatro cifras y para el filtro es la MISMA fila: cambiar de
 *  filtro es contar/elegir sobre lo que ya llegó, no una consulta nueva.
 *
 *  El agrupado por sujeto —CARRIER→DRIVER→ASSET, "De la empresa"— es el
 *  MISMO que el cajón: vive en `lib/utils/agruparPorSujeto`, no una segunda
 *  copia acá. */
export default function FichaEmpresaPage() {
  const { carrierId } = useParams<{ carrierId: string }>()
  const canEdit = useCanEdit()
  const subirDocumento = useSubirDocumento()
  const queryClient = useQueryClient()

  /** El sujeto que está por darse de baja o transferirse, si alguno. Uno solo
   *  a la vez: son diálogos, no hay forma de disparar dos a la vez. */
  const [confirmandoBaja, setConfirmandoBaja] = useState<Sujeto | null>(null)
  const [transfiriendo, setTransfiriendo] = useState<Sujeto | null>(null)

  /** La baja real, de un sujeto puntual: qué endpoint según lo que es, y
   *  después `invalidarCertificacion` — la lista se redibuja desde ahí, la
   *  única fuente. Nunca se quita la fila a mano: eso la convierte en un
   *  fantasma que parpadea si el pedido falla.
   *
   *  Ronda de arreglo 1: NO atrapa el error. `ConfirmarBaja` ya sabe qué
   *  hacer con uno —lo dice adentro, mantiene el diálogo abierto y ofrece
   *  reintentar sin cerrarse con Escape ni con el fondo (fix de la ronda
   *  anterior)— y atraparlo acá para mostrarlo en la tarjeta dejaba ese
   *  camino inalcanzable: código muerto. Un diálogo que se cierra solo ante
   *  un fallo se lee como "listo", que es exactamente lo que no pasó. */
  async function ejecutarBaja(s: Sujeto) {
    if (s.entityType === 'ASSET') await carriersApi.unassignAsset(carrierId, s.entityId)
    else await carriersApi.unassignDriver(carrierId, s.entityId)
    await invalidarCertificacion(queryClient)
  }

  async function confirmarBaja() {
    const s = confirmandoBaja
    if (!s) return
    // Si `ejecutarBaja` rechaza, esto no se alcanza: `ConfirmarBaja` atrapa
    // el rechazo, muestra el motivo y se queda abierto para reintentar.
    await ejecutarBaja(s)
    setConfirmandoBaja(null)
  }

  const [estadoFiltro, setEstadoFiltro] = useState<EstadoDocumental>('todos')
  /** El documento que se está mirando, sea cual sea su sujeto. Se guarda el
   *  id y no la fila completa: `/pending` nunca trae `file_url` firmada —
   *  firmarla ahí sería una llamada HTTP por archivo sobre una lista que
   *  puede traer 500— así que hay que volver a pedir el registro, ahora sí
   *  de a uno, cuando alguien elige "Ver". */
  const [viendoId, setViendoId] = useState<string | null>(null)
  const [viendoLabel, setViendoLabel] = useState('')

  const carrierQuery = useQuery({
    queryKey: ['carrier-detail', carrierId],
    queryFn: () => carriersApi.get(carrierId),
  })

  const todosQuery = useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId, undefined, 'todos'),
    queryFn: () => complianceApi.listPending({ carrierId, estado: 'todos', limit: 500 }),
  })

  const allRows = todosQuery.data?.rows ?? []
  const total = todosQuery.data?.total
  /** Contar sobre `allRows` sólo es honesto si llegaron TODAS. Si el
   *  servidor cortó por el límite, `allRows.length < total` — y en ese caso
   *  las tres cifras derivadas mienten por definición (cuentan una muestra,
   *  no el universo), así que no se muestran. "Requisitos" no depende de
   *  esto: sale de `total`, que el servidor calcula sobre TODO el universo
   *  sin importar cuántas filas mandó (`count(*) OVER()`, antes del LIMIT). */
  const completa = total != null && allRows.length >= total

  const rows = filasDelEstado(allRows, estadoFiltro)
  const sujetos = agruparPorSujeto(rows)

  /** Qué sujetos están abiertos. Se guarda lo que el usuario abrió, no lo que
   *  está cerrado: los sujetos cambian con el filtro y con la respuesta, y una
   *  lista de cerrados obligaría a mantenerla al día con filas que van y
   *  vienen.
   *
   *  **Todos arrancan plegados**, y eso incluye a la empresa. Se probó al revés
   *  —"De la empresa" abierta, por ser por donde conviene empezar— y medido en
   *  vivo ese bloque ocupa 571 px con sus 13 casilleros, así que empujaba la
   *  primera cabecera de conductor a 873 px: bajo el pliegue, en una pantalla
   *  de 689. Volvía a pasar lo que esta pantalla vino a arreglar — que no se
   *  viera que la empresa CONTIENE conductores y vehículos. El mockup abre ese
   *  bloque mostrando 2 filas, no 13.
   *
   *  La excepción es tener un solo sujeto: plegar existe para dejar ver el
   *  conjunto, y con un elemento no hay conjunto — sería llegar a una fila
   *  cerrada y nada más. */
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const estaAbierto = (s: Sujeto) => sujetos.length === 1 || abiertos.has(s.clave)
  const grupos = agruparPorTipo(sujetos)
  /** Los grupos comparten la bolsa de abiertos, con una clave que no puede
   *  chocar con la de un sujeto (`TIPO:uuid`). Un solo grupo se abre solo, por
   *  el mismo motivo que un solo sujeto: no hay conjunto que mostrar. */
  const grupoAbierto = (g: Grupo) => grupos.length === 1 || abiertos.has(`grupo:${g.tipo}`)
  const alternar = (clave: string) => setAbiertos(prev => {
    const siguiente = new Set(prev)
    if (siguiente.has(clave)) siguiente.delete(clave)
    else siguiente.add(clave)
    return siguiente
  })

  const conteos: Partial<Record<EstadoDocumental, number>> = {
    todos: total,
    ...(completa && {
      al_dia:     filasDelEstado(allRows, 'al_dia').length,
      falta:      filasDelEstado(allRows, 'falta').length,
      por_vencer: filasDelEstado(allRows, 'por_vencer').length,
    }),
  }

  /** El fleet-derivado (Ronda 85: "la flota manda cuando existe") viaja en
   *  cada fila de `/pending`, así que basta la primera. Sin filas —o con
   *  flota sin tipo declarado— no hay de dónde sacarlo: el chip lo dice en
   *  vez de desaparecer (concern de la ronda anterior: el vacío es uno de
   *  los cuatro estados obligatorios de pantalla, no una ausencia muda). No
   *  se reemplaza por la gestión DECLARADA de `carriersApi.get`: son dos
   *  fuentes del mismo concepto y mezclarlas mostraría un chip que no
   *  coincide con lo que el resto del módulo (el embudo) ya muestra. */
  const tipoOperacion = allRows[0]?.carrier_operation_types.join(' + ')

  const previewQuery = useQuery({
    queryKey: ['compliance-record-file', viendoId],
    queryFn: () => complianceApi.get(viendoId!),
    enabled: !!viendoId,
  })

  /** Por qué "Ver" no abrió nada. Los dos caminos terminan igual —el modal no
   *  se monta— y antes ninguno se decía: el spinner se apagaba y no pasaba
   *  absolutamente nada. "Falló" es uno de los cuatro estados obligatorios de
   *  pantalla y su regla es que no puede parecer que no pasó nada. */
  const avisoVer =
    !viendoId || previewQuery.isFetching     ? null
    : previewQuery.error                     ? 'No se pudo abrir el documento. Vuelve a intentarlo.'
    : previewQuery.data && !previewQuery.data.file_url
                                             ? 'Este registro no tiene un archivo que abrir.'
    : null

  function verDocumento(fila: PendingComplianceRow) {
    // Volver a tocar "Ver" sobre la MISMA fila no cambia el estado, así que
    // sin este refetch el botón quedaba muerto hasta recargar la página:
    // React Query no reintenta sola una consulta en error.
    if (viendoId === fila.id) {
      void previewQuery.refetch()
      return
    }
    setViendoId(fila.id)
    setViendoLabel(fila.document_name)
  }

  const subir = (fila: PendingComplianceRow, archivo: File, vencimiento?: string) =>
    subirDocumento(fila.id, archivo, vencimiento)

  if (carrierQuery.isPending) return <Estado tipo="cargando" />
  if (carrierQuery.error || !carrierQuery.data) {
    return (
      <Estado
        tipo="error"
        titulo="No se pudo cargar la empresa"
        detalle={carrierQuery.error instanceof Error ? carrierQuery.error.message : undefined}
      >
        <Link href="/dashboard/compliance" className="text-etiqueta font-semibold text-accion hover:opacity-70">
          Volver a Certificación
        </Link>
      </Estado>
    )
  }

  const carrier = carrierQuery.data

  return (
    <div className="p-4 md:p-6 space-y-4">
      <nav aria-label="Migas" className="flex items-center gap-1.5 text-etiqueta text-informativo">
        <Link href="/dashboard/compliance" className="transition-colors hover:text-accent">Empresas</Link>
        <ChevronRight size={12} aria-hidden="true" />
        <span className="text-text-primary font-semibold truncate">{carrier.business_name}</span>
      </nav>

      <EncabezadoDePagina
        titulo={carrier.business_name}
        bajada={
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <span className="font-identificador text-dato text-informativo">{carrier.tax_id}</span>
            <span className={`text-etiqueta font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[carrier.operational_status]}`}>
              {STATUS_LABELS[carrier.operational_status]}
            </span>
            {/* Sin el dato no se afirma nada. Guardado tambien por el error y
                no sólo por `isPending`: si la consulta falló no sabemos que el
                tipo esté sin determinar — no pudimos preguntarlo. */}
            {!todosQuery.isPending && !todosQuery.error && (
              tipoOperacion ? (
                <span className="text-etiqueta font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                  {tipoOperacion}
                </span>
              ) : (
                <span className="text-etiqueta font-medium px-2 py-0.5 rounded-full bg-accent/5 text-informativo">
                  Tipo de operación sin determinar
                </span>
              )
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CIFRAS.map(c => (
          <div key={c.estado} className="border border-border rounded-xl bg-white px-4 py-3">
            {/* `cargando` y el guión son dos mensajes distintos y esta pantalla
                necesita los dos: mientras la consulta viaja el dato TODAVÍA NO
                LLEGÓ —esqueleto—, y cuando la respuesta vino truncada las tres
                cifras derivadas NO SE VAN A MOSTRAR —guión—, porque contarlas
                sobre una lista incompleta sería mentir. Sin esta prop las
                cuatro negaban de entrada un dato que venía en camino. */}
            <Cifra
              valor={conteos[c.estado]}
              etiqueta={c.etiqueta}
              tono={c.tono}
              cargando={todosQuery.isPending}
            />
          </div>
        ))}
      </div>

      {!completa && total != null && (
        <p className="text-etiqueta text-informativo">
          Se listan los primeros {allRows.length} de {total} — Al día, Faltan y Por vencer no se
          muestran hasta tener todos, para no mostrar un conteo que no es.
        </p>
      )}

      <FiltroDeEstado valor={estadoFiltro} onCambiar={setEstadoFiltro} conteos={conteos} />

      <div className="space-y-3">
        {todosQuery.isPending && <Estado tipo="cargando" />}

        {todosQuery.error && (
          <Estado
            tipo="error"
            titulo="No se pudo cargar la documentación"
            detalle={todosQuery.error instanceof Error ? todosQuery.error.message : undefined}
          />
        )}

        {!todosQuery.isPending && !todosQuery.error && allRows.length === 0 && (
          /* Con `estado='todos'` esto NO es "nadie cargó nada": es que la
             empresa no tiene ni un `compliance_record`. Las empresas sin
             documentos sí tienen registros MISSING y nunca llegan acá; quien
             llega es la empresa a la que todavía no se le sembró el catálogo,
             y pedirle documentos sería decirle lo que no es — cargar no lo
             arregla. */
          <Estado
            tipo="vacio"
            titulo={`${carrier.business_name} todavía no tiene requisitos asignados`}
            detalle="Nadie le definió qué documentos necesita, así que no hay nada que pedir ni que mostrar. En cuanto tenga su catálogo de certificación, sus documentos van a aparecer acá agrupados por quién los necesita."
          />
        )}

        {/* Distinto del vacío de arriba: acá SÍ hay requisitos, sólo que
            ninguno queda del lado del filtro elegido. Decir "no tiene
            requisitos asignados" sería mentir sobre una empresa que sí los
            tiene. */}
        {!todosQuery.isPending && !todosQuery.error && allRows.length > 0 && rows.length === 0 && (
          <Estado
            tipo="vacio"
            titulo="No hay documentos en ese estado"
            detalle={`${carrier.business_name} tiene documentos, pero ninguno queda en este filtro. Elige "Todo" para verlos todos.`}
          />
        )}

        {!todosQuery.isPending && !todosQuery.error && rows.length > 0 && (() => {
          /* La tarjeta de un sujeto, para no escribirla dos veces: una vez
             suelta —la empresa— y otra dentro de su grupo. */
          const tarjeta = (s: Sujeto) => (
            <div key={s.clave} className="border border-border rounded-xl bg-white overflow-hidden">
              <CabeceraDeSujeto
                sujeto={s}
                abierto={estaAbierto(s)}
                onAlternar={() => alternar(s.clave)}
                canEdit={canEdit}
                nombreEmpresa={carrier.business_name}
                onTransferir={() => setTransfiriendo(s)}
                onDarDeBaja={() => setConfirmandoBaja(s)}
                accionesDeshabilitadas={confirmandoBaja?.clave === s.clave || transfiriendo?.clave === s.clave}
              />
              {/* La partición es la MISMA `urgencia` que reparte el filtro de
                  arriba, no una segunda lectura por `status`. Con `status` la
                  lista se contradecía con el filtro que la contenía: los 9
                  registros vencidos por fecha del módulo están en
                  `APPROVED_MANUAL`, así que aparecían bajo "Falta" rotulados
                  "Aprobado (manual)". Y al revés, un `EXPIRED` —que TIENE
                  archivo— iba al renglón de carga y su documento quedaba
                  invisible en la pantalla que existe para hacerlo visible.
                  Que hay archivo o no lo dice `tiene_archivo`, que es el hecho;
                  del status no se deduce. */}
              {estaAbierto(s) && s.filas.map(f => (
                f.urgencia === 'AL_DIA'
                  ? (
                    <FilaDocumento
                      key={f.id}
                      fila={f}
                      viendo={viendoId === f.id && previewQuery.isFetching}
                      avisoVer={viendoId === f.id ? avisoVer : null}
                      onVer={f.tiene_archivo ? () => verDocumento(f) : undefined}
                    />
                  )
                  : (
                    <RenglonPendiente
                      key={f.id}
                      fila={f}
                      puedeEditar={canEdit}
                      onSubir={subir}
                      onVer={f.tiene_archivo ? () => verDocumento(f) : undefined}
                      viendo={viendoId === f.id && previewQuery.isFetching}
                      avisoVer={viendoId === f.id ? avisoVer : null}
                    />
                  )
              ))}
            </div>
          )
          return grupos.map(g => g.tipo === 'CARRIER'
            ? g.sujetos.map(tarjeta)
            : (
              <div key={g.tipo} className="border border-border rounded-xl bg-white overflow-hidden">
                <CabeceraDeGrupo
                  grupo={g}
                  abierto={grupoAbierto(g)}
                  onAlternar={() => alternar(`grupo:${g.tipo}`)}
                />
                {grupoAbierto(g) && (
                  <div className="p-2 space-y-2 bg-bg-main">{g.sujetos.map(tarjeta)}</div>
                )}
              </div>
            ))
        })()}

        <PuenteALaBandeja carrierId={carrierId} carrierName={carrier.business_name} />
      </div>

      {viendoId && previewQuery.data?.file_url && (
        <DocumentPreviewModal
          label={viendoLabel}
          url={previewQuery.data.file_url}
          canEdit={canEdit}
          onClose={() => setViendoId(null)}
        />
      )}

      <ConfirmarBaja
        // Sin trampa de foco, el ⋮ de otro sujeto sigue disponible mientras
        // este diálogo está abierto: se puede pasar de un sujeto a otro sin
        // cerrar. `abierto` no cambia en ese caso, así que el efecto interno
        // que resetea enviando/error (depende sólo de `abierto`) no se
        // reactiva. La `key` por sujeto fuerza el remount — mismo patrón que
        // el resto de los "draft que no se resincroniza" de este repo.
        key={confirmandoBaja?.clave}
        abierto={!!confirmandoBaja}
        nombreSujeto={confirmandoBaja?.titulo ?? ''}
        nombreEmpresa={carrier.business_name}
        // Sobre `allRows`, no sobre `confirmandoBaja.filas`: esas son las
        // filas del sujeto que además pasaron el filtro de estado activo
        // (`rows = filasDelEstado(allRows, estadoFiltro)`), así que con el
        // filtro en "Falta" un conductor al día contaba 0 documentos y el
        // diálogo omitía la frase que existe para decir justamente eso.
        cuantosDocumentos={confirmandoBaja
          ? allRows.filter(r =>
              r.entity_type === confirmandoBaja.entityType &&
              r.entity_id === confirmandoBaja.entityId &&
              r.tiene_archivo,
            ).length
          : 0}
        onCancelar={() => setConfirmandoBaja(null)}
        onConfirmar={confirmarBaja}
      />

      {transfiriendo && (
        <TransferModal
          open
          title={`Transferir a ${transfiriendo.titulo}`}
          currentCarrierId={carrierId}
          onClose={() => setTransfiriendo(null)}
          onTransfer={async (destino) => {
            const s = transfiriendo
            if (s.entityType === 'ASSET') await carriersApi.assignAsset(destino, s.entityId)
            else await carriersApi.assignDriver(destino, s.entityId)
            await invalidarCertificacion(queryClient)
          }}
        />
      )}
    </div>
  )
}
