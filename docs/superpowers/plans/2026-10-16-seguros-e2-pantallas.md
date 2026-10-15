# Seguros, Entrega 2: submódulos Pólizas y Cuotas, ficha de póliza (y contraer el modelo)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10). Pasos con
> checkbox (`- [ ]`). Requiere la Entrega 1 aplicada y desplegada.

**Goal:** Seguros con el patrón de Directorio y Certificación: un grupo en el menú con Pólizas y Cuotas, la póliza con
su ficha, y el modal viejo y los campos viejos fuera.

**Architecture:** las pantallas consumen solo los endpoints nuevos de la Entrega 1 y pintan con el kit (`ProfileLayout`,
`AsidePanel`, `SegmentedControl`, `CABECERA`, `StatusChip`, `EntityCell`, `Estado`). Los estados de póliza y cuota entran
al glosario `lib/states.ts` (una sola forma de pintarlos). Al final se **contrae**: una migración borra las columnas
viejas (con su copia en `audit_log`) y se borran los endpoints y campos de compatibilidad.

**Tech Stack:** Next.js (App Router), TanStack Query, vitest, Playwright (humo en la copia local).

**Spec:** `docs/superpowers/specs/2026-10-15-seguros-polizas-y-cuotas-design.md` · **Maqueta:**
`.superpowers/brainstorm/56411-1792100703/content/seguros.html`

## Global Constraints

- Español neutral, sin voseo; cero emojis (solo `lucide-react`); rutas en inglés, etiquetas en español.
- Solo tokens del sistema visual; los topes de `lib/ui/sistema.test.ts` y `lib/ui/escala.test.ts` bajan al número real
  en el mismo commit.
- Ninguna pantalla calcula un estado de Seguros: lo pinta desde `policy_state` / `installment_state`.
- Fechas cortas (`diaMes`: 02/10; con año solo si no es el actual).
- Verificación visual a 1440 y 390 px de **todas** las rutas de Seguros y de la pestaña Seguros de la ficha de empresa.

## HU

Como Operaciones y Finanzas, quiero ver en Seguros qué pólizas y qué cuotas necesitan atención, y trabajar una póliza
en su ficha, con las mismas piezas que el resto de la app.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Test |
|---|---|---|
| S8 | El menú tiene el grupo Seguros con Pólizas y Cuotas; Cuotas lleva el contador de vencidas (sin "0" en vuelo) | `components/dashboard/Sidebar.test.tsx` |
| S9 | La ficha de póliza dibuja Cuotas y Documentos al centro y Detalles, Coberturas y Equipos cubiertos al costado | `app/dashboard/insurance/policies/[id]/page.test.tsx` |
| S10 | La pestaña Seguros de la ficha de empresa es la misma tabla de Pólizas filtrada por la empresa | `app/dashboard/carriers/[id]/page.test.tsx` |
| S11 | Ningún archivo de `app/` ni `components/` compara `due_date` con hoy ni usa `toISOString().slice(0, 10)` para Seguros | `lib/ui/seguros-sin-reglas.test.ts` (guarda sobre el código) |
| S12 | Humo: Pólizas → ficha → marcar una cuota pagada → la cola de Cuotas la muestra en Pagadas | `scripts/smoke/smoke.spec.ts` |
| S13 | Pólizas agrupa por Póliza o Empresa con el control segmentado; por empresa aparecen las que no tienen póliza | `app/dashboard/insurance/page.test.tsx` |
| S14 | Cuotas: seleccionar varias y "Marcar pagadas…" llama a `POST /installments/pay` con la fecha elegida; lo que falla se dice por cuota | `app/dashboard/insurance/installments/page.test.tsx` |
| S15 | La contracción borra las columnas viejas y no quedan lectores (`grep` de `payment_status`, `policy_health`, `total_installments`, `expiration_alert_days`, `insurance-overview` vacío fuera de migraciones) | `tests/test_seguros_sin_campos_viejos.py` (guarda) |

## Contratos

### Rutas y menú
- `/dashboard/insurance` → **Pólizas** (la ruta actual cambia de contenido; un enlace guardado sigue sirviendo).
- `/dashboard/insurance/policies/[id]` → **Ficha de póliza** (`?next=` para volver con filtros, `returnLink`).
- `/dashboard/insurance/installments` → **Cuotas**.
- `Sidebar.tsx`: Seguros sale de `NAV_ITEMS` y entra a `NAV_GROUPS` con dos ítems; `badge: 'installments'` (cuenta
  `facets.OVERDUE` de `GET /installments`). El comentario "Seguros y Tarifario todavía no tienen más de una vista" se
  actualiza.

### Glosario (`lib/states.ts`)
- `PolicyState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'CANCELLED' | 'NO_DATES'` y `policyStateStyle(state, validTo)` →
  `{ label, tone, icon }` ("Al día", "Vence en N días · dd/mm", "Venció el dd/mm", "Cancelada", "Sin vigencia").
- `InstallmentState = 'PAID' | 'OVERDUE' | 'PENDING'` y `installmentStateStyle(row)` ("Pagada", "Pagada · fecha no
  registrada", "Venció el dd/mm", "Vence el dd/mm"); `outside_validity` se pinta como un segundo chip "Fuera de vigencia".
- Se borran `lib/insurance.tsx` (`POLICY_HEALTH_CONFIG`) y sus usos.

### Componentes
- `components/insurance/PoliciesTable.tsx`: la tabla de Pólizas (columnas Póliza · Empresa · Vigencia · Estado · Cuotas ·
  Archivo), con `group_by`; la usan Seguros › Pólizas y la pestaña Seguros de la ficha de empresa (prop `carrierId`).
- `components/insurance/InstallmentsTable.tsx`: cuotas con selección múltiple y barra "Marcar pagadas…"; la usan la
  ficha de póliza (prop `policyId`) y Seguros › Cuotas.
- `components/insurance/PayInstallmentsDialog.tsx`: pide la fecha de pago (hoy en Chile por defecto) y llama a
  `POST /installments/pay`.
- `components/insurance/PolicyProfile.tsx`: la ficha (`ProfileHeader` + `ProfileLayout`); Documentos con las filas de
  documento del kit (`RenglonPendiente` en su forma de archivo único) sobre `POST/DELETE /policies/{id}/file`; Detalles
  con `DetailsBlock` y "Editar"; Coberturas y Equipos cubiertos en `AsidePanel`; ⋯ con Cancelar (motivo) y Eliminar.
- Se borran `InsurancePolicyModal.tsx`, `InstallmentRow.tsx`, `InsuranceSummaryCard.tsx` y sus tests (el
  comportamiento que valga se porta a los tests nuevos, nombrándolo).

### Contracción (al final de la entrega)
- Migración `…_insurance_retire_stored_states.sql`: copia a `public.audit_log` y borra `insurance_policies.status`,
  `insurance_policies.expiration_alert_days`, `insurance_installments.payment_status`, `.total_installments`, `.paid_at`.
- Backend: se borran `GET /carriers/insurance-overview`, `PATCH /installments/{id}` y los campos de compatibilidad de
  `app/schemas/insurance.py`.

## Tareas

1. **Glosario** (`lib/states.ts` + tests): `policyStateStyle`, `installmentStateStyle`; borrar `lib/insurance.tsx`
   cuando ya no tenga usos (tarea 6).
2. **Pólizas** (`components/insurance/PoliciesTable.tsx`, `app/dashboard/insurance/page.tsx`): S13. Filtros por estado
   con `facets`, agrupar por Póliza/Empresa, búsqueda; la fila abre la ficha; la empresa, su vista rápida.
3. **Ficha de póliza** (`components/insurance/PolicyProfile.tsx`, `app/dashboard/insurance/policies/[id]/page.tsx`): S9.
4. **Cuotas** (`InstallmentsTable`, `PayInstallmentsDialog`, `app/dashboard/insurance/installments/page.tsx`): S14.
5. **Menú y ficha de empresa** (`Sidebar.tsx`, `app/dashboard/carriers/[id]/page.tsx` pestaña Seguros con
   `PoliciesTable carrierId`; `InsuranceLine` de Detalles lee `GET /carriers/{id}/policies`): S8 y S10.
6. **Borrar lo viejo y la guarda** (`InsurancePolicyModal`, `InstallmentRow`, `InsuranceSummaryCard`,
   `lib/insurance.tsx`; `lib/api/policies.ts` y `lib/api/carriers.ts` sin los métodos viejos): S11.
7. **Contracción** (migración + backend): S15. Antes de borrar columnas, confirmar con `mage-agent` (solo lectura:
   listar pipelines y buscar `insurance_policies` / `insurance_installments` en sus bloques) que ninguno escribe estas
   tablas: los datos vinieron de una carga de prueba desde Mage (usuario, 15/10). Ensayo en copia local y `ROLLBACK` en
   la real; **se aplica con autorización**, y se despliega API y frontend en la misma ventana.
8. **Verificación:** vitest completo + tsc + build (se tocan `lib/states.ts` y el menú, que son compartidos), humo con
   S12, trinquetes, capturas a 1440 y 390 de Pólizas (los dos agrupamientos), ficha de póliza, Cuotas y la pestaña
   Seguros de la empresa; recorrido en dev con sesión, solo lectura.

## Review Focus

- Una empresa con muchas pólizas canceladas y una vigente: la fila por empresa dice el estado de la vigente.
- Marcar pagadas 30 cuotas y que falle una: las 29 quedan pagadas y la que falló se dice con su motivo.
- Usuario sin `policies.edit`: ve las tres pantallas sin selección, sin "Marcar pagadas…", sin "Editar" ni "Subir".
- La ficha de póliza abierta con un id que no existe o de otra empresa dada de baja: `Estado` vacío con volver.
- El teléfono: la tabla de Cuotas con selección se desplaza dentro de su tarjeta y la barra de selección queda visible.
