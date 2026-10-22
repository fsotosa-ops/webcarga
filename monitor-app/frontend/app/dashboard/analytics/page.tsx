'use client'

import { Suspense } from 'react'
import { PageContainer } from '@/components/ui/PageContainer'
import { AnalyticsWorkspace } from '@/components/analytics/AnalyticsWorkspace'

/** Analítica: la BDOT reconstruida desde la app (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md).
 *  El encabezado lo dibuja la pantalla: su control de la derecha (período o fecha) depende de qué se mira. */
export default function AnalyticsPage() {
  return (
    <PageContainer>
      <Suspense fallback={null}><AnalyticsWorkspace /></Suspense>
    </PageContainer>
  )
}
