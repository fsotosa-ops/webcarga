import type { ComponentType } from 'react'
import {
  Shield, ShieldCheck, LayoutDashboard, Truck, Users, Receipt, type LucideIcon,
} from 'lucide-react'
import { CondicionesTabla } from './condiciones-tabla'
import {
  EstadosDelTableroPanel, EstadosOperacionalesPanel, EstadosDeEquipoPanel, MotivosDeConductorPanel,
  MotivosDeNoAsignacionPanel, MotivosDeAnulacionPanel, SubtiposPanel, TiposDeOperacionPanel,
  SECCIONES_CON_LISTA, AlertasDeDocumentosPanel, AlertasDePolizasPanel, RangosDeTemperaturaPanel,
  UmbralesDelMonitorPanel,
} from './paneles'
import { UsuariosTab } from './usuarios-tab'
import { RolesTab } from './roles-tab'
import { PERMISO_DE_SECCION, type ClaveDeSeccion } from './secciones'
import { OrigenesTab } from './origenes'
import { ClientesDelTmsTab } from './clientes-del-tms'

export interface Seccion {
  /** La parte corta de la URL; `area/clave` tiene que estar en PERMISO_DE_SECCION
   *  (secciones.ts): dominios.test.ts falla si falta. */
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
        proposito: 'Con cuántos días de anticipación avisar', Panel: AlertasDeDocumentosPanel },
    ],
  },
  {
    clave: 'operations',
    icono: LayoutDashboard,
    titulo: 'Operaciones',
    proposito: 'Cómo se ve el tablero, cuándo avisa, y qué temperatura corresponde',
    secciones: [
      { clave: 'tms-statuses', titulo: 'Estados del tablero',
        proposito: 'Cómo se llama cada estado del TMS y en qué columna del tablero aparece', Panel: EstadosDelTableroPanel },
      { clave: 'operational-statuses', titulo: 'Estados operacionales',
        proposito: 'El vocabulario que usa el equipo', Panel: EstadosOperacionalesPanel },
      { clave: 'equipment-statuses', titulo: 'Estados de equipo',
        proposito: 'El motivo cuando un equipo no sale', Panel: EstadosDeEquipoPanel },
      { clave: 'alert-thresholds', titulo: 'Umbrales de alerta',
        proposito: 'Cuándo el monitor considera que algo va mal', Panel: UmbralesDelMonitorPanel },
      { clave: 'temperature-ranges', titulo: 'Rangos de temperatura',
        proposito: 'Qué rango corresponde a cada tipo de carga', Panel: RangosDeTemperaturaPanel },
      { clave: 'driver-reasons', titulo: 'Motivos de conductor',
        proposito: 'Por qué un conductor no está disponible', Panel: MotivosDeConductorPanel },
      { clave: 'unassigned-reasons', titulo: 'Motivos de no asignación',
        proposito: 'Por qué WebCarga no tomó una carga que le ofrecieron', Panel: MotivosDeNoAsignacionPanel },
      { clave: 'void-reasons', titulo: 'Motivos de anulación',
        proposito: 'Por qué se anula un viaje cargado en la app', Panel: MotivosDeAnulacionPanel },
      { clave: 'origins', titulo: 'Orígenes',
        proposito: 'Los lugares desde los que sale carga', Panel: OrigenesTab },
      { clave: 'tms-clients', titulo: 'Clientes del TMS',
        proposito: 'A qué cliente del directorio corresponde cada cliente de cada TMS', Panel: ClientesDelTmsTab },
    ],
  },
  {
    clave: 'fleet',
    icono: Truck,
    titulo: 'Flota',
    proposito: 'El vocabulario de vehículos que comparten Certificación y Operaciones',
    secciones: [
      { clave: 'subtypes', titulo: 'Subtipos de vehículo',
        proposito: 'Furgón congelado, sider, rampla plana', Panel: SubtiposPanel },
      { clave: 'operation-types', titulo: 'Tipos de operación',
        proposito: 'Tractoreo y equipo completo', Panel: TiposDeOperacionPanel },
    ],
  },
  {
    clave: 'insurance',
    icono: Shield,
    titulo: 'Seguros',
    proposito: 'Cuándo una póliza está por vencer',
    secciones: [
      { clave: 'expiry-alerts', titulo: 'Alertas de vencimiento',
        proposito: 'Con cuántos días de anticipación se avisa que una póliza vence', Panel: AlertasDePolizasPanel },
    ],
  },
  {
    clave: 'people',
    icono: Users,
    titulo: 'Personas y accesos',
    proposito: 'Quién entra y qué puede hacer',
    secciones: [
      { clave: 'users', titulo: 'Personas',
        proposito: 'Quién tiene cuenta y con qué roles', Panel: UsuariosTab },
      { clave: 'roles', titulo: 'Roles',
        proposito: 'Qué puede hacer cada rol', Panel: RolesTab },
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

/** Con qué parámetro abre un elemento cada sección (lo usa el buscador): las de
 *  `SettingsList` abren con `?item=`; Condiciones, por código (`?doc=`), hasta que
 *  pase a Certificación (Parte 2). */
export const PARAM_DE_SECCION: Record<string, string> = {
  conditions: 'doc',
  ...Object.fromEntries(SECCIONES_CON_LISTA.map(s => [s, 'item'])),
}


/** Un área se ve si la persona tiene el permiso de alguna de sus secciones
 *  (Configuración, Parte 1); dentro, las demás secciones se ven en solo lectura.
 *  Un área reservada (Facturación) no se ve. */
export function puedeVerArea(d: Dominio, permisos: readonly string[]): boolean {
  return !d.proximamente && d.secciones.some(s =>
    permisos.includes(PERMISO_DE_SECCION[`${d.clave}/${s.clave}` as ClaveDeSeccion]))
}

/** Las áreas que la persona ve, en el orden del registro. */
export function areasVisibles(permisos: readonly string[]): Dominio[] {
  return DOMINIOS.filter(d => puedeVerArea(d, permisos))
}

export function rutaDeSeccion(area: string, seccion: string): string {
  return `/dashboard/admin/settings/${area}/${seccion}`
}
