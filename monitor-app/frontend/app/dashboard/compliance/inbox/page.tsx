'use client'

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
        <p className="text-xs text-gray-500 mt-0.5">
          Documentos cargados que todavía no están asignados a un requisito.
        </p>
      </div>
      <TriageWorkbench />
    </div>
  )
}
