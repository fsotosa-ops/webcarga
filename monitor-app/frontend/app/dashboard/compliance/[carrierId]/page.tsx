'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Building2, ChevronDown, ChevronRight, Eye, Loader2, Truck, User } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { useCanEdit } from '@/hooks/useCanEdit'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { AccionesDeSujeto } from '@/components/compliance/AccionesDeSujeto'
import { AvisoDeFila } from '@/components/compliance/AvisoDeFila'
import { ConfirmarBaja } from '@/components/compliance/ConfirmarBaja'
import { PuenteALaBandeja } from '@/components/compliance/PuenteALaBandeja'
import { RenglonPendiente } from '@/components/compliance/RenglonPendiente'
import { ExpirationDateCell } from '@/components/dashboard/ExpirationDateCell'
import { FiltroDeEstado } from '@/components/compliance/FiltroDeEstado'
import { DocumentPreviewModal } from '@/components/dashboard/DocumentPreviewModal'
import { TransferModal } from '@/components/dashboard/TransferModal'
import { Cifra } from '@/components/ui/Cifra'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { BajaReasonModal } from '@/components/dashboard/BajaReasonModal'
import { STATUS_LABELS, STATUS_CLS } from '@/components/dashboard/TransporterCard'
import { COMPLIANCE_STATUS_CONFIG, formatExpiry } from '@/lib/compliance'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { claveDeSujeto, tituloDeSujeto } from '@/lib/utils/agruparPorSujeto'
import { ASSET_TYPE_LABELS } from '@/lib/types'
import type { ComplianceSummarySubject, EstadoDocumental, PendingComplianceRow } from '@/lib/types'

/** Las cuatro cifras, con el matiz de `<Cifra>` que le corresponde a cada
 *  una. Las cuatro salen del mismo resumen del servidor (`totales`), que
 *  particiona sobre TODA la empresa. A diferencia de `/pending`, el resumen
 *  SÍ puede venir truncado (`SUMMARY_LIMIT` entra como LIMIT de la CTE,
 *  antes del GROUP BY): `resumen.completo` es la señal, y mientras sea
 *  `false` la pantalla no muestra estas cuatro cifras — ver `conteos` más
 *  abajo (hallazgo 3 de la revisión final, perf/compresion-y-resumen). */
const CIFRAS: { estado: EstadoDocumental; etiqueta: string; tono: 'normal' | 'atencion' | 'urgente' | 'resuelto' }[] = [
  { estado: 'todos',      etiqueta: 'requisitos',  tono: 'normal' },
  { estado: 'al_dia',     etiqueta: 'al día',      tono: 'resuelto' },
  { estado: 'falta',      etiqueta: 'faltan',      tono: 'urgente' },
  { estado: 'por_vencer', etiqueta: 'por vencer',  tono: 'atencion' },
]

/** Reparte las filas de UN sujeto (ya traídas con `estado='todos'`) según el
 *  mismo criterio EXCLUSIVO que usa el resumen del servidor
 *  (`ComplianceSummaryCounts.falta` = FALTA + VENCIDO, sin lo por vencer).
 *
 *  Es a propósito la MISMA partición que `tieneAlgoDelEstado` usa sobre el
 *  resumen, más abajo — no la de `pendiente_predicate`/`GET
 *  /pending?estado=falta`, que es inclusiva (incluye lo por vencer). Antes
 *  el filtro pedía de nuevo al servidor con ese segundo criterio, y el chip
 *  "Falta" (que lee el balde exclusivo del resumen) terminaba mostrando un
 *  número distinto al de la lista que su propio clic abría — hallazgo 1 de
 *  la revisión final: con 1 al día, 1 por vencer y 1 falta, el chip decía
 *  "Falta 1" y la lista mostraba 2. Con una sola definición de cada balde,
 *  usada acá y en el resumen, esa contradicción no puede existir. */
function filasDelEstado(filas: PendingComplianceRow[], estado: EstadoDocumental): PendingComplianceRow[] {
  switch (estado) {
    case 'todos':      return filas
    case 'al_dia':     return filas.filter(f => f.urgencia === 'AL_DIA')
    case 'por_vencer': return filas.filter(f => f.urgencia === 'POR_VENCER')
    case 'falta':      return filas.filter(f => f.urgencia === 'FALTA' || f.urgencia === 'VENCIDO')
  }
}

/** Qué es cada sujeto y con qué icono se lo reconoce.
 *
 *  Los vehículos no llevan `clase`: la palabra genérica "Vehículo" la
 *  reemplazan sus insignias, que dicen el chasis y la carrocería de verdad
 *  (`InsigniasDeVehiculo`). Decía "Vehículo" porque el tipo no viajaba en el
 *  resumen y ser genérico era mejor que inventarlo; ahora viaja. */
const SUJETO = {
  CARRIER: { icono: Building2, clase: null },
  DRIVER:  { icono: User,     clase: 'Conductor' },
  ASSET:   { icono: Truck,    clase: null },
} as const

/** Qué es este vehículo: el chasis y, si la tiene, la carrocería.
 *
 *  Son dos insignias porque son dos datos con disponibilidad distinta —el
 *  chasis lo tienen los 124 vehículos, la carrocería sólo las ramplas—, así
 *  que un tractocamión muestra una y una rampla dos. No se rellena la que
 *  falta: un valor inventado ahí diría que el dato existe.
 *
 *  El color de la carrocería sale del catálogo (`app.status_taxonomies`), no
 *  de una tabla en el frontend, y por eso va en `style` — es dato, no
 *  decisión de diseño. El del chasis sí es del sistema visual. */
function InsigniasDeVehiculo({ sujeto }: { sujeto: ComplianceSummarySubject }) {
  if (sujeto.entity_type !== 'ASSET') return null
  return (
    <>
      {sujeto.asset_type && (
        <span className="shrink-0 text-etiqueta font-semibold px-1.5 py-0.5 rounded-full bg-accent/10 text-informativo">
          {ASSET_TYPE_LABELS[sujeto.asset_type] ?? sujeto.asset_type}
        </span>
      )}
      {sujeto.fleet_service_type_label && (
        <span
          className="shrink-0 text-etiqueta font-semibold px-1.5 py-0.5 rounded-full"
          style={{
            backgroundColor: sujeto.fleet_service_type_bg_color ?? undefined,
            color:           sujeto.fleet_service_type_text_color ?? undefined,
          }}
        >
          {sujeto.fleet_service_type_label}
        </span>
      )}
    </>
  )
}

/** El avance de un sujeto, tal como lo particiona el servidor: `al_dia`,
 *  `por_vencer` y `falta` ya suman `todos` (`falta` agrupa VENCIDO y FALTA —
 *  ver `ComplianceSummaryCounts`), así que acá no se vuelve a contar nada,
 *  sólo se ordena para mostrar. **Un cero no se escribe**: "0 por vencer"
 *  ocupa el mismo espacio que un dato y no dice nada. */
function avanceDeCuentas(c: { al_dia: number; por_vencer: number; falta: number }): string {
  return [
    c.al_dia     && `${c.al_dia} al día`,
    c.por_vencer && `${c.por_vencer} por vencer`,
    c.falta      && `${c.falta} ${c.falta === 1 ? 'falta' : 'faltan'}`,
  ].filter(Boolean).join(' · ')
}

/** La cabecera de un sujeto, tal como la dibuja el mockup acordado: icono,
 *  nombre, qué es y cuántos requisitos tiene, y su avance.
 *
 *  Las cifras salen del resumen (`sujeto.todos`/`al_dia`/`por_vencer`/`falta`),
 *  no de contar filas: el detalle de este sujeto puede no haberse pedido
 *  todavía —se pide recién al desplegarlo, en `TarjetaDeSujeto`—, y la
 *  cabecera tiene que poder mostrar su avance sin esperarlo. */
function CabeceraDeSujeto({ sujeto, abierto, onAlternar, canEdit, nombreEmpresa, onTransferir, onDarDeBaja, accionesDeshabilitadas }: {
  sujeto:     ComplianceSummarySubject
  abierto:    boolean
  onAlternar: () => void
  canEdit:    boolean
  /** Con qué empresa dialoga el menú — "Dar de baja de {nombreEmpresa}". */
  nombreEmpresa: string
  onTransferir:  () => void
  onDarDeBaja:   () => void
  accionesDeshabilitadas?: boolean
}) {
  const { icono: Icono, clase } = SUJETO[sujeto.entity_type]
  const cuenta = `${sujeto.todos} ${sujeto.todos === 1 ? 'requisito' : 'requisitos'}`
  // La empresa no se da de baja de sí misma: el menú es sólo para conductor
  // y vehículo, y sólo si se puede escribir.
  const puedeAccionar = canEdit && (sujeto.entity_type === 'DRIVER' || sujeto.entity_type === 'ASSET')
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
        <span className="text-dato font-semibold text-text-primary truncate">{tituloDeSujeto(sujeto)}</span>
        <InsigniasDeVehiculo sujeto={sujeto} />
        <span className="shrink-0 text-etiqueta text-informativo">
          {clase ? `${clase} · ${cuenta}` : cuenta}
        </span>
        <span className="ml-auto shrink-0 text-etiqueta text-informativo tabular-nums">
          {avanceDeCuentas(sujeto)}
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
type Grupo = { tipo: ComplianceSummarySubject['entity_type']; sujetos: ComplianceSummarySubject[] }

function agruparPorTipo(sujetos: ComplianceSummarySubject[]): Grupo[] {
  const orden: ComplianceSummarySubject['entity_type'][] = ['CARRIER', 'DRIVER', 'ASSET']
  return orden
    .map(tipo => ({ tipo, sujetos: sujetos.filter(s => s.entity_type === tipo) }))
    .filter(g => g.sujetos.length > 0)
}

const GRUPO = {
  DRIVER: { titulo: 'Conductores', uno: 'conductor', varios: 'conductores', icono: User },
  ASSET:  { titulo: 'Vehículos',   uno: 'vehículo',  varios: 'vehículos',   icono: Truck },
} as const

/** La cabecera de un grupo: cuántos sujetos, cuántos requisitos entre todos y
 *  el avance agregado. Contesta "¿cuántos conductores tiene y cómo van?" sin
 *  abrir nada, que es la pregunta con la que se llega a la ficha. Suma las
 *  cifras que cada sujeto ya trae del resumen — no cuenta filas. */
function CabeceraDeGrupo({ grupo, abierto, onAlternar }: {
  grupo:      Grupo
  abierto:    boolean
  onAlternar: () => void
}) {
  const cfg = GRUPO[grupo.tipo as 'DRIVER' | 'ASSET']
  const cuantos = grupo.sujetos.length
  const requisitos = grupo.sujetos.reduce((acc, s) => acc + s.todos, 0)
  const cuentas = grupo.sujetos.reduce(
    (acc, s) => ({ al_dia: acc.al_dia + s.al_dia, por_vencer: acc.por_vencer + s.por_vencer, falta: acc.falta + s.falta }),
    { al_dia: 0, por_vencer: 0, falta: 0 },
  )
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
        {requisitos} {requisitos === 1 ? 'requisito' : 'requisitos'}
      </span>
      <span className="ml-auto shrink-0 text-etiqueta text-informativo tabular-nums">
        {avanceDeCuentas(cuentas)}
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
function FilaDocumento({ fila, viendo, avisoVer, onVer, puedeEditar, onFechaCorregida }: {
  fila:     PendingComplianceRow
  viendo:   boolean
  /** Por qué "Ver" no abrió nada, dicho en este renglón y con reintento. */
  avisoVer: string | null
  /** Corregir la fecha es lo único que todavía obligaba a salir a Empresas
   *  (HU-26). El archivo está bien; lo que se escribió mal es un dato. */
  puedeEditar: boolean
  onFechaCorregida: () => void
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
        {/* `ExpirationDateCell` ya existía y ya estaba probada: vivía sólo en
            la pestaña Documentos del módulo Empresas, o sea que corregir una
            fecha obligaba a salir de Certificación. Se monta, no se
            reescribe. */}
        <span className="shrink-0 tabular-nums">
          <ExpirationDateCell
            recordId={fila.id}
            value={fila.expiration_date ?? null}
            required={fila.expiration_policy === 'REQUIRED'}
            canEdit={puedeEditar}
            onSaved={onFechaCorregida}
          />
        </span>
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

/** La tarjeta de un sujeto: su cabecera (del resumen, siempre disponible) y,
 *  si está desplegado, sus filas de detalle — pedidas EN ESE MOMENTO, no
 *  antes.
 *
 *  Es un componente propio y no una función que arma JSX dentro de un
 *  `.map()`: cada tarjeta necesita su propio `useQuery` para las filas del
 *  sujeto, y llamar un hook desde una función invocada a mano (no montada
 *  como elemento) rompe las reglas de hooks — el número de sujetos cambia
 *  con el filtro, así que el número de llamadas también cambiaría. */
function TarjetaDeSujeto({
  sujeto, carrierId, estadoFiltro, abierto, onAlternar, canEdit, nombreEmpresa,
  onTransferir, onDarDeBaja, accionesDeshabilitadas,
  viendoId, avisoVer, previewFetching, onVer, subir, onFechaCorregida,
}: {
  sujeto:        ComplianceSummarySubject
  carrierId:     string
  estadoFiltro:  EstadoDocumental
  abierto:       boolean
  onAlternar:    () => void
  canEdit:       boolean
  /** Tras corregir una fecha hay que repedir: el resumen del servidor trae los
   *  conteos, y una fecha nueva puede mover un documento de balde. */
  onFechaCorregida: () => void
  nombreEmpresa: string
  onTransferir:  () => void
  onDarDeBaja:   () => void
  accionesDeshabilitadas?: boolean
  viendoId:        string | null
  avisoVer:        string | null
  previewFetching: boolean
  onVer:  (fila: PendingComplianceRow) => void
  subir:  (fila: PendingComplianceRow, archivo: File, vencimiento?: string) => Promise<void>
}) {
  // `estado='todos'` FIJO, sin importar `estadoFiltro` (Task 1, ronda de
  // arreglo 2): el detalle de un sujeto se pide UNA sola vez —son ~13 filas,
  // no las 457 de la empresa entera— y el filtro reparte acá abajo, sobre
  // `urgencia`, que ya viene en cada fila. Antes `estadoFiltro` estaba en la
  // clave, así que cada clic de filtro invalidaba la consulta de TODOS los
  // sujetos desplegados y volvía a la red — con nueve sujetos abiertos, un
  // clic eran nueve peticiones (hallazgo 4 de la revisión final). Con la
  // clave fija, además, esta consulta comparte caché con `bajaDocsQuery` de
  // más abajo siempre que este sujeto ya esté desplegado, sin importar el
  // filtro activo — antes sólo compartían con el filtro en "Todo".
  const filasQuery = useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId, sujeto.entity_id, 'todos'),
    queryFn: () => complianceApi.listPending({ carrierId, entityId: sujeto.entity_id, estado: 'todos', limit: 200 }),
    enabled: abierto,
  })
  const filas = filasDelEstado(filasQuery.data?.rows ?? [], estadoFiltro)

  return (
    <div className="border border-border rounded-xl bg-white overflow-hidden">
      <CabeceraDeSujeto
        sujeto={sujeto}
        abierto={abierto}
        onAlternar={onAlternar}
        canEdit={canEdit}
        nombreEmpresa={nombreEmpresa}
        onTransferir={onTransferir}
        onDarDeBaja={onDarDeBaja}
        accionesDeshabilitadas={accionesDeshabilitadas}
      />
      {abierto && filasQuery.isPending && <Estado tipo="cargando" />}
      {abierto && filasQuery.error && (
        <Estado
          tipo="error"
          titulo="No se pudo cargar la documentación"
          detalle={filasQuery.error instanceof Error ? filasQuery.error.message : undefined}
        />
      )}
      {/* La partición es la MISMA `urgencia` que reparte el filtro de arriba,
          no una segunda lectura por `status`. Con `status` la lista se
          contradecía con el filtro que la contenía: los registros vencidos
          por fecha del módulo están en `APPROVED_MANUAL`, así que aparecían
          bajo "Falta" rotulados "Aprobado (manual)". Y al revés, un
          `EXPIRED` —que TIENE archivo— iba al renglón de carga y su
          documento quedaba invisible en la pantalla que existe para hacerlo
          visible. Que hay archivo o no lo dice `tiene_archivo`, que es el
          hecho; del status no se deduce. */}
      {abierto && !filasQuery.isPending && !filasQuery.error && filas.map(f => (
        f.urgencia === 'AL_DIA'
          ? (
            <FilaDocumento
              key={f.id}
              fila={f}
              viendo={viendoId === f.id && previewFetching}
              avisoVer={viendoId === f.id ? avisoVer : null}
              onVer={f.tiene_archivo ? () => onVer(f) : undefined}
              puedeEditar={canEdit}
              onFechaCorregida={onFechaCorregida}
            />
          )
          : (
            /* `onFechaCorregida` se pasa según la POLÍTICA del requisito y no
               según haya archivo: declarar un vencimiento sin tener el escaneo
               es deliberado —así se sigue qué vence antes de subir los ~2.000
               documentos— y ya estaba decidido cuando se escribió
               `ExpirationDateCell`. `NONE` es el único que no la ofrece: el
               Padrón no vence. */
            <RenglonPendiente
              key={f.id}
              fila={f}
              puedeEditar={canEdit}
              onSubir={subir}
              onVer={f.tiene_archivo ? () => onVer(f) : undefined}
              onFechaCorregida={f.expiration_policy !== 'NONE' ? onFechaCorregida : undefined}
              viendo={viendoId === f.id && previewFetching}
              avisoVer={viendoId === f.id ? avisoVer : null}
            />
          )
      ))}
    </div>
  )
}

/** La ficha de una empresa: su documentación, la de sus conductores y la de
 *  sus vehículos, juntas.
 *
 *  **Resumen al llegar, detalle al desplegar** (Task 2, perf/compresion-y-resumen):
 *  antes, la ficha pedía las 457 filas de detalle de la empresa —con
 *  `estado='todos'` y `limit=500`— sólo para dibujar nueve cabeceras
 *  plegadas con sus conteos (medido en dev: 57.183 bytes en la primera
 *  carga). La pantalla dejó de mostrar el detalle hasta que alguien
 *  despliega un sujeto; la consulta ahora también.
 *
 *  Las cifras de arriba, las cabeceras de sujeto y de grupo salen todas de
 *  `complianceApi.summary()`, que particiona sobre `urgencia` en el
 *  servidor. El detalle de UN sujeto se pide recién al desplegarlo, y sólo
 *  del estado activo (`TarjetaDeSujeto`). */
export default function FichaEmpresaPage() {
  const { carrierId } = useParams<{ carrierId: string }>()
  const canEdit = useCanEdit()
  const canAdmin = useCanAdmin()
  const subirDocumento = useSubirDocumento()
  const queryClient = useQueryClient()

  /** El sujeto que está por darse de baja o transferirse, si alguno. Uno solo
   *  a la vez: son diálogos, no hay forma de disparar dos a la vez. */
  const [confirmandoBaja, setConfirmandoBaja] = useState<ComplianceSummarySubject | null>(null)
  /** La baja de la EMPRESA, que es otra cosa que la de un sujeto suyo. Un
   *  conductor se da de baja DE la empresa —deja de estar asignado— y sigue
   *  existiendo; la empresa se da de baja DEL SISTEMA, cambiando su
   *  `operational_status`. Son dos verbos distintos con el mismo nombre, así
   *  que tienen estado, endpoint y permiso separados. */
  const [dandoDeBajaEmpresa, setDandoDeBajaEmpresa] = useState(false)
  const [reactivando, setReactivando] = useState(false)
  const [errorReactivar, setErrorReactivar] = useState<string | null>(null)
  const [transfiriendo, setTransfiriendo] = useState<ComplianceSummarySubject | null>(null)

  /** La baja real, de un sujeto puntual: qué endpoint según lo que es, y
   *  después `invalidarCertificacion` — la lista se redibuja desde ahí, la
   *  única fuente. Nunca se quita la fila a mano: eso la convierte en un
   *  fantasma que parpadea si el pedido falla.
   *
   *  NO atrapa el error. `ConfirmarBaja` ya sabe qué hacer con uno —lo dice
   *  adentro, mantiene el diálogo abierto y ofrece reintentar sin cerrarse
   *  con Escape ni con el fondo— y atraparlo acá para mostrarlo en la
   *  tarjeta dejaba ese camino inalcanzable: código muerto. Un diálogo que
   *  se cierra solo ante un fallo se lee como "listo", que es exactamente lo
   *  que no pasó. */
  async function ejecutarBaja(s: ComplianceSummarySubject) {
    if (s.entity_type === 'ASSET') await carriersApi.unassignAsset(carrierId, s.entity_id)
    else await carriersApi.unassignDriver(carrierId, s.entity_id)
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

  /** Baja y reactivación de la empresa. Es el mismo `PATCH` que usa Empresas
   *  (`carriers/[id]`): acá no hay endpoint nuevo, sólo deja de haber que
   *  salir del módulo para llegar a él. El cambio de estado queda auditado en
   *  `public.audit_log` vía `record_manual_edit`, que es por qué el diálogo
   *  confirma y no pide un motivo escrito.
   *
   *  No atrapa el error, por el mismo motivo que `ejecutarBaja`:
   *  `BajaReasonModal` ya lo muestra y se queda abierto para reintentar. */
  async function cambiarEstadoEmpresa(estado: 'ACTIVE' | 'INACTIVE') {
    await carriersApi.patch(carrierId, { operational_status: estado })
    // Las DOS invalidaciones, y ninguna alcanza sola. `carrier-detail` es la
    // cabecera; `invalidarCertificacion` es todo lo demás de esta pantalla y
    // del módulo —el resumen, los pendientes, el embudo del que la empresa
    // acaba de entrar o salir—. Con sólo la primera, durante los 60 s de
    // `staleTime` la cabecera decía "Inactivo" y el cuerpo mostraba 457
    // requisitos. `lib/queries/certificacion.ts` existe por esto: su docstring
    // cuenta que esa lista de raíces "ya perdió una raíz dos veces".
    await queryClient.invalidateQueries({ queryKey: ['carrier-detail', carrierId] })
    await invalidarCertificacion(queryClient)
  }

  async function darDeBajaEmpresa() {
    await cambiarEstadoEmpresa('INACTIVE')
  }

  /** Reactivar no pregunta —no destruye nada y es el camino de vuelta del
   *  error— pero sí tiene que DECIR si falla. Sin esto era una promesa
   *  rechazada sin manejar: cero señal, el botón seguía ofreciendo lo mismo, y
   *  el usuario volvía a hacer clic sobre algo que no funcionaba. */
  async function reactivarEmpresa() {
    setReactivando(true); setErrorReactivar(null)
    try {
      await cambiarEstadoEmpresa('ACTIVE')
    } catch (e) {
      setErrorReactivar(e instanceof Error ? e.message : 'No se pudo reactivar')
    } finally {
      setReactivando(false)
    }
  }

  const [estadoFiltro, setEstadoFiltro] = useState<EstadoDocumental>('todos')
  /** El documento que se está mirando, sea cual sea su sujeto. Se guarda el
   *  id y no la fila completa: `/pending` nunca trae `file_url` firmada —
   *  firmarla ahí sería una llamada HTTP por archivo sobre una lista que
   *  puede traer 200— así que hay que volver a pedir el registro, ahora sí
   *  de a uno, cuando alguien elige "Ver". */
  const [viendoId, setViendoId] = useState<string | null>(null)
  const [viendoLabel, setViendoLabel] = useState('')

  const carrierQuery = useQuery({
    queryKey: ['carrier-detail', carrierId],
    queryFn: () => carriersApi.get(carrierId),
  })

  const resumenQuery = useQuery({
    queryKey: clavesCertificacion.resumen(carrierId),
    queryFn: () => complianceApi.summary(carrierId),
  })

  /** El único criterio de "está activa" de la pantalla. Se deriva una vez y
   *  no se repite: el botón, su etiqueta y la insignia de estado del
   *  encabezado tienen que decir lo mismo, y dos comparaciones sueltas es
   *  como empiezan a decir cosas distintas. Es el mismo criterio que usa
   *  Empresas (`operational_status !== 'ACTIVE'` para ofrecer reactivar). */
  const empresaActiva = carrierQuery.data?.operational_status === 'ACTIVE'

  const resumen = resumenQuery.data
  const todosLosSujetos = resumen?.sujetos ?? []
  // Sin dato todavía → objeto vacío (`Cifra` decide "cargando" por su cuenta,
  // vía la prop de más abajo). Con dato pero `completo: false` → también
  // vacío: las cuatro cifras se calcularon sobre una CTE recortada
  // (`SUMMARY_LIMIT`, hallazgo 3 de la revisión final) y mostrar un número
  // ahí sería afirmar una cifra que puede estar mal — la regla del proyecto
  // es que una cifra derivada no se muestra hasta tener el dato BUENO, no
  // cualquier dato. `Cifra` con `valor=undefined` y `cargando=false` pinta
  // "—", no un guion que prometa un cero que nunca llega.
  const conteos: Partial<Record<EstadoDocumental, number>> =
    resumen && resumen.completo ? resumen.totales : {}

  /** Los sujetos que quedan del lado del filtro activo. Antes esto salía de
   *  agrupar las FILAS ya filtradas; acá no hay filas hasta que alguien
   *  despliega, así que se filtra sobre el conteo que el resumen ya trae —
   *  un sujeto sin nada de ese estado no tiene nada que mostrar.
   *
   *  "falta" acá ES `sujeto.falta`, el casillero EXCLUSIVO del resumen
   *  (`al_dia + por_vencer + falta = todos`) — la MISMA partición que usa
   *  `filasDelEstado` sobre el detalle de cada sujeto, más arriba. Antes
   *  usaba el criterio inclusivo de `GET /pending?estado=falta` ("no está al
   *  día", que SÍ incluye lo por vencer") porque el detalle se pedía con
   *  `estadoFiltro` y tenía que coincidir con lo que el servidor iba a
   *  devolver. Ahora el detalle SIEMPRE se pide con `estado='todos'` y se
   *  reparte acá con el mismo criterio que el resumen, así que las dos
   *  particiones —la del chip y la de la lista— son la misma por
   *  construcción: la contradicción del hallazgo 1 (chip "Falta 1", lista
   *  con 2 filas) ya no puede pasar. Ningún sujeto queda escondido por esto:
   *  "Por vencer" sigue siendo un chip propio con su propio conteo. */
  const tieneAlgoDelEstado = (s: ComplianceSummarySubject, estado: EstadoDocumental): boolean => {
    switch (estado) {
      case 'todos':      return true
      case 'al_dia':     return s.al_dia > 0
      case 'por_vencer': return s.por_vencer > 0
      case 'falta':      return s.falta > 0
    }
  }
  const sujetosVisibles = todosLosSujetos.filter(s => tieneAlgoDelEstado(s, estadoFiltro))

  /** Qué sujetos están abiertos. Se guarda lo que el usuario abrió, no lo que
   *  está cerrado: los sujetos cambian con el filtro y con la respuesta, y una
   *  lista de cerrados obligaría a mantenerla al día con filas que van y
   *  vienen.
   *
   *  **Todos arrancan plegados**, y eso incluye a la empresa. La excepción es
   *  tener un solo sujeto: plegar existe para dejar ver el conjunto, y con un
   *  elemento no hay conjunto — sería llegar a una fila cerrada y nada más. */
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const estaAbierto = (s: ComplianceSummarySubject) => sujetosVisibles.length === 1 || abiertos.has(claveDeSujeto(s))
  const grupos = agruparPorTipo(sujetosVisibles)
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

  /** El fleet-derivado viaja como escalar en el resumen (Ronda 85: "la flota
   *  manda cuando existe"), no por fila: es un dato de la EMPRESA, no del
   *  detalle. Sin flota —o con flota sin tipo declarado— no hay de dónde
   *  sacarlo: el chip lo dice en vez de desaparecer (uno de los cuatro
   *  estados obligatorios de pantalla, no una ausencia muda). */
  const tipoOperacion = resumen?.carrier_operation_types.join(' + ')

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

  /** Cuántos documentos CON archivo tiene el sujeto que se está por dar de
   *  baja. No depende del filtro activo — con el filtro en "Falta", que es
   *  la forma natural de trabajar esta pantalla, un sujeto al día perdería
   *  la única frase que ese diálogo existe para decir (hallazgo real de una
   *  revisión anterior de esta misma ficha). Se pide aparte, con
   *  `estado='todos'` fijo: el resumen no cuenta "con archivo", sólo
   *  "cuántos requisitos". Comparte clave de caché con `TarjetaDeSujeto`
   *  siempre que ese sujeto ya esté desplegado —`TarjetaDeSujeto` también
   *  pide `estado='todos'` fijo desde la ronda de arreglo 2—, sin importar
   *  el filtro activo de la pantalla; así ahí no dispara una segunda
   *  consulta. */
  const bajaDocsQuery = useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId, confirmandoBaja?.entity_id, 'todos'),
    queryFn: () => complianceApi.listPending({
      carrierId, entityId: confirmandoBaja!.entity_id, estado: 'todos', limit: 200,
    }),
    enabled: !!confirmandoBaja,
  })
  // Sin dato todavía (`bajaDocsQuery.data` es `undefined` mientras viaja) es
  // "todavía no sé", no "cero". Un `?? 0` acá colapsaría los dos y el
  // diálogo abriría afirmando "cero documentos" mientras la consulta viaja
  // — hallazgo 1c de la revisión final. `ConfirmarBaja` ya no dibuja la
  // frase (ni su negación) hasta tener el número.
  const cuantosDocumentos = bajaDocsQuery.data?.rows.filter(r => r.tiene_archivo).length

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
            {!resumenQuery.isPending && !resumenQuery.error && (
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
      >
        {/* `canAdmin`, no `canEdit`: dar de baja a un conductor DE la empresa
            es trabajo de un editor, pero bajar a la empresa DEL SISTEMA se
            dejó en admin a propósito (Ronda 135). Mismo permiso, mismo
            endpoint y mismo diálogo que en Empresas — lo único que cambia es
            que ya no hay que ir hasta allá. */}
        {canAdmin && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={reactivando}
              onClick={() => empresaActiva ? setDandoDeBajaEmpresa(true) : reactivarEmpresa()}
              // Dar de baja se ve destructivo y reactivar no: son gestos
              // opuestos y verse iguales invita al clic equivocado en el que
              // sí saca a la empresa de circulación.
              //
              // Usa `status-incidente`, que es el rojo del sistema, y no un
              // `red-500` crudo: el trinquete de `lib/ui/sistema.test.ts`
              // cuenta los colores decididos fuera del sistema y sólo puede
              // bajar. El sistema NO tiene token de "acción destructiva"
              // —`espera` comparte el valor pero significa "hay archivos
              // esperando"—, así que esto toma prestado el de alerta. Cuando
              // ese token exista, este es uno de sus llamadores.
              className={`px-3 py-1.5 rounded-lg text-dato font-semibold border shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                empresaActiva
                  ? 'border-status-incidente/30 bg-white text-status-incidente hover:bg-status-incidente/5'
                  : 'border-border bg-white text-text-primary hover:bg-bg-main'
              }`}
            >
              {reactivando ? 'Reactivando…' : empresaActiva ? 'Dar de baja' : 'Reactivar'}
            </button>
            {errorReactivar && (
              <p className="text-etiqueta text-status-incidente max-w-xs text-right">{errorReactivar}</p>
            )}
          </div>
        )}
      </EncabezadoDePagina>

      {/* Dada de baja NO es "sin datos": es un expediente cerrado, y se lee.
          Va acá arriba y no en un chip del encabezado porque cambia lo que se
          puede HACER en toda la pantalla — la carga queda deshabilitada—, y
          una condición que apaga acciones tiene que estar donde se la ve
          antes de intentarlas, no explicada después del error. */}
      {!empresaActiva && (
        <div className="border border-border rounded-xl bg-accent/5 px-4 py-3 flex items-start gap-3">
          <Ban size={16} className="shrink-0 mt-0.5 text-informativo" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-dato font-semibold text-text-primary">
              Esta empresa está dada de baja
            </p>
            <p className="text-etiqueta text-informativo mt-0.5">
              Su documentación se muestra completa para poder consultarla, pero no
              se le puede cargar nada nueva. Deja de contar en los pendientes del
              módulo. Al reactivarla vas a ver qué se venció mientras estuvo de baja.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CIFRAS.map(c => (
          <div key={c.estado} className="border border-border rounded-xl bg-white px-4 py-3">
            {/* `cargando` mientras el resumen todavía no llegó: sin esta
                prop las cuatro cifras negarían de entrada un dato que venía
                en camino. Y el resumen SÍ puede venir truncado —`conteos`
                ya sale vacío cuando `resumen.completo` es `false` (hallazgo
                3 de la revisión final)—, así que acá no hace falta un
                segundo estado: `valor=undefined` con `cargando=false` ya
                pinta "—" en vez de un número que podría estar mal. */}
            <Cifra
              valor={conteos[c.estado]}
              etiqueta={c.etiqueta}
              tono={c.tono}
              cargando={resumenQuery.isPending}
            />
          </div>
        ))}
      </div>

      <FiltroDeEstado valor={estadoFiltro} onCambiar={setEstadoFiltro} conteos={conteos} />

      <div className="space-y-3">
        {resumenQuery.isPending && <Estado tipo="cargando" />}

        {resumenQuery.error && (
          <Estado
            tipo="error"
            titulo="No se pudo cargar la documentación"
            detalle={resumenQuery.error instanceof Error ? resumenQuery.error.message : undefined}
          />
        )}

        {!resumenQuery.isPending && !resumenQuery.error && todosLosSujetos.length === 0 && (
          /* La empresa no tiene ni un `compliance_record`. Las empresas sin
             documentos sí tienen registros MISSING y nunca llegan acá; quien
             llega es la empresa a la que todavía no se le sembró el catálogo,
             y pedirle documentos sería decirle lo que no es — cargar no lo
             arregla.
 
             Ese es el ÚNICO significado de este vacío, y hay que defenderlo:
             cuando se agregó la baja de la empresa, este cartel pasó a cubrir
             también "está dada de baja" y afirmaba que nunca se le definieron
             documentos a una empresa que tenía 457. El backend ya no filtra
             por estado cuando se pide UNA empresa, así que la baja no vacía la
             ficha; si alguna vez volviera a hacerlo, este cartel mentiría otra
             vez. */
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
        {!resumenQuery.isPending && !resumenQuery.error && todosLosSujetos.length > 0 && sujetosVisibles.length === 0 && (
          <Estado
            tipo="vacio"
            titulo="No hay documentos en ese estado"
            detalle={`${carrier.business_name} tiene documentos, pero ninguno queda en este filtro. Elige "Todo" para verlos todos.`}
          />
        )}

        {!resumenQuery.isPending && !resumenQuery.error && sujetosVisibles.length > 0 && (() => {
          /** La tarjeta de un sujeto, para no escribirla dos veces: una vez
           *  suelta —la empresa— y otra dentro de su grupo. */
          const tarjeta = (s: ComplianceSummarySubject) => (
            <TarjetaDeSujeto
              key={claveDeSujeto(s)}
              sujeto={s}
              carrierId={carrierId}
              estadoFiltro={estadoFiltro}
              abierto={estaAbierto(s)}
              onAlternar={() => alternar(claveDeSujeto(s))}
              canEdit={canEdit}
              onFechaCorregida={() => invalidarCertificacion(queryClient)}
              nombreEmpresa={carrier.business_name}
              onTransferir={() => setTransfiriendo(s)}
              onDarDeBaja={() => setConfirmandoBaja(s)}
              accionesDeshabilitadas={
                (!!confirmandoBaja && claveDeSujeto(confirmandoBaja) === claveDeSujeto(s)) ||
                (!!transfiriendo && claveDeSujeto(transfiriendo) === claveDeSujeto(s))
              }
              viendoId={viendoId}
              avisoVer={avisoVer}
              previewFetching={previewQuery.isFetching}
              onVer={verDocumento}
              subir={subir}
            />
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

        {/* Sin la guarda, la pantalla invita a subir documentos a una empresa
            que no los puede recibir. Se retira en vez de deshabilitarse porque
            el banner de arriba ya dice por qué — dos veces el mismo motivo, en
            la misma pantalla, es ruido. */}
        {empresaActiva && (
          <PuenteALaBandeja carrierId={carrierId} carrierName={carrier.business_name} />
        )}
      </div>

      {viendoId && previewQuery.data?.file_url && (
        <DocumentPreviewModal
          label={viendoLabel}
          url={previewQuery.data.file_url}
          canEdit={canEdit}
          onClose={() => setViendoId(null)}
        />
      )}

      {dandoDeBajaEmpresa && (
        <BajaReasonModal
          label={carrier.business_name}
          onClose={() => setDandoDeBajaEmpresa(false)}
          onConfirm={darDeBajaEmpresa}
        />
      )}

      <ConfirmarBaja
        // Sin trampa de foco, el ⋮ de otro sujeto sigue disponible mientras
        // este diálogo está abierto: se puede pasar de un sujeto a otro sin
        // cerrar. `abierto` no cambia en ese caso, así que el efecto interno
        // que resetea enviando/error (depende sólo de `abierto`) no se
        // reactiva. La `key` por sujeto fuerza el remount — mismo patrón que
        // el resto de los "draft que no se resincroniza" de este repo.
        key={confirmandoBaja ? claveDeSujeto(confirmandoBaja) : undefined}
        abierto={!!confirmandoBaja}
        nombreSujeto={confirmandoBaja ? tituloDeSujeto(confirmandoBaja) : ''}
        nombreEmpresa={carrier.business_name}
        cuantosDocumentos={cuantosDocumentos}
        onCancelar={() => setConfirmandoBaja(null)}
        onConfirmar={confirmarBaja}
      />

      {transfiriendo && (
        <TransferModal
          open
          title={`Transferir a ${tituloDeSujeto(transfiriendo)}`}
          currentCarrierId={carrierId}
          onClose={() => setTransfiriendo(null)}
          onTransfer={async (destino) => {
            const s = transfiriendo
            if (s.entity_type === 'ASSET') await carriersApi.assignAsset(destino, s.entity_id)
            else await carriersApi.assignDriver(destino, s.entity_id)
            await invalidarCertificacion(queryClient)
          }}
        />
      )}
    </div>
  )
}
