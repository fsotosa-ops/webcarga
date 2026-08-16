import type { ComponentType } from 'react'
import {
  EstadosTmsTab, EstadosOperacionalesTab, EstadosEquipoTab, TaxonomyTab,
} from './estados-tabs'
import {
  AlertasVencimientoTab, RangosTemperaturaTab, AlertasMonitorTab,
} from './umbrales-tabs'
import { CondicionesDocumentosTab } from './condiciones-tab'
import { SubtiposVehiculoTab, TiposOperacionTab, MotivosConductorTab } from './flota-tabs'
import { UsuariosTab } from './usuarios-tab'

export interface Seccion {
  clave:     string
  titulo:    string
  /** Una linea que dice a que pregunta responde la seccion. */
  proposito: string
  Panel:     ComponentType
}

export interface Dominio {
  clave:     string
  titulo:    string
  /** La pregunta que contesta el dominio. Si un ajuste no la contesta, esta mal ubicado. */
  proposito: string
  secciones: Seccion[]
  /** Reservado, sin contenido todavia. Se dibuja apagado y no es visitable. */
  proximamente?: boolean
}

/** FUENTE DE VERDAD del modulo de Configuracion.
 *
 *  Agregar un dominio es agregar una entrada aca: ni la portada ni la barra
 *  lateral ni las rutas se tocan. Esa es la prueba de que el marco escala —
 *  cuando llegue Facturacion, solo cambia este archivo.
 *
 *  Regla de ubicacion (spec seccion 3): un dominio no es una pestana con otro
 *  nombre. Si un ajuste no contesta el `proposito` del dominio, esta mal puesto. */
export const DOMINIOS: Dominio[] = [
  {
    clave: 'certificacion',
    titulo: 'Certificación',
    proposito: 'Qué documentos se exigen, a quién, y con cuánta anticipación se avisa',
    secciones: [
      { clave: 'condiciones', titulo: 'Condiciones de documentos',
        proposito: 'A quién se le exige cada documento', Panel: CondicionesDocumentosTab },
      { clave: 'vencimientos', titulo: 'Alertas de vencimiento',
        proposito: 'Con cuántos días de anticipación avisar', Panel: AlertasVencimientoTab },
    ],
  },
  {
    clave: 'operaciones',
    titulo: 'Operaciones',
    proposito: 'Cómo se ve el tablero, cuándo avisa, y qué temperatura corresponde',
    secciones: [
      { clave: 'estados-tms', titulo: 'Estados del tablero',
        proposito: 'Colores y columna de cada estado del TMS', Panel: EstadosTmsTab },
      { clave: 'estados-operacionales', titulo: 'Estados operacionales',
        proposito: 'El vocabulario que usa el equipo', Panel: EstadosOperacionalesTab },
      { clave: 'estados-equipo', titulo: 'Estados de equipo',
        proposito: 'El motivo cuando un equipo no sale', Panel: EstadosEquipoTab },
      { clave: 'umbrales', titulo: 'Umbrales de alerta',
        proposito: 'Cuándo el monitor considera que algo va mal', Panel: AlertasMonitorTab },
      { clave: 'temperaturas', titulo: 'Rangos de temperatura',
        proposito: 'Qué rango corresponde a cada tipo de carga', Panel: RangosTemperaturaTab },
      { clave: 'motivos-conductor', titulo: 'Motivos de conductor',
        proposito: 'Por qué un conductor no está disponible', Panel: MotivosConductorTab },
    ],
  },
  {
    clave: 'flota',
    titulo: 'Flota',
    proposito: 'El vocabulario de vehículos que comparten Certificación y Operaciones',
    secciones: [
      { clave: 'subtipos', titulo: 'Subtipos de vehículo',
        proposito: 'Furgón congelado, sider, rampla plana', Panel: SubtiposVehiculoTab },
      { clave: 'tipos-operacion', titulo: 'Tipos de operación',
        proposito: 'Tractoreo y equipo completo', Panel: TiposOperacionTab },
    ],
  },
  {
    clave: 'personas',
    titulo: 'Personas y accesos',
    proposito: 'Quién entra y qué puede hacer',
    secciones: [
      { clave: 'usuarios', titulo: 'Usuarios',
        proposito: 'Quién tiene cuenta y con qué rol', Panel: UsuariosTab },
    ],
  },
  {
    clave: 'facturacion',
    titulo: 'Facturación',
    proposito: 'Más adelante',
    secciones: [],
    proximamente: true,
  },
]

export function dominioPorClave(clave: string): Dominio | undefined {
  return DOMINIOS.find(d => d.clave === clave)
}
