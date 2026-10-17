'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { insuranceApi, insuranceKeys } from '@/lib/api/insurance'
import { insuranceVerdictStyle } from '@/lib/states'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { StatusChip } from '@/components/ui/StatusChip'
import { Estado } from '@/components/ui/Estado'
import { CarrierInsuranceDetail } from './CarrierInsuranceDetail'

type Target = { id: string; label: string }

const OpenContext = createContext<((t: Target) => void) | null>(null)

/** Abrir el panel de seguro de una empresa desde Seguros (la fila de Empresas, el nombre
 *  de la empresa en Pólizas y en Cuotas). */
export function useOpenCarrierInsurance(): (t: Target) => void {
  const open = useContext(OpenContext)
  if (!open) throw new Error('useOpenCarrierInsurance fuera de CarrierInsurancePanelProvider')
  return open
}

/** El panel de seguro de una empresa (Seguros por empresa, 17/10): vista rápida sin fondo,
 *  como la del Directorio; adentro, el mismo detalle que la ficha de empresa. */
export function CarrierInsurancePanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null)
  const open = useCallback((t: Target) => setTarget(t), [])
  return (
    <OpenContext.Provider value={open}>
      {children}
      {target && <CarrierInsurancePanel target={target} onClose={() => setTarget(null)} />}
    </OpenContext.Provider>
  )
}

function CarrierInsurancePanel({ target, onClose }: { target: Target; onClose: () => void }) {
  const router = useRouter()
  const canEdit = usePermiso('policies.edit')
  const q = useQuery({ queryKey: insuranceKeys.carrier(target.id), queryFn: () => insuranceApi.carrier(target.id) })
  const verdict = q.data?.summary ? insuranceVerdictStyle(q.data.summary) : null
  return (
    <PanelLateral
      overlay="none"
      label={target.label}
      titulo={
        <span className="flex flex-col gap-1">
          <span className="truncate">{target.label}</span>
          {q.data?.summary && verdict && (
            <span className="flex flex-wrap items-center gap-2 font-sans text-etiqueta font-normal text-informativo">
              <span className="font-identificador">{q.data.summary.carrier_tax_id}</span>
              <StatusChip tone={verdict.tone} icon={verdict.icon}>{verdict.label}</StatusChip>
            </span>
          )}
        </span>
      }
      onCerrar={onClose}
      pie={null}
    >
      {q.isError ? <Estado tipo="error" titulo="No se pudo cargar el seguro de la empresa" detalle="Reintenta en unos segundos." />
        : !q.data ? <Estado tipo="cargando" />
        // Registrar una póliza se hace en la pestaña Seguros de la ficha, donde vive el formulario.
        : <CarrierInsuranceDetail detail={q.data} canEdit={canEdit}
            onAddPolicy={() => router.push(`/dashboard/carriers/${target.id}?tab=seguros`)} />}
    </PanelLateral>
  )
}
