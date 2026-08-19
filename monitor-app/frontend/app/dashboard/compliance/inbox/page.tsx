'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { carriersApi } from '@/lib/api/carriers'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'

/** La empresa con la que llega el lote, si se entró desde la ficha de una.
 *  Viaja sólo el id: el nombre se pregunta, para que un enlace compartido no
 *  lleve escrito el nombre de una empresa ni pueda mostrar uno desactualizado.
 *
 *  La cola NO se acota: la Bandeja sigue mostrando todo lo que espera. Esto
 *  responde "¿de quién es lo que voy a subir?", que es otra pregunta. */
function EmpresaDelEnlace() {
  const empresaId = useSearchParams().get('empresa')
  const empresaQuery = useQuery({
    queryKey: ['carrier-detail', empresaId],
    queryFn: () => carriersApi.get(empresaId!),
    enabled: !!empresaId,
  })
  const empresa = empresaQuery.data

  return (
    <TriageWorkbench
      empresaInicial={empresa
        ? { id: empresa.id, business_name: empresa.business_name, tax_id: empresa.tax_id }
        : null}
    />
  )
}

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
      <Suspense fallback={null}>
        <EmpresaDelEnlace />
      </Suspense>
    </div>
  )
}
