'use client'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface Props {
  abierto:           boolean
  nombreSujeto:      string
  nombreEmpresa:     string
  /** `undefined` mientras la consulta viaja: 'no sé' no es 'cero'. */
  cuantosDocumentos?: number
  /** Viajes activos que tiene hoy. `undefined` mientras la consulta viaja:
   *  'no sé' no es 'cero', igual que `cuantosDocumentos`. */
  viajesActivos?:    number
  /** 'deactivate' es el texto de Certificación; 'remove' es "Quitar del roster"
   *  del Directorio: el mismo gesto (termina la asignación), con su nombre.
   *  Una variante es una prop, no un componente hermano. */
  variant?:          'deactivate' | 'remove'
  onCancelar:        () => void
  onConfirmar:       () => Promise<void>
}

/** Confirmación de dar de baja a un conductor o vehículo de una empresa —
 *  se abre desde `AccionesDeSujeto`. Sin motivo de baja: la HU lo propone,
 *  pero exige una columna nueva y el vocabulario es decisión del negocio.
 *  La baja ya deja rastro en `audit_log` vía `record_manual_edit`. El foco en Cancelar,
 *  no cerrar mientras viaja y quedar abierta si falla son de `ConfirmDialog`. */
export function ConfirmarBaja({ abierto, nombreSujeto, nombreEmpresa, cuantosDocumentos, viajesActivos, variant, onCancelar, onConfirmar }: Props) {
  if (!abierto) return null

  const titulo = variant === 'remove'
    ? `Quitar a ${nombreSujeto} del roster de ${nombreEmpresa}`
    : `Dar de baja a ${nombreSujeto} de ${nombreEmpresa}`

  return (
    <ConfirmDialog
      title={titulo}
      confirmLabel={variant === 'remove' ? 'Quitar del roster' : 'Dar de baja'}
      tone="danger"
      errorFallback={variant === 'remove' ? 'No se pudo quitar' : 'No se pudo dar de baja'}
      onConfirm={onConfirmar}
      onClose={onCancelar}
    >
      <p className="text-informativo">
        Deja de figurar en esta empresa.
        {/* Sólo lo que hoy es cierto: los documentos no se tocan
         *  (compliance_records no se toca en ningún camino de esta
         *  ola). NO promete que el regreso vaya a funcionar solo —
         *  is_manual_override deja la asignación sin un camino de
         *  vuelta por la interfaz (issue #7); prometerlo acá sería
         *  mentir. */}
        {cuantosDocumentos != null && cuantosDocumentos > 0 && (
          <> Sus {cuantosDocumentos} documentos cargados se conservan.</>
        )}
      </p>

      {/* El aviso que faltaba. Sacarle la empresa a alguien que está
          manejando lo borra del cierre del día —el roster de Tractoreo se
          arma desde `driver_assignments`— y nada avisaba. El 25/08, en la
          propia revisión de la app, se desvinculó a un conductor con 70
          viajes en 60 días; al 27/08 hay 8 así, con 278 viajes entre todos.
          No bloquea: a veces la baja es justamente lo que corresponde. */}
      {viajesActivos != null && viajesActivos > 0 && (
        <p role="alert" className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-dato text-warning">
          Tiene {viajesActivos} {viajesActivos === 1 ? 'viaje activo' : 'viajes activos'} en
          este momento. Sin empresa deja de aparecer en el cierre del día, aunque
          siga manejando.
        </p>
      )}
    </ConfirmDialog>
  )
}
