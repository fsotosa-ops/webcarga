'use client'

import { Suspense, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { insuranceApi, insuranceKeys, type CarrierInsuranceRow } from '@/lib/api/insurance'
import {
  INSURANCE_STANDING_LABEL, INSURANCE_VERDICT_LABEL, INSURANCE_VERDICT_ORDER,
  fechaCorta, insuranceStanding, insuranceVerdictReason, insuranceVerdictStyle,
} from '@/lib/states'
import type { TableView } from '@/lib/table/viewInUrl'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { PageContainer } from '@/components/ui/PageContainer'
import { Estado } from '@/components/ui/Estado'
import { StatusChip } from '@/components/ui/StatusChip'
import { EntityCell } from '@/components/dashboard/EntityCell'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { ShortcutTiles, type ShortcutTileGroup } from '@/components/ui/tabla/data/ShortcutTiles'
import { useOpenCarrierInsurance } from '@/components/insurance/CarrierInsurancePanel'

const TABLE_KEY = 'insurance.carriers'
const NOT_UP_TO_DATE = INSURANCE_STANDING_LABEL.not_up_to_date
/** Gestión por excepción (spec, estándar de la industria): abre en lo que pide acción. */
const INITIAL_VIEW: TableView = { filters: { standing: [NOT_UP_TO_DATE] }, q: '', sort: null }

export default function EmpresasPage() {
  return <Suspense fallback={null}><EmpresasPageInner /></Suspense>
}

/** Seguros › Empresas (Seguros por empresa, 17/10): ¿qué transportistas no están al día
 *  con sus pólizas, y por qué? Una fila por empresa con el veredicto que calcula la base
 *  y su razón; el nombre abre el detalle (pólizas y cuotas) en el panel de Seguros. */
function EmpresasPageInner() {
  const [view, setView] = useUrlView({ initial: INITIAL_VIEW })
  const preferencias = useTablePreferences(TABLE_KEY)
  const openInsurance = useOpenCarrierInsurance()
  const overview = useQuery({ queryKey: insuranceKeys.overview(), queryFn: () => insuranceApi.carrierOverview() })

  const columnas = useMemo<DataColumn<CarrierInsuranceRow>[]>(() => [
    { id: 'carrier', header: 'Empresa', hideable: false, value: r => r.carrier_name,
      render: r => (
        <span className="flex flex-col">
          <span className="font-medium text-text-primary">
            <EntityCell kind="carrier" id={r.carrier_id} label={r.carrier_name} onOpen={openInsurance} />
          </span>
          <span className="font-identificador text-etiqueta text-informativo">{r.carrier_tax_id}</span>
        </span>
      ) },
    { id: 'verdict', header: 'Veredicto', value: r => INSURANCE_VERDICT_LABEL[r.insurance_verdict],
      options: INSURANCE_VERDICT_ORDER.map(v => INSURANCE_VERDICT_LABEL[v]),
      render: r => { const s = insuranceVerdictStyle(r); return <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip> } },
    { id: 'reason', header: 'Por qué', filter: false, sortable: false, value: r => insuranceVerdictReason(r),
      render: r => <span className="text-text-primary">{insuranceVerdictReason(r)}</span> },
    { id: 'next', header: 'Próxima cuota', filter: false, value: r => r.next_due_date,
      render: r => <span className="tabular-nums text-informativo">{r.next_due_date ? fechaCorta(r.next_due_date) : '—'}</span> },
    // La columna de los recuadros: No al día · Por vencer · Al día.
    { id: 'standing', header: 'Situación', defaultHidden: true,
      value: r => INSURANCE_STANDING_LABEL[insuranceStanding(r.insurance_verdict)],
      options: Object.values(INSURANCE_STANDING_LABEL) },
  ], [openInsurance])

  const model = useDataTable({
    rows: overview.data?.data ?? [], columns: columnas, getRowId: r => r.carrier_id, view, onViewChange: setView,
    columnPrefs: preferencias.columns,
    search: (r, q) => [r.carrier_name, r.carrier_tax_id].some(x => x.toLowerCase().includes(q)),
  })

  const recuadros: ShortcutTileGroup[] = [{ tiles: [
    { column: 'standing', value: NOT_UP_TO_DATE, label: NOT_UP_TO_DATE, tone: 'urgent' },
    { column: 'standing', value: INSURANCE_STANDING_LABEL.expiring, label: INSURANCE_STANDING_LABEL.expiring, tone: 'warning' },
    { column: 'standing', value: INSURANCE_STANDING_LABEL.up_to_date, label: INSURANCE_STANDING_LABEL.up_to_date, tone: 'resolved' },
  ] }]
  const soloNoAlDia = (view.filters.standing ?? []).join() === NOT_UP_TO_DATE

  return (
    <PageContainer>
      <EncabezadoDePagina titulo="Seguros" bajada="¿Qué transportistas no están al día con sus pólizas?" />
      {overview.isError ? (
        <Estado tipo="error" titulo="No se pudo cargar Seguros" detalle="Reintenta en unos segundos." />
      ) : overview.isPending ? (
        <Estado tipo="cargando" />
      ) : (
        <div className="space-y-4">
          <ShortcutTiles model={model} groups={recuadros} />
          <TableToolbar model={model} searchPlaceholder="Empresa o RUT…" preferences={preferencias} />
          <DataTable model={model} label="Seguros por empresa" pageSizes={[50, 100]}
            empty={soloNoAlDia && !view.q ? 'Todas las empresas están al día' : 'Nada en esta vista. Prueba con otro recuadro o limpia los filtros.'} />
        </div>
      )}
    </PageContainer>
  )
}
