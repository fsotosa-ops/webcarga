import { redirect } from 'next/navigation'

/** La ruta vieja en espanol. El estandar del proyecto es slug en INGLES y
 *  etiqueta visible en espanol (normalizacion de rutas, Ronda 55), y este
 *  modulo la habia extendido en espanol por descuido.
 *
 *  Redirige en vez de dar 404 porque estuvo meses en el menu lateral: es el
 *  mismo criterio que se uso para /dashboard/admin/usuarios. */
export default function ConfiguracionRedirect() {
  redirect('/dashboard/admin/settings')
}
