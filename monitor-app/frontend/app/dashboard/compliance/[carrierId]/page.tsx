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

/** Los cuatro estados, con la cifra y el matiz de `<Cifra>` que le
 *  corresponden. Uno por bucket de `/pending?estado=`, así que las cuatro
 *  consultas de abajo tienen que cubrir exactamente estos cuatro valores. */
const CIFRAS: { estado: EstadoDocumental; etiqueta: string; tono: 'normal' | 'atencion' | 'urgente' | 'resuelto' }[] = [
  { estado: 'todos',      etiqueta: 'requisitos',  tono: 'normal' },
  { estado: 'al_dia',     etiqueta: 'al día',      tono: 'resuelto' },
  { estado: 'falta',      etiqueta: 'faltan',      tono: 'urgente' },
  { estado: 'por_vencer', etiqueta: 'por vencer',  tono: 'atencion' },
]

/** Una fila con documento cargado: nombre, fecha, estado y "Ver". La otra
 *  mitad de la misma lista —`RenglonPendiente`, para MISSING/EXPIRED— ya
 *  existe y no se reescribe; ésta es su variante para lo que SÍ tiene
 *  archivo, que el cajón nunca necesitó mostrar porque sólo pide
 *  `estado='falta'`. */
function FilaDocumento({ fila, viendo, onVer }: {
  fila:    PendingComplianceRow
  viendo:  boolean
  onVer:   () => void
}) {
  const cfg = COMPLIANCE_STATUS_CONFIG[fila.status]
  return (
    <div className="border-b border-border last:border-b-0 px-3 py-2 min-h-10 flex items-center gap-3">
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
 *  Arranca mostrando TODO (no sólo lo que falta) y deja elegir con el mismo
 *  filtro de cuatro estados que ya usa el resto del módulo. El agrupado por
 *  sujeto —CARRIER→DRIVER→ASSET, "De la empresa"— es el MISMO que el cajón:
 *  vive en `lib/utils/agruparPorSujeto`, no una segunda copia acá. */
export default function FichaEmpresaPage() {
  const { carrierId } = useParams<{ carrierId: string }>()
  const canEdit = useCanEdit()
  const subirDocumento = useSubirDocumento()

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

  /** Las cuatro variantes de `/pending`, una por bucket. No es una sola
   *  consulta filtrada porque las cuatro cifras y el filtro tienen que poder
   *  mostrar un número real a la vez —cambiar de "Todo" a "Al día" no puede
   *  vaciar las otras tres cifras que ya se habían mostrado—, y el backend no
   *  tiene un endpoint que devuelva las cuatro juntas (sí lo tiene por
   *  requisito vencido/al día en `/status`, pero no por "por vencer": ese
   *  bucket sólo existe acá). */
  const todosQuery     = usePendientesPorEstado(carrierId, 'todos')
  const alDiaQuery     = usePendientesPorEstado(carrierId, 'al_dia')
  const faltaQuery     = usePendientesPorEstado(carrierId, 'falta')
  const porVencerQuery = usePendientesPorEstado(carrierId, 'por_vencer')
  const porBucket = { todos: todosQuery, al_dia: alDiaQuery, falta: faltaQuery, por_vencer: porVencerQuery }
  const activa = porBucket[estadoFiltro]

  const rows = activa.data?.rows ?? []
  const sujetos = agruparPorSujeto(rows)
  /** El fleet-derivado (Ronda 85: "la flota manda cuando existe") viaja en
   *  cada fila de `/pending`, así que basta la primera. Sin filas —empresa
   *  sin ningún documento aplicable— no hay de dónde sacarlo, y no se
   *  reemplaza por la gestión DECLARADA de `carriersApi.get`: son dos
   *  fuentes del mismo concepto y mezclarlas mostraría un chip que no
   *  coincide con lo que el resto del módulo (el embudo) ya muestra. */
  const tipoOperacion = todosQuery.data?.rows[0]?.carrier_operation_types.join(' + ')

  const previewQuery = useQuery({
    queryKey: ['compliance-record-file', viendoId],
    queryFn: () => complianceApi.get(viendoId!),
    enabled: !!viendoId,
  })

  function verDocumento(fila: PendingComplianceRow) {
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
            {tipoOperacion && (
              <span className="text-etiqueta font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                {tipoOperacion}
              </span>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CIFRAS.map(c => (
          <div key={c.estado} className="border border-border rounded-xl bg-white px-4 py-3">
            <Cifra valor={porBucket[c.estado].data?.total} etiqueta={c.etiqueta} tono={c.tono} />
          </div>
        ))}
      </div>

      <FiltroDeEstado
        valor={estadoFiltro}
        onCambiar={setEstadoFiltro}
        conteos={{
          todos: todosQuery.data?.total,
          al_dia: alDiaQuery.data?.total,
          falta: faltaQuery.data?.total,
          por_vencer: porVencerQuery.data?.total,
        }}
      />

      <div className="space-y-3">
        {activa.isPending && <Estado tipo="cargando" />}

        {activa.error && (
          <Estado
            tipo="error"
            titulo="No se pudo cargar la documentación"
            detalle={activa.error instanceof Error ? activa.error.message : undefined}
          />
        )}

        {!activa.isPending && !activa.error && rows.length === 0 && (
          <Estado
            tipo="vacio"
            titulo={`Nadie cargó documentos de ${carrier.business_name} todavía`}
            detalle="En cuanto lleguen archivos por la Bandeja, van a aparecer acá agrupados por quién los necesita."
          />
        )}

        {!activa.isPending && !activa.error && sujetos.map(s => (
          <div key={s.clave} className="border border-border rounded-xl bg-white overflow-hidden">
            <p className="px-3 py-2 text-dato font-semibold text-text-primary bg-accent/5 border-b border-border">
              {s.titulo}
            </p>
            {s.filas.map(f => (
              f.status === 'MISSING' || f.status === 'EXPIRED'
                ? <RenglonPendiente key={f.id} fila={f} puedeEditar={canEdit} onSubir={subir} />
                : (
                  <FilaDocumento
                    key={f.id}
                    fila={f}
                    viendo={viendoId === f.id && previewQuery.isFetching}
                    onVer={() => verDocumento(f)}
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

function usePendientesPorEstado(carrierId: string, estado: EstadoDocumental) {
  return useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId, undefined, estado),
    queryFn: () => complianceApi.listPending({ carrierId, estado, limit: 200 }),
  })
}
