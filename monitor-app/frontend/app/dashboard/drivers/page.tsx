'use client'

import { Suspense } from 'react'
import { FleetList } from '@/components/dashboard/FleetList'

/** Directorio › Conductores (D4). */
export default function DriversPage() {
  return <Suspense fallback={null}><FleetList kind="driver" /></Suspense>
}
