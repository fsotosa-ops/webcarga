import { redirect } from 'next/navigation'

/** La bandeja dejó de ser un destino propio: es la vista "Por documento" del
 *  módulo Certificación. Tenerla como submódulo hermano de Pendientes obligaba
 *  a cruzar de memoria dos listas del mismo objeto.
 *
 *  La ruta se conserva porque quedó en enlaces guardados y en el historial. */
export default function ComplianceInboxRedirect() {
  return redirect('/dashboard/compliance?vista=documentos')
}
