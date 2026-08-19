'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Eye, Inbox, Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import { useCanEdit } from '@/hooks/useCanEdit'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { AvisoDeFila } from '@/components/compliance/AvisoDeFila'
import { RenglonPendiente } from '@/components/compliance/RenglonPendiente'
import { FiltroDeEstado } from '@/components/compliance/FiltroDeEstado'
import { DocumentPreviewModal } from '@/components/dashboard/DocumentPreviewModal'
import { Cifra } from '@/components/ui/Cifra'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { STATUS_LABELS, STATUS_CLS } from '@/components/dashboard/TransporterCard'
import { COMPLIANCE_STATUS_CONFIG, formatExpiry } from '@/lib/compliance'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { agruparPorSujeto } from '@/lib/utils/agruparPorSujeto'
import type { EstadoDocumental, PendingComplianceRow } from '@/lib/types'

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
  onVer:    () => void
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
        <button
          type="button"
          onClick={onVer}
          disabled={viendo}
          className="shrink-0 inline-flex items-center gap-1.5 text-etiqueta font-semibold text-accion transition-opacity hover:opacity-70 disabled:opacity-50"
        >
          {viendo ? <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
          Ver
        </button>
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
            {!todosQuery.isPending && (
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
            <Cifra valor={conteos[c.estado]} etiqueta={c.etiqueta} tono={c.tono} />
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
          <Estado
            tipo="vacio"
            titulo={`Nadie cargó documentos de ${carrier.business_name} todavía`}
            detalle="En cuanto lleguen archivos por la Bandeja, van a aparecer acá agrupados por quién los necesita."
          />
        )}

        {/* Distinto del vacío de arriba: acá SÍ hay documentos, sólo que
            ninguno queda del lado del filtro elegido. Mostrar el mismo "nadie
            cargó nada" sería mentir sobre una empresa que sí tiene. */}
        {!todosQuery.isPending && !todosQuery.error && allRows.length > 0 && rows.length === 0 && (
          <Estado
            tipo="vacio"
            titulo="No hay documentos en ese estado"
            detalle={`${carrier.business_name} tiene documentos, pero ninguno queda en este filtro. Elige "Todo" para verlos todos.`}
          />
        )}

        {!todosQuery.isPending && !todosQuery.error && rows.length > 0 && sujetos.map(s => (
          <div key={s.clave} className="border border-border rounded-xl bg-white overflow-hidden">
            <p className="px-3 py-2 text-dato font-semibold text-text-primary bg-accent/5 border-b border-border">
              {s.titulo}
            </p>
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
            {s.filas.map(f => (
              f.urgencia === 'AL_DIA'
                ? (
                  <FilaDocumento
                    key={f.id}
                    fila={f}
                    viendo={viendoId === f.id && previewQuery.isFetching}
                    avisoVer={viendoId === f.id ? avisoVer : null}
                    onVer={() => verDocumento(f)}
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
        ))}

        {canEdit && (
          <p className="text-etiqueta text-informativo pt-1 flex items-center gap-1.5">
            <Inbox size={11} aria-hidden="true" />
            ¿Tienes muchos documentos de {carrier.business_name}?{' '}
            <Link
              href="/dashboard/compliance/inbox"
              className="font-semibold text-accion transition-opacity hover:opacity-70"
            >
              Llévalos a la Bandeja
            </Link>
          </p>
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
    </div>
  )
}
