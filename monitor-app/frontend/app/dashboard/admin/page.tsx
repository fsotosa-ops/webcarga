import { redirect } from 'next/navigation'

/** Administracion entra por Configuracion desde 2026-08-16: el modulo se
 *  organiza por dominios y Usuarios pasó a ser uno de ellos ("Personas y
 *  accesos"), asi que ya no corresponde que la raiz de admin lleve directo a
 *  una seccion suelta. */
export default function AdminPage() {
  redirect('/dashboard/admin/configuracion')
}
