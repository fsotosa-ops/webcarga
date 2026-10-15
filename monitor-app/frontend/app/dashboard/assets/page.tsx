'use client'

import { Suspense } from 'react'
import { FleetList } from '@/components/dashboard/FleetList'

/** Directorio › Equipos (D4). */
export default function AssetsPage() {
  return <Suspense fallback={null}><FleetList kind="asset" /></Suspense>
}
