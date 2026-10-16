'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CarrierListItem } from '@/lib/types'
import { carrierHref } from '@/lib/navegacion/directory'
import { StatusChip } from '@/components/ui/StatusChip'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { TransporterCard } from '@/components/dashboard/TransporterCard'
import { enablementStyle, lifecycleStyle } from '@/lib/states'
import { updatedRelative } from '@/lib/compliance'

/** La tabla de empresas: Directorio › Empresas y la pestaña Empresas de la
 *  ficha de un cliente. En teléfono, las mismas tarjetas que la vista Tarjetas.
 *  `returnTo` es la pantalla a la que vuelve la ficha de la empresa. */
export function CarriersTable({ items, returnTo }: { items: CarrierListItem[]; returnTo: string }) {
  const router = useRouter()
  return (
    <>
      <div className="md:hidden grid grid-cols-1 gap-3">
        {items.map(item => <TransporterCard returnTo={returnTo} key={item.id} item={item} />)}
      </div>

      <div className="hidden md:block bg-white rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-dato">
          <thead>
            <tr className="border-b border-border bg-bg-main">
              <th scope="col" className={CABECERA}>Empresa</th>
              <th scope="col" className={`${CABECERA} w-32`}>RUT</th>
              <th scope="col" className={`${CABECERA} w-32`}>Estado</th>
              <th scope="col" className={`${CABECERA} w-36`}>Habilitación</th>
              <th scope="col" className={`${CABECERA} w-44`}>Última actualización</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const lifecycle = lifecycleStyle('carrier', item.operational_status)
              const enablement = enablementStyle(item.compliance_summary, item.operational_status === 'ACTIVE')
              const href = carrierHref(item.id, returnTo)
              return (
                // La fila entera abre la ficha, como en Conductores y Equipos; el
                // nombre es el enlace (Ctrl/Cmd + clic, lector de pantalla).
                <tr
                  key={item.id}
                  onClick={() => router.push(href)}
                  className="border-b border-border/60 last:border-0 cursor-pointer transition-colors hover:bg-bg-main"
                >
                  <td className="px-3 py-2.5">
                    {/* prefetch=false: precargar las 100 filas visibles agota el límite de tasa. */}
                    <Link href={href} prefetch={false} onClick={e => e.stopPropagation()}
                          className="font-semibold text-text-primary hover:text-accent">
                      {item.business_name || <span className="italic text-informativo">Sin nombre</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-identificador text-etiqueta text-informativo">{item.tax_id}</td>
                  <td className="px-3 py-2.5"><StatusChip tone={lifecycle.tone} icon={lifecycle.icon}>{lifecycle.label}</StatusChip></td>
                  <td className="px-3 py-2.5"><StatusChip tone={enablement.tone} icon={enablement.icon}>{enablement.label}</StatusChip></td>
                  <td className="px-3 py-2.5 text-etiqueta text-informativo whitespace-nowrap">{updatedRelative(item.last_document_update) ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
