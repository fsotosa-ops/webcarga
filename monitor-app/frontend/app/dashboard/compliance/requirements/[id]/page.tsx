'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { RequirementProfile } from '@/components/compliance/requirements/RequirementProfile'

/** La ficha de un documento exigido (Configuración, Parte 2). */
export default function RequirementPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense><RequirementProfile id={id} /></Suspense>
}
