'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { FleetProfile } from '@/components/dashboard/FleetProfile'

/** La ficha propia de un conductor (D4): su dirección canónica (HU 20261011/01). */
export default function DriverPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense><FleetProfile kind="driver" id={id} /></Suspense>
}
