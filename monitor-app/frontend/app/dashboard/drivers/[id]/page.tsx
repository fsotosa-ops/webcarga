'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { EntityRedirect } from '@/components/dashboard/EntityRedirect'

/** Dirección canónica de un conductor (HU 20261011/01). */
export default function DriverPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense><EntityRedirect kind="driver" id={id} /></Suspense>
}
