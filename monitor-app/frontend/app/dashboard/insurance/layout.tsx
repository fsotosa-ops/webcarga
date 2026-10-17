import type { ReactNode } from 'react'
import { CarrierInsurancePanelProvider } from '@/components/insurance/CarrierInsurancePanel'

/** Seguros: el panel de seguro de una empresa se abre desde cualquiera de sus pantallas
 *  (Empresas, Pólizas, Cuotas, la ficha de una póliza). */
export default function InsuranceLayout({ children }: { children: ReactNode }) {
  return <CarrierInsurancePanelProvider>{children}</CarrierInsurancePanelProvider>
}
