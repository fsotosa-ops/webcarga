import type { ComponentType } from 'react'
import {
  ShieldCheck, LayoutDashboard, Truck, Users, Receipt, type LucideIcon,
} from 'lucide-react'
import {
  EstadosOperacionalesTab, EstadosEquipoTab,
} from './estados-tabs'
import {
  AlertasVencimientoTab, RangosTemperaturaTab, AlertasMonitorTab,
} from './umbrales-tabs'
import { CondicionesTabla } from './condiciones-tabla'
import { EstadosTabla } from './estados-tabla'
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
  /** Cada dominio tiene su icono, como cada item de la barra lateral. Vive en
   *  el registro y no en la portada porque es parte de la identidad del
   *  dominio, no de la pantalla que lo dibuja. */
  icono:     LucideIcon
  /** La pregunta que contesta el dominio. Si un ajuste no la contesta, esta mal ubicado. */
  proposito: string
  secciones: Seccion[]
  /** Reservado, sin contenido todavia. Se dibuja apagado y no es visitable. */
  proximamente?: boolean
}

/** FUENTE DE VERDAD del modulo de Configuracion.
 *
 *  Las CLAVES son slugs de URL y van en INGLES; los titulos y propositos que se
 *  ven en pantalla van en espanol. Es el estandar que fijo la normalizacion de
 *  rutas (Ronda 55): /dashboard/carriers muestra "Empresas".
 *
 *  Agregar un dominio es agregar una entrada aca: ni la portada ni la barra
 *  lateral ni las rutas se tocan. Esa es la prueba de que el marco escala —
 *  cuando llegue Facturacion, solo cambia este archivo.
 *
 *  Regla de ubicacion (spec seccion 3): un dominio no es una pestana con otro
 *  nombre. Si un ajuste no contesta el `proposito` del dominio, esta mal puesto. */
export const DOMINIOS: Dominio[] = [
  {
    clave: 'certification',
    icono: ShieldCheck,
    titulo: 'Certificación',
    proposito: 'Qué documentos se exigen, a quién, y con cuánta anticipación se avisa',
    secciones: [
      { clave: 'conditions', titulo: 'Condiciones de documentos',
        proposito: 'A quién se le exige cada documento', Panel: CondicionesTabla },
      { clave: 'expiry-alerts', titulo: 'Alertas de vencimiento',
        proposito: 'Con cuántos días de anticipación avisar', Panel: AlertasVencimientoTab },
    ],
  },
  {
    clave: 'operations',
    icono: LayoutDashboard,
    titulo: 'Operaciones',
    proposito: 'Cómo se ve el tablero, cuándo avisa, y qué temperatura corresponde',
    secciones: [
      { clave: 'tms-statuses', titulo: 'Estados del tablero',
        proposito: 'Colores y columna de cada estado del TMS', Panel: EstadosTabla },
      { clave: 'operational-statuses', titulo: 'Estados operacionales',
        proposito: 'El vocabulario que usa el equipo', Panel: EstadosOperacionalesTab },
      { clave: 'equipment-statuses', titulo: 'Estados de equipo',
        proposito: 'El motivo cuando un equipo no sale', Panel: EstadosEquipoTab },
      { clave: 'alert-thresholds', titulo: 'Umbrales de alerta',
        proposito: 'Cuándo el monitor considera que algo va mal', Panel: AlertasMonitorTab },
      { clave: 'temperature-ranges', titulo: 'Rangos de temperatura',
        proposito: 'Qué rango corresponde a cada tipo de carga', Panel: RangosTemperaturaTab },
      { clave: 'driver-reasons', titulo: 'Motivos de conductor',
        proposito: 'Por qué un conductor no está disponible', Panel: MotivosConductorTab },
    ],
  },
  {
    clave: 'fleet',
    icono: Truck,
    titulo: 'Flota',
    proposito: 'El vocabulario de vehículos que comparten Certificación y Operaciones',
    secciones: [
      { clave: 'subtypes', titulo: 'Subtipos de vehículo',
        proposito: 'Furgón congelado, sider, rampla plana', Panel: SubtiposVehiculoTab },
      { clave: 'operation-types', titulo: 'Tipos de operación',
        proposito: 'Tractoreo y equipo completo', Panel: TiposOperacionTab },
    ],
  },
  {
    clave: 'people',
    icono: Users,
    titulo: 'Personas y accesos',
    proposito: 'Quién entra y qué puede hacer',
    secciones: [
      { clave: 'users', titulo: 'Usuarios',
        proposito: 'Quién tiene cuenta y con qué rol', Panel: UsuariosTab },
    ],
  },
  {
    clave: 'billing',
    icono: Receipt,
    titulo: 'Facturación',
    proposito: 'Más adelante',
    secciones: [],
    proximamente: true,
  },
]

export function dominioPorClave(clave: string): Dominio | undefined {
  return DOMINIOS.find(d => d.clave === clave)
}
