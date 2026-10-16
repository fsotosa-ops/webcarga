'use client'

import type { ComponentType } from 'react'
import { SettingsList } from './SettingsList'
import {
  SECCION_DE_TAXONOMIA, boardStatusSource, monitorRulesSource, temperatureRangeSource, thresholdSource, vocabularySource,
  type SettingsSource,
} from './settings-sources'

/** El panel de una sección hecho desde su fuente: todas se dibujan con
 *  `SettingsList` (Configuración, Parte 1). */
function porFuente<Row extends { id: string }>(source: SettingsSource<Row>, nombre: string): ComponentType {
  const Panel = () => <SettingsList source={source} />
  Panel.displayName = nombre
  return Panel
}

/** Las secciones que se dibujan con `SettingsList`: abren un elemento con `?item=`. */
export const SECCIONES_CON_LISTA: string[] = [
  boardStatusSource.section, monitorRulesSource.section, temperatureRangeSource.section, 'expiry-alerts',
  ...Object.values(SECCION_DE_TAXONOMIA).map(([, seccion]) => seccion),
]

export const EstadosDelTableroPanel = porFuente(boardStatusSource, 'EstadosDelTableroPanel')
export const EstadosOperacionalesPanel = porFuente(vocabularySource('OPERATIONAL_STATE'), 'EstadosOperacionalesPanel')
export const EstadosDeEquipoPanel = porFuente(vocabularySource('EQUIPMENT_STATE'), 'EstadosDeEquipoPanel')
export const MotivosDeConductorPanel = porFuente(vocabularySource('DRIVER_REASON'), 'MotivosDeConductorPanel')
export const MotivosDeNoAsignacionPanel = porFuente(vocabularySource('TRIP_UNASSIGNED_REASON'), 'MotivosDeNoAsignacionPanel')
export const MotivosDeAnulacionPanel = porFuente(vocabularySource('TRIP_VOID_REASON'), 'MotivosDeAnulacionPanel')
export const SubtiposPanel = porFuente(vocabularySource('FLEET_SERVICE_TYPE'), 'SubtiposPanel')
export const TiposDeOperacionPanel = porFuente(vocabularySource('WEBCARGA_OPERATION_TYPE'), 'TiposDeOperacionPanel')
export const AlertasDeDocumentosPanel = porFuente(thresholdSource('documento_por_vencer'), 'AlertasDeDocumentosPanel')
export const AlertasDePolizasPanel = porFuente(thresholdSource('poliza_por_vencer'), 'AlertasDePolizasPanel')
export const RangosDeTemperaturaPanel = porFuente(temperatureRangeSource, 'RangosDeTemperaturaPanel')
export const UmbralesDelMonitorPanel = porFuente(monitorRulesSource, 'UmbralesDelMonitorPanel')
