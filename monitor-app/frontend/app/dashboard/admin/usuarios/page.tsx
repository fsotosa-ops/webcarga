import { redirect } from 'next/navigation'

/** Usuarios se mudó a Configuración > Personas y accesos. La ruta vieja
 *  redirige en vez de dar 404 porque estuvo meses en el menú lateral. */
export default function UsuariosRedirect() {
  redirect('/dashboard/admin/configuracion/personas')
}
