# Seguros por empresa — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10: sin subagentes,
> un test por criterio visto en rojo antes, humo E2E, un despliegue, revisión final opus). Pasos con checkbox.
> **Va después de** `2026-10-17-navegacion-movil.md` (este plan edita el menú en `lib/navegacion/menu.ts`).

**Goal:** Seguros › Empresas: una fila por empresa con un veredicto único (calculado en la base), que abre en "No al
día" y muestra el detalle de la empresa en un panel; Pólizas y Cuotas quedan como listas de trabajo planas.

**Architecture:** la vista `app.carrier_insurance_summary` pasa a armarse desde `public.carriers` y entrega el
veredicto, los datos de su razón y `insurance_alert` (con su regla de hoy). Un router nuevo `/insurance` expone la lista
por empresa y el detalle de una empresa (pólizas con cuotas, en una consulta). En el frontend, el glosario redacta
veredicto y razón (`lib/states.ts`); la página usa la tabla del kit con recuadros y la vista en la URL; el detalle es una
pieza (`CarrierInsuranceDetail`) que comparten el panel y la pestaña Seguros de la ficha de empresa.

**Tech Stack:** FastAPI + asyncpg, Postgres (vista), pytest; Next.js 16, React 19, TanStack Query, TanStack Table (kit),
vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-seguros-por-empresa-design.md` (criterios E1-E10).
**Maqueta:** `.superpowers/brainstorm/78194-1792268599/content/seguros-opcion-c.html`.

## Global Constraints

- Sin parches ni código duplicado: lo que se reemplaza se borra en la misma tarea (`list_carriers`, `CARRIER_STATES`,
  `group_by=carrier`, `GET /carriers/{id}/policies`, `CarriersInsuranceTable`, `carrierInsuranceStyle`, el
  `SegmentedControl` Póliza/Empresa, la búsqueda del resumen por RUT en la ficha de empresa).
- Ninguna pantalla recalcula un estado de Seguros: veredicto, alerta y razón vienen de la vista (guardia S11/E9).
- Nombres nuevos en inglés (columnas, claves JSON, funciones, archivos); textos en español neutral desde el glosario.
- Solo tokens y piezas del kit (tabla de datos, `ShortcutTiles`, `PanelLateral`, `StatusChip`, `Button`).
- Migración: solo reemplaza la vista; ensayo con `BEGIN…ROLLBACK` en la base real y **autorización del usuario** antes
  de aplicar. Tests de integración contra la copia local (`conexion_revertida`), nunca contra la real.
- `insurance_alert` conserva sus valores (`EXPIRED`, `OVERDUE_INSTALLMENTS`, `EXPIRING`) y su regla.

## Review Focus

- Una empresa inactiva sin pólizas no aparece; una inactiva con una póliza vencida sí, con "Póliza vencida" (Task 1).
- Una póliza renovada con cuotas impagas: la empresa no queda "Póliza vencida" por ella, pero sus cuotas cuentan en
  `OVERDUE` y en `unpaid_uf`; el panel la muestra (Tasks 1 y 2).
- Cuotas sin monto (`amount_uf` nulo): `unpaid_uf` suma las que tienen monto y la razón no dice "0 UF" si todas son
  nulas (dice solo la fecha) (Tasks 1 y 3).
- Un enlace viejo `/dashboard/insurance?q=<RUT>` (ficha de empresa, marcadores): abre Empresas con esa búsqueda (Task 5).
- Una persona sin `policies.edit`: ve Empresas y el panel, sin "Registrar póliza" (Task 4).

---

## Contratos

### Base — `app.carrier_insurance_summary` (reemplazada)
Una fila por empresa activa, más las inactivas con alguna póliza no cancelada. Columnas: `carrier_id`, `policies`
(no canceladas ni renovadas), `worst_state` (se conserva: S16), `insurance_verdict`
(`EXPIRED | NO_POLICY | OVERDUE | NO_DATES | EXPIRING | UP_TO_DATE`), `severe_overdue` (bool: alguna póliza con 2 o más
vencidas), `overdue_installments`, `unpaid_installments`, `unpaid_uf` (numeric, suma de impagas con monto),
`oldest_overdue_date`, `next_due_date`, `reason_insurer`, `reason_valid_to` (la póliza que explica `EXPIRED`,
`NO_DATES` o `EXPIRING`: la vencida más reciente / la sin fecha / la que vence antes), `insurance_alert` (regla de hoy).

### API — `backend/api/app/routers/insurance.py` (nuevo, prefijo `/insurance`, `insurance.read`)
- `GET /insurance/carriers` → `{ data: CarrierInsuranceRow[], facets: Record<Verdict, number> & { total } }`; fila =
  la de la vista + `carrier_name`, `carrier_tax_id`, `operational_status`. Sin paginación (36-60 filas).
- `GET /insurance/carriers/{carrier_id}` → `{ summary: CarrierInsuranceRow, policies: (PolicyRow & { installments:
  InstallmentRow[] })[] }`: pólizas no canceladas; las renovadas solo si tienen cuotas impagas; una consulta
  (`json_agg`). 404 si la empresa no existe.
- Servicio (`services/insurance.py`): `carrier_overview(pool) -> dict`, `carrier_insurance(pool, carrier_id) -> dict |
  None`. Se borran `list_carriers`, `_CARRIERS_CTE`, `_CARRIER_ORDER`, `CARRIER_STATES` y `carrier_policies`.

### Frontend
- `lib/states.ts`: `type InsuranceVerdict`; `INSURANCE_VERDICT_ORDER: InsuranceVerdict[]` (el orden del spec);
  `insuranceVerdictStyle(v, { severe }) → StateStyle`; `insuranceStanding(v) → 'not_up_to_date' | 'expiring' |
  'up_to_date'` y `INSURANCE_STANDING_LABEL` ("No al día", "Por vencer", "Al día");
  `insuranceVerdictReason(row: CarrierInsuranceRow) → string` (la tabla "La razón de cada fila" del spec).
- `lib/api/insurance.ts`: `CarrierInsuranceRow` (con los campos de la vista), `CarrierInsuranceDetail`;
  `insuranceApi.carrierOverview()`, `insuranceApi.carrier(id)`. Se borran `listCarriers` y `carrierPolicies`.
- `lib/navegacion/insurance.ts`: `INSURANCE = '/dashboard/insurance'` (Empresas), `POLICIES =
  '/dashboard/insurance/policies'`, `INSTALLMENTS`, `policyHref(id, returnTo) = \`${POLICIES}/${id}…\``.
- `components/insurance/CarrierInsuranceDetail.tsx`: `({ detail, canEdit, onAddPolicy?, returnTo }) → JSX` — las
  tarjetas de póliza con sus cuotas impagas.
- `components/insurance/CarrierInsurancePanel.tsx`: `CarrierInsurancePanelProvider`, `useOpenCarrierInsurance():
  (target: { id: string; label: string }) => void` — el panel (`PanelLateral overlay="none"`) que abre la fila de
  Empresas y el nombre de la empresa en Pólizas y Cuotas (vía `EntityCell onOpen`).

---

## Tareas

Orden: 1 → 2 → 3 → 4 → 5 → 6 → 7. Commit con los tests de la tarea en verde; línea del ledger en el mismo paso.

### Task 1: El veredicto en la base
**Files:** Create `backend/supabase/migrations/20261027090000_insurance_verdict.sql`,
`backend/api/tests/test_insurance_verdict_integration.py`.
**Interfaces:** Produces las columnas de la vista (Contratos).
- [ ] Test rojo (E1 y Review Focus), con `conexion_revertida` y los ayudantes de `test_insurance_status_integration.py`
  (`_carrier`, `_policy`, `_today`):
  - póliza vencida + 2 cuotas vencidas → `EXPIRED`; empresa activa sin pólizas → `NO_POLICY`; todas canceladas →
    `NO_POLICY`; solo una póliza vencida → `EXPIRED` (no `NO_POLICY`);
  - vigente + 1 cuota vencida → `OVERDUE` con `severe_overdue = false`; 2 vencidas en la misma póliza → `true`;
  - vigente sin `valid_to` → `NO_DATES`; vence en 10 días → `EXPIRING`; todo bien → `UP_TO_DATE`;
  - renovada con 1 cuota vencida + sucesora vigente → `OVERDUE` (no `EXPIRED`); `unpaid_uf` suma solo cuotas con monto;
  - inactiva sin pólizas → sin fila; inactiva con póliza vencida → fila `EXPIRED`;
  - `insurance_alert` igual que antes en los casos de `test_insurance_alert.py` y S16 (sin cambiar esos tests).
- [ ] Escribir la migración (`CREATE OR REPLACE VIEW`, mismos grants que hoy) y aplicarla en la copia local.
- [ ] pytest del archivo + `test_insurance_*` + `test_insurance_renewals_integration.py`. Commit.

### Task 2: La API por empresa
**Files:** Create `backend/api/app/routers/insurance.py`, `backend/api/tests/test_insurance_carriers_api.py`; Modify
`app/services/insurance.py`, `app/routers/policies.py` (sin `group_by`), `app/routers/carriers.py` (sin
`/{id}/policies`), `app/main.py`, `tests/test_insurance_read_api.py` (S7 incluye el router nuevo).
**Interfaces:** Consumes la vista (Task 1); Produces el router y el servicio (Contratos).
- [ ] Test rojo (E2, E3): `GET /insurance/carriers` trae una fila por empresa con `insurance_verdict` y `facets` por
  veredicto; `GET /insurance/carriers/{id}` trae las pólizas con sus cuotas, la renovada solo con cuotas impagas, 404
  si no existe; veredicto y alerta de una empresa valen lo mismo en `/insurance/carriers` y en `/trips`; S7: las dos
  rutas piden `insurance.read`; `GET /policies?group_by=carrier` responde 422 y `/carriers/{id}/policies` 404.
- [ ] Implementar `carrier_overview` y `carrier_insurance` (una consulta con `json_agg` para pólizas y cuotas desde
  `app.insurance_status`); borrar lo reemplazado (Global Constraints).
- [ ] pytest del área (`test_insurance_*`, `test_policies.py`, `test_insurance_alert.py`). Commit.

### Task 3: Glosario y cliente de la API
**Files:** Modify `lib/states.ts`, `lib/api/insurance.ts`, `lib/navegacion/insurance.ts`; Test `lib/states.test.ts`.
**Interfaces:** Produces los nombres de "Frontend" en Contratos.
- [ ] Test rojo (E5 y Review Focus): `insuranceVerdictReason` da "HDI venció el 23/09 · 2 cuotas vencidas",
  "Activa sin pólizas registradas", "La más antigua venció el 25/08 · 18,4 UF impagas", "Mapfre sin fecha de término",
  "Mapfre vence el 02/11", "Próxima cuota el 15/11"; con `unpaid_uf` nulo, la de `OVERDUE` no menciona UF;
  `insuranceVerdictStyle('OVERDUE', { severe: true }).tone === 'urgent'` y con `false` es `'warning'`;
  `insuranceStanding` agrupa los cuatro "No al día"; `INSURANCE_VERDICT_ORDER` sigue el spec.
- [ ] Implementar; borrar `carrierInsuranceStyle` y `CARRIER_FILTERS`; fechas con `fechaCorta` (la de Chile).
- [ ] vitest de `lib/`. Commit.

### Task 4: El detalle de una empresa: panel y ficha
**Files:** Create `components/insurance/CarrierInsuranceDetail.tsx`, `components/insurance/CarrierInsurancePanel.tsx`
y sus tests; Modify `app/dashboard/carriers/[id]/page.tsx`, `components/directory/CarrierDetails.tsx`
(`InsuranceLine` con el veredicto).
**Interfaces:** Consumes `insuranceApi.carrier`, `insuranceVerdictStyle`, `insuranceVerdictReason`, `policyHref`,
`PanelLateral`; Produces `CarrierInsuranceDetail`, `CarrierInsurancePanelProvider`, `useOpenCarrierInsurance`.
- [ ] Test rojo (E6): el detalle dibuja una tarjeta por póliza con sus cuotas impagas ("Cuota 9 de 12", UF, chip) y
  "N pagadas"; "Abrir la póliza" lleva a `policyHref`; sin pólizas dice "Sin pólizas registradas" y "Registrar póliza"
  solo con `policies.edit`; el panel muestra nombre, RUT y el chip del veredicto, y se cierra con Escape.
- [ ] Implementar. En la ficha de empresa, la pestaña Seguros pasa a `CarrierInsuranceDetail` (con "+ Póliza" como
  hoy) e `InsuranceLine` lee `insuranceApi.carrier(id).summary`: se borran la consulta por RUT y `PoliciesTable
  hideCarrier` de la ficha.
- [ ] vitest de `components/insurance`, `components/directory`, `app/dashboard/carriers`. Commit.

### Task 5: Seguros › Empresas, Pólizas y Cuotas, y el menú
**Files:** Create `app/dashboard/insurance/layout.tsx` (monta `CarrierInsurancePanelProvider`),
`app/dashboard/insurance/policies/page.tsx` (la lista de Pólizas, movida); Modify `app/dashboard/insurance/page.tsx`
(pasa a ser Empresas), `components/insurance/PoliciesTable.tsx` (sin `CarriersInsuranceTable`; `EntityCell onOpen`),
`components/insurance/InstallmentsTable.tsx` (`EntityCell onOpen`), `lib/navegacion/menu.ts` (Seguros: Empresas,
Pólizas, Cuotas; contador `insurance` en Empresas; `MOBILE_DESTINATIONS.insurance` = Empresas, Pólizas, Cuotas),
`hooks/useNavCounts.ts` (`insurance` = `facets` no al día de `carrierOverview`; se retira el de cuotas vencidas).
**Interfaces:** Consumes todo lo anterior y el kit (`useDataTable`, `DataTable`, `TableToolbar`, `ShortcutTiles`,
`useUrlView`, `useTablePreferences` con `TABLE_KEY = 'insurance.carriers'`).
- [ ] Test rojo (E4, E7, E8 y Review Focus):
  - Empresas sin parámetros en la URL abre con "No al día" marcado y solo esas filas, ordenadas por
    `INSURANCE_VERDICT_ORDER`; los recuadros cuentan No al día, Por vencer y Al día; tocar "Al día" deja solo esas.
  - `?q=<RUT>` abre con esa búsqueda; tocar una fila abre el panel de esa empresa.
  - Pólizas (`/dashboard/insurance/policies`) no tiene "Agrupar por"; el nombre de la empresa en Pólizas y en Cuotas
    abre el mismo panel.
  - El contador del menú está en Empresas y cuenta las no al día.
  - Con "No al día" marcado y ninguna empresa en esa situación, dice "Todas las empresas están al día" (no una tabla
    vacía).
- [ ] Implementar. "Abre en No al día": opción del kit `useUrlView({ initial })` — la vista que se escribe en la URL al
  entrar cuando la URL no trae ninguna; después, quitar el filtro deja la URL sin él y no se reaplica (test en
  `useUrlView.test.ts`). Las columnas: Situación (`insuranceStanding`, la de los recuadros), Empresa (nombre y RUT),
  Veredicto, Por qué, Próxima fecha; filtrables y ordenables por el kit.
- [ ] Guardia (E9) en `lib/ui/seguros-sin-reglas.test.ts`: ningún archivo de `app/` ni `components/` compara
  `insurance_verdict` con un valor (el veredicto solo se lee por el glosario).
- [ ] vitest de `app/dashboard/insurance`, `components/insurance`, `lib/`, `hooks/`, `components/ui/tabla`. Commit.

### Task 6: Migración en la base real
- [ ] Ensayo en la real: `BEGIN; <migración>; SELECT insurance_verdict, count(*) … GROUP BY 1; ROLLBACK;` y comparar con
  la copia local.
- [ ] **Pedir autorización al usuario** con el resultado del ensayo; aplicar solo con su sí.

### Task 7: Verificación, humo y despliegue
- [ ] Suite frontend completa (toca el kit: `useUrlView`), `tsc`, `npm run build`; pytest del backend del área.
- [ ] Humo Playwright en la copia local (E10): Empresas → tocar una empresa → abrir su póliza, a 1440 y 390; Pólizas y
  Cuotas abren el panel desde el nombre; capturas.
- [ ] Revisión final del rango con un revisor (opus); Important → arreglo con test rojo→verde.
- [ ] AGENTLOG; push a dev; Deploy Frontend y Deploy Monitor API en verde; mirar en dev.
