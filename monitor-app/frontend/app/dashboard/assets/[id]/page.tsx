'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { EntityRedirect } from '@/components/dashboard/EntityRedirect'

/** Dirección canónica de un equipo (HU 20261011/01). */
export default function AssetPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense><EntityRedirect kind="asset" id={id} /></Suspense>
}
