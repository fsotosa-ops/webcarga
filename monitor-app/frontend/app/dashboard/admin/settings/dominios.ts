import type { ComponentType } from 'react'
import {
  Shield, ShieldCheck, LayoutDashboard, Truck, Users, Receipt, type LucideIcon,
} from 'lucide-react'
import {
  EstadosDelViajePanel, EstadosOperacionalesPanel, EstadosDeEquipoPanel, MotivosDeConductorPanel,
  MotivosDeNoAsignacionPanel, MotivosDeAnulacionPanel, SubtiposPanel, TiposDeOperacionPanel,
  SECCIONES_CON_LISTA, AlertasDeDocumentosPanel, AlertasDePolizasPanel, RangosDeTemperaturaPanel,
  UmbralesDelMonitorPanel,
} from './paneles'
import { UsuariosTab } from './usuarios-tab'
import { RolesTab } from './roles-tab'
import { LECTURA_DE_SECCION, PERMISO_DE_SECCION, type ClaveDeSeccion } from './secciones'
import { REQUIREMENTS } from '@/lib/navegacion/compliance'

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
      { clave: 'expiry-alerts', titulo: 'Alertas de vencimiento',
        proposito: 'Con cuántos días de anticipación avisar', Panel: AlertasDeDocumentosPanel },
    ],
  },
  {
    clave: 'operations',
    icono: LayoutDashboard,
    titulo: 'Operaciones',
    proposito: 'Cómo se ven los viajes, cuándo avisa, y qué temperatura corresponde',
    secciones: [
      { clave: 'tms-statuses', titulo: 'Estados del viaje',
        proposito: 'Cómo se llama cada estado del TMS y en qué etapa del viaje cae', Panel: EstadosDelViajePanel },
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
    ],
  },
  {
    clave: 'fleet',
    icono: Truck,
    titulo: 'Flota',
    proposito: 'El vocabulario de equipos que comparten Certificación y Operaciones',
    secciones: [
      { clave: 'subtypes', titulo: 'Subtipos de equipo',
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

/** Secciones que salieron de Configuración. Un origen es un lugar del cliente y
 *  un nombre del TMS es cómo se llama el cliente, así que viven con él (Parte 3);
 *  los documentos exigidos son el catálogo de trabajo de Certificación (Parte 2).
 *  Sus direcciones viejas llevan a su lugar nuevo; `param` es con qué abre el
 *  elemento que el enlace viejo traía abierto (`?doc=` de Condiciones, por código). */
const MUDADAS: Record<string, { destino: string; ubicacion: string; param?: string }> = {
  'operations/origins':       { destino: '/dashboard/pricing?origen=1', ubicacion: 'Tarifario · Orígenes' },
  'operations/tms-clients':   { destino: '/dashboard/clients?vista=sin-vincular', ubicacion: 'Directorio · Clientes' },
  'certification/conditions': { destino: REQUIREMENTS, ubicacion: 'Certificación · Documentos exigidos', param: 'doc' },
}

/** Adónde lleva una sección mudada; con `abre`, el elemento que traía abierto. */
export function destinoMudado(area: string, seccion: string | null, abre?: string | null): string | undefined {
  const m = seccion ? MUDADAS[`${area}/${seccion}`] : undefined
  if (!m) return undefined
  return m.param && abre
    ? `${m.destino}${m.destino.includes('?') ? '&' : '?'}${m.param}=${encodeURIComponent(abre)}`
    : m.destino
}

/** Dónde vive ahora una sección mudada, para rotular un resultado del buscador. */
export function ubicacionMudada(area: string, seccion: string): string | undefined {
  return MUDADAS[`${area}/${seccion}`]?.ubicacion
}

export function dominioPorClave(clave: string): Dominio | undefined {
  return DOMINIOS.find(d => d.clave === clave)
}

/** Con qué parámetro abre un elemento cada sección (lo usa el buscador): las de
 *  `SettingsList` abren con `?item=`. */
export const PARAM_DE_SECCION: Record<string, string> = Object.fromEntries(SECCIONES_CON_LISTA.map(s => [s, 'item']))


/** Un área se ve si la persona tiene el permiso de alguna de sus secciones
 *  (Configuración, Parte 1); dentro, las demás secciones se ven en solo lectura.
 *  Un área reservada (Facturación) no se ve. */
const clave = (d: Dominio, s: Seccion) => `${d.clave}/${s.clave}` as ClaveDeSeccion

/** Las secciones de un área que la persona puede leer (Personas y Roles exigen
 *  `users.manage` hasta para leerse, como la API). */
export function seccionesVisibles(d: Dominio, permisos: readonly string[]): Seccion[] {
  return d.secciones.filter(s => {
    const lectura = LECTURA_DE_SECCION[clave(d, s)]
    return !lectura || permisos.includes(lectura)
  })
}

/** La primera sección que la persona puede editar: ahí aterriza al entrar al área. */
export function primeraEditable(d: Dominio, permisos: readonly string[]): Seccion | undefined {
  return seccionesVisibles(d, permisos).find(s => permisos.includes(PERMISO_DE_SECCION[clave(d, s)]))
}

export function puedeVerArea(d: Dominio, permisos: readonly string[]): boolean {
  return !d.proximamente && !!primeraEditable(d, permisos)
}

/** Las áreas que la persona ve, en el orden del registro. */
export function areasVisibles(permisos: readonly string[]): Dominio[] {
  return DOMINIOS.filter(d => puedeVerArea(d, permisos))
}

export function rutaDeSeccion(area: string, seccion: string): string {
  return `/dashboard/admin/settings/${area}/${seccion}`
}
