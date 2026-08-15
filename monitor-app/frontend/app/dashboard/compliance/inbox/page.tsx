'use client'

import Link from 'next/link'
import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'

/** La bandeja de documentos sin clasificar — destino propio, no un tab.
 *
 *  Es la cola de trabajo de la HU-04: se entra y el trabajo está ahí, agrupado
 *  por empresa. La empresa es un filtro de la tabla, no un requisito previo —
 *  una bandeja que arranca vacía y pide adivinar una empresa es un buscador. */
export default function ComplianceInboxPage() {
  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Bandeja</h1>
        {/* El flujo completo en una línea: de dónde vienen estos documentos y a
            dónde van. Sin esto, Bandeja y Pendientes parecen dos listas sueltas
            del mismo módulo y no se entiende la relación. */}
        <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
          Los documentos llegan aquí sin saberse de quién son ni qué son. Al
          clasificarlos salen de la bandeja y pasan a cubrir un requisito en{' '}
          <Link href="/dashboard/compliance" className="text-accent hover:underline font-medium">
            Pendientes
          </Link>.
        </p>
      </div>
      <TriageWorkbench />
    </div>
  )
}
