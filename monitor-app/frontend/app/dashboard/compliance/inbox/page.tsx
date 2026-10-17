'use client'

import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'
import { DiscardedItems } from '@/components/compliance/DiscardedItems'
import { PageContainer } from '@/components/ui/PageContainer'

/** Por asignar (Entrega D, 15/10): la bandeja de lo que no se pudo asignar al subir.
 *  Se sube con "Subir documentos", la misma revisión de lote de Pendientes y de la
 *  ficha de empresa; aquí llega solo lo que esa revisión no resolvió.
 *
 *  La ruta sigue siendo `/inbox` (rutas en inglés) y `?vista=documentos` de
 *  Certificación redirige para acá: un enlace guardado no queda roto. */
export default function ComplianceInboxPage() {
  return (
    <PageContainer>
      <TriageWorkbench />
      <DiscardedItems />
    </PageContainer>
  )
}
