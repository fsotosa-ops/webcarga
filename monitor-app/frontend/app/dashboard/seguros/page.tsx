'use client'

import { Suspense, useState } from 'react'
import { PolizasTab } from '@/components/dashboard/PolizasTab'
import { CobranzaTab } from '@/components/dashboard/CobranzaTab'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { useCanEdit } from '@/hooks/useCanEdit'

type Tab = 'polizas' | 'cobranza'

export default function SegurosPage() {
  return (
    <Suspense fallback={null}>
      <SegurosPageInner />
    </Suspense>
  )
}

function SegurosPageInner() {
  const [tab, setTab] = useState<Tab>('polizas')
  const canAdmin = useCanAdmin()
  const canEdit = useCanEdit()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-4 md:px-6 pt-4">
        <h1 className="font-mulish font-bold text-xl text-text-primary">Seguros</h1>
      </div>
      <div role="tablist" aria-label="Secciones de Seguros" className="flex border-b border-border px-4 md:px-6 mt-2">
        <button
          role="tab"
          aria-selected={tab === 'polizas'}
          onClick={() => setTab('polizas')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'polizas' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Pólizas
        </button>
        <button
          role="tab"
          aria-selected={tab === 'cobranza'}
          onClick={() => setTab('cobranza')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'cobranza' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Cobranza
        </button>
      </div>
      <div role="tabpanel" className="flex-1 overflow-y-auto">
        {tab === 'polizas'  && <PolizasTab canAdmin={canAdmin} canEdit={canEdit} />}
        {tab === 'cobranza' && <CobranzaTab canAdmin={canAdmin} />}
      </div>
    </div>
  )
}
