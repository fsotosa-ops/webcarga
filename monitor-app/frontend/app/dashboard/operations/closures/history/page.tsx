import { redirect } from 'next/navigation'

/** La Reportería pasó a Analítica (22/10): su tabla dinámica es ahora el modo "Tabla dinámica" de Flota por día
 *  (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md, criterio 15). Fusionar vistas, no agregar
 *  pantallas. La Reportería contaba conductores: se abre filtrada a conductores, con el rango si llega. */
const REPORTERIA_EN_ANALITICA = '/dashboard/analytics?dataset=fleet&mode=pivot&f.subject_type=DRIVER'

export default async function ReporteriaPage({ searchParams }: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const { desde, hasta } = await searchParams
  const iso = /^\d{4}-\d{2}-\d{2}$/
  redirect(desde && hasta && iso.test(desde) && iso.test(hasta)
    ? `${REPORTERIA_EN_ANALITICA}&period=custom&from=${desde}&to=${hasta}`
    : `${REPORTERIA_EN_ANALITICA}&period=this_month`)
}
