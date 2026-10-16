'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { ClientProfile } from '@/components/directory/ClientProfile'

/** La ficha de un cliente del directorio (Configuración, Parte 3). */
export default function ClientPage() {
  const { id } = useParams<{ id: string }>()
  return <Suspense><ClientProfile id={id} /></Suspense>
}
