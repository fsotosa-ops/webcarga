'use client'

import { TaxonomyTab } from './estados-tabs'

/** Las dos taxonomias que consumen VARIOS modulos (verificado contra el codigo,
 *  spec seccion 2): los subtipos alimentan las condiciones de Certificacion, la
 *  ficha de empresa y los cierres de equipo; los tipos de operacion alimentan
 *  la ficha de empresa, los viajes y los cierres.
 *
 *  Por eso Flota es un dominio propio y no una seccion llamada "Vocabulario":
 *  es un nombre del negocio, y contiene exactamente lo compartido. Se edita
 *  aca y en ningun otro lado. */

const AVISO_COMPARTIDO =
  'Este vocabulario lo usan Certificación y Operaciones. Un cambio acá se ve en los dos.'

export function SubtiposVehiculoTab() {
  return (
    <TaxonomyTab
      domain="FLEET_SERVICE_TYPE"
      title="Subtipos de vehículo"
      hint={AVISO_COMPARTIDO}
      newLabel="subtipo"
    />
  )
}

export function TiposOperacionTab() {
  return (
    <TaxonomyTab
      domain="WEBCARGA_OPERATION_TYPE"
      title="Tipos de operación"
      hint={AVISO_COMPARTIDO}
      newLabel="tipo de operación"
    />
  )
}

/** Motivos de conductor NO es compartido: lo usan solo los cierres diarios y
 *  los viajes, o sea Operaciones. Vive alli, no en Flota. */
export function MotivosConductorTab() {
  return (
    <TaxonomyTab
      domain="DRIVER_REASON"
      title="Motivos de conductor"
      hint="Por qué un conductor no está disponible. Sólo lo usa Operaciones."
      newLabel="motivo"
    />
  )
}

/** Motivos de no asignación TAMPOCO es compartido: responde por qué WebCarga
 *  no tomó una carga que le ofrecieron (Cierre del Día, paso Viajes), no por
 *  qué un conductor faltó — por eso es dominio propio y no una fila más de
 *  DRIVER_REASON. Vive en Operaciones, igual que Motivos de conductor. */
export function MotivosNoAsignacionTab() {
  return (
    <TaxonomyTab
      domain="TRIP_UNASSIGNED_REASON"
      title="Motivos de no asignación"
      hint="Por qué WebCarga no tomó una carga que le ofrecieron. Sólo lo usa Operaciones."
      newLabel="motivo"
    />
  )
}
