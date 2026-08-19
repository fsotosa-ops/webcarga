'use client'

import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'

/** La Bandeja: archivos que llegaron sueltos, todavía sin empresa ni
 *  requisito asignado.
 *
 *  Volvió a ser un destino propio (Task 5). Vivió un tiempo como la vista
 *  "Por documento" de Certificación porque se la trató como una cuarta
 *  manera de mirar la MISMA lista de empresas — y no lo es: acá el objeto de
 *  trabajo es el archivo sin destino, no el requisito sin documento.
 *  Certificación responde "¿qué le falta a esta empresa?"; la Bandeja
 *  responde "¿de quién es este archivo?". Son dos trabajos distintos, así
 *  que cada uno tiene su propia entrada en el sidebar y su propia ruta.
 *
 *  Esta ruta se conservó sin uso mientras era sólo un redirect —"quedó en
 *  enlaces guardados y en el historial"—, y ese mismo motivo es el que ahora
 *  la trae de vuelta: `?vista=documentos` redirige PARA ACÁ
 *  (`app/dashboard/compliance/page.tsx`), no al revés. */
export default function ComplianceInboxPage() {
  return (
    <div className="p-4 md:p-6 space-y-3">
      <EncabezadoDePagina
        titulo="Sin clasificar"
        bajada="Archivos que llegaron sueltos, todavía sin empresa ni requisito asignado."
      />
      <TriageWorkbench />
    </div>
  )
}
