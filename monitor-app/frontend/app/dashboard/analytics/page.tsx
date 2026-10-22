'use client'

import { Suspense } from 'react'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { PageContainer } from '@/components/ui/PageContainer'
import { AnalyticsWorkspace } from '@/components/analytics/AnalyticsWorkspace'

/** Analítica: la BDOT reconstruida desde la app (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md). */
export default function AnalyticsPage() {
  return (
    <PageContainer>
      <EncabezadoDePagina titulo="Analítica" bajada="Viajes y flota de cualquier período, con tus columnas y vistas." />
      <Suspense fallback={null}><AnalyticsWorkspace /></Suspense>
    </PageContainer>
  )
}
