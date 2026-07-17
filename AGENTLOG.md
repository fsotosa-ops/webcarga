# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-16 (cont.) — Checkpoint H3 fase 2 completa: Empresas + Seguros (Checkpoints M/H0/H1/H2/H3) queda 100% cerrado

**Objetivo de esta sesión:** retomar donde la sesión anterior dejó el frontend a propósito roto (`npm run build` fallando con `Module not found` en ~24 componentes/2 páginas de Empresas/Seguros, ver AGENTLOG_ARCHIVE.md) y terminar la reescritura contra el modelo `public.*`/H2.

**Dos gaps reales de arquitectura encontrados antes de escribir componentes — ambos resueltos con el usuario, no decididos en solitario:**

1. **`DriverDetailPanel`/`VehicleDetailPanel` no tenían de dónde traer el checklist por conductor/vehículo**: `GET /drivers/{id}` y `GET /assets/{id}` solo devuelven el agregado (`total_requirements`), no la lista itemizada — a diferencia de `GET /carriers/{id}}`, que sí trae `compliance_records` anidado. El modelo ya soporta DRIVER/ASSET (es polimórfico), solo faltaba el endpoint de listado. **Resuelto**: agregados `GET /drivers/{id}/compliance-records` y `GET /assets/{id}/compliance-records` (mismo query que `_assemble_carrier_detail` en `carriers.py`, filtrado por `entity_type`) + tests + `lib/api/drivers.ts`/`assets.ts`. Suite backend: **128 passed** (de 125).
2. **`/dashboard/seguros` (Pólizas + Cobranza global, cross-empresa) no tiene backend**: el router nuevo de H2.3 solo expone `GET /carriers/{id}/policies` y `GET /policies/{id}/installments` (por póliza) — no hay `GET /policies` ni `GET /installments` globales. **Decisión del usuario**: retirar la ruta global por completo, remitiéndose al modelo lógico ya rediseñado — Seguros pasa a vivir *solo* anidado en la ficha de cada empresa. Borrados `app/dashboard/seguros/page.tsx`, `PolizasTab`/`CobranzaTab`/`InsuranceCompanyCard` (+tests), `lib/utils/insuranceFilters.ts`/`insuranceGrouping.ts` (+tests), link "Seguros" del `Sidebar.tsx`. La vista de Cobranza (aging, agrupación, botón "Pagar" real) queda sin equivalente — ver checklist abajo, no bloqueante para este workstream (ya estaba en pendientes de sesiones previas).

**Rediseños de fondo (no simple renombrado de tipos) que vale la pena recordar:**

- **Checklist de documentos data-driven de verdad**: `DocumentChecklist`/`ChecklistItem` pasó de un catálogo hardcodeado + JSONB `governance` (5 estados `ok/pendiente/actualizar/n_a/factible`) a mapear 1:1 sobre `ComplianceRecord` (7 estados reales del CHECK constraint). El backend ya calcula `is_expired`/`is_expiring_soon` por record — se borró todo el date-math client-side (`getAlertStatus`/`getDriverAlertStatus`/`getVehicleAlertStatus` en `lib/compliance.ts`). Nuevo `lib/utils/complianceChecklist.ts` reemplaza `transporterDocs.ts` (borrado, junto con `EligibilityDot`/`lib/utils/eligibility.ts` — el semáforo de elegibilidad de Checkpoint A-E no tiene equivalente en el modelo nuevo).
- **Roster cards (`DriverRosterCard`/`VehicleRosterCard`) simplificados a propósito**: `app.carrier_driver_roster`/`carrier_asset_roster` solo traen `total_requirements` agregado, no un desglose por estado — no hay semáforo posible a ese nivel sin ampliar la vista (fuera de alcance). Roster muestra conteo + fecha, el detalle por documento vive en el panel.
- **Baja/reactivar sin modal de motivo**: el modelo nuevo no tiene columna de "motivo de baja" en ninguna tabla (`carriers`/`drivers`/`assets`), solo `operational_status`. `BajaReasonModal` pasó de formulario (motivo + notas) a confirmación simple; baja/reactivar de conductor/equipo es un `PATCH operational_status` directo, ya no un endpoint `.../deactivate` separado.
- **`InsurancePolicyModal` reescrito con selección M:N real** (el pedido explícito del plan): coberturas (`coverageTypesApi` + `policiesApi.linkCoverage/unlinkCoverage`) y activos cubiertos (`carriersApi.listAssets` + `policiesApi.linkAsset/unlinkAsset`) como chips removibles + selector para agregar. Sin checklist de "documentos" por póliza (no existe en el modelo nuevo, solo `policy_document_url`/`endorsement_document_url` de solo lectura, sin endpoint de escritura). `InstallmentRow`: "revertir" pasó a ser el mismo `PATCH payment_status='PENDING'` (no hay endpoint de revert ni optimistic lock en el backend nuevo).
- **`ComplianceBadge` no se tocó de tipo**: en vez de acoplarlo al nuevo `ComplianceStatus`, se le dio un tipo local (`'ok'|'expiring_soon'|'expired'`) para no romper `TripTable.tsx` (Diario, fuera de alcance) que ya tenía su propio `AlertStatus` local desde H3 capa 1 — typing estructural, cero import cruzado entre módulos.
- **Página de empresa**: convertida a TanStack Query de punta a punta (antes era `useState`+`load()` manual). Tabs Activas/Legacy sobre `operational_status` (plan H3.4). Contactos dejaron de ser 4 slots fijos por rol (`rep_legal/operacional/finanzas/documentos`) — `public.contacts` es una lista abierta (`contact_role` sin CHECK constraint), la sección ahora es una lista con alta/edición/baja real.

**Verificación real, no solo asumida:**
- `npx tsc --noEmit` → **0 errores** (venía de 169 al empezar esta sesión).
- `npx vitest run` → **284 passed** (40 archivos).
- `npm run build` → **exitoso**, las 14 rutas compilan (el error de Vercel de la sesión anterior, `Module not found`, ya no se reproduce).
- `pytest` backend → **128 passed**.

**No se hizo esta sesión:** commit/push (el usuario no lo pidió explícitamente en esta sesión — confirmar antes de subir a `dev`), smoke test manual en navegador.

#### Próximo paso exacto
1. [ ] Commit + push de esta sesión (backend: 2 endpoints nuevos + tests; frontend: H3 fase 2 completa — confirmar con el usuario el alcance del commit antes de pushear, mismo criterio que la sesión anterior de no mezclar con archivos ajenos ya sueltos en el working tree).
2. [ ] H2.6 (decisión pendiente, sigue sin resolver desde Checkpoint M): si/cómo el módulo del Diario debe mostrar compliance/seguro del carrier — condiciona reactivar `EmpresaSelector`/`TransporterAssignSection`/las alertas de `TripTable` (quedaron con `TODO(H2.6)` explícito en el código, sin tocar esta sesión). Incluye confirmar si `app.transporter_profiles` se sigue refrescando por algún medio. **No iniciar sin que el usuario lo pida explícitamente.**
3. [ ] Cobranza (aging/agrupación cross-empresa, botón "Pagar" real) quedó sin ruta tras retirar `/dashboard/seguros` — si se necesita, requiere endpoints backend nuevos (`GET /policies`, `GET /installments` globales), que el usuario decidió explícitamente no construir esta sesión.
4. [ ] Tener presente: `app.carrier_compliance_status` vigente es la versión simple (sin `compliance_documents`/`active_shippers` JSONB anidados) — si el frontend necesita ese detalle habrá que ampliarla.
5. [ ] Documento físico de la póliza (no las cuotas): `app.carrier_insurance_status` ya calcula `missing_physical_file`, pero el backend no lo expone y **no existe `POST /policies/{id}/file`** (a diferencia de compliance-records) — no hay forma de subir/reemplazar el archivo de una póliza. Si se necesita, es backend nuevo, no cableado de algo existente. Confirmado con el usuario 2026-07-16 que es un gap real, sin decidir todavía si se construye.
6. [ ] Pendientes de sesiones anteriores (no bloqueantes): decidir qué hacer con las ~70 migraciones de Checkpoints A-E ya marcadas para borrar (deletion pendiente en el working tree, sin commitear).

**Dado de baja (2026-07-16):** mapeo `doc_code`↔cliente (Fabián) — el usuario confirmó que ya no aplica, se retira de los pendientes.

---
