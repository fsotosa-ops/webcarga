import type { TripsMeta } from '@/lib/types'

export async function fetchTripsMeta(): Promise<TripsMeta> {
  const res = await fetch('/api/v1/trips/meta', { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`Error ${res.status} al cargar metadatos de viajes`)
  return res.json()
}
