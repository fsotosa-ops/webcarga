import { redirect } from 'next/navigation'
import { carrierHref } from '@/lib/navegacion/directory'

/** La ficha de empresa propia de Certificación se retiró en la Entrega C (14/10):
 *  hay una sola ficha, la del Directorio, y su pestaña Documentos tiene lo que
 *  vivía aquí. Un enlace guardado sigue llegando. */
export default async function CertificationCarrierRedirect({ params }: { params: Promise<{ carrierId: string }> }) {
  const { carrierId } = await params
  redirect(`${carrierHref(carrierId)}?tab=documentos`)
}
