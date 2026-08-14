import { redirect } from 'next/navigation'

/** Ruta anterior del módulo Certificación.
 *
 *  Se conserva como redirección permanente: `?carrier_id=` es un contrato en
 *  uso desde la Ronda 88 — lo emiten los links de salida de la ficha de
 *  empresa, del panel de conductor y del de vehículo, y puede estar guardado
 *  en marcadores del equipo. */
export default function CertificationRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (typeof v === 'string') qs.set(k, v)
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  // `return` a propósito: redirect() devuelve `never`, y sin retornarlo la
  // función queda tipada como `void`, que no es un componente JSX válido.
  return redirect(`/dashboard/compliance${suffix}`)
}
