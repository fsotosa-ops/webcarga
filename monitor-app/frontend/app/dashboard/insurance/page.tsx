import { redirect } from 'next/navigation'
import { legacyPoliciesHref } from '@/lib/navegacion/insurance'
import { CarrierInsuranceOverview } from '@/components/insurance/CarrierInsuranceOverview'

type SearchParams = Record<string, string | string[] | undefined>

/** Seguros › Empresas. Hasta el 17/10 esta dirección era Pólizas: un marcador o enlace
 *  viejo (`?state=`, `?page=`, `?group=`) sigue llegando a lo que mostraba. */
export default async function InsurancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') params.set(k, v)
  const legacy = legacyPoliciesHref(params)
  if (legacy) redirect(legacy)
  return <CarrierInsuranceOverview />
}
