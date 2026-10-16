'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { PolicyProfile } from '@/components/insurance/PolicyProfile'

/** La ficha de una póliza (Seguros E2). */
export default function PolicyPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense fallback={null}><PolicyProfile id={id} /></Suspense>
}
