# Seguros, Entrega 1: modelo de datos y API

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10). Pasos con
> checkbox (`- [ ]`).

**Goal:** que el estado de pólizas y cuotas sea siempre correcto: la base guarda hechos y una sola vista calcula los
estados, y la API los entrega listos.

**Architecture:** expandir y después contraer (el estándar para cambiar un modelo sin cortar el servicio). Esta
entrega **expande**: agrega los hechos (`cancelled_at`, `paid`, `paid_on`, `paid_by`) con su relleno desde los
datos actuales, reemplaza la vista materializada por dos vistas normales (`app.insurance_status` y
`app.carrier_insurance_summary`), agrega los endpoints nuevos y hace que todo lo que hoy se lee (incluidos los
endpoints que usa el frontend actual) salga de esas vistas. Ninguna lectura vuelve a tocar `status`, `payment_status`,
`total_installments` ni `expiration_alert_days`, y ninguna escritura las actualiza. La Entrega 2 **contrae**: muda el
frontend y borra esas columnas y los endpoints viejos (tareas explícitas allí).

**Tech Stack:** Postgres (Supabase), FastAPI + asyncpg, pytest (copia local con `conexion_revertida`; base real solo
con ROLLBACK).

**Spec:** `docs/superpowers/specs/2026-10-15-seguros-polizas-y-cuotas-design.md`

## Global Constraints

- Nombres nuevos en inglés (tablas, columnas, claves JSON, funciones); mensajes al usuario en español neutral.
- Sin contraseñas en el repo. Tests contra la base real solo en `conexion_revertida`, con la guarda de producción.
- "Hoy" es una sola expresión: `(now() AT TIME ZONE 'America/Santiago')::date`.
- La migración se ensaya en la copia local y con `ROLLBACK` en la base real; **se aplica solo con autorización**.
- `null` nunca con dos significados: pagada ≠ fecha de pago.
- Permisos: lectura `insurance.read`; escritura `policies.edit`; borrar `policies.delete`.

## HU

Como Operaciones y Finanzas, quiero que una póliza vencida figure vencida y una cuota impaga figure impaga el mismo
día, sin que nadie tenga que guardar nada, para no operar con un equipo sin seguro.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Test |
|---|---|---|
| S1 | Una póliza con `valid_to` ayer es `EXPIRED` sin escribir nada; con `valid_to` dentro de 30 días, `EXPIRING`; cancelada, `CANCELLED` | `tests/test_insurance_status_integration.py` (copia local) |
| S2 | Cuota impaga con fecha pasada es `OVERDUE`; `paid = true` es `PAID` aunque `paid_on` sea null; fuera de la vigencia lleva `outside_validity = true` | mismo archivo |
| S3 | `POST /installments/pay` guarda `paid`, `paid_on` y `paid_by`, y deja una auditoría por cuota con `entity_type = 'INSURANCE_POLICY'` y el id de la póliza | `tests/test_policies.py` |
| S4 | Generar cuotas con alguna fecha fuera de `valid_from..valid_to` responde 422 y no crea ninguna | `tests/test_policies.py` |
| S5 | La migración conserva las 60 pagadas (54 con `paid_on` null) y no toca las 44 fuera de vigencia | ensayo en copia local + `ROLLBACK` en la real (salida pegada en el ledger) |
| S6 | El peor estado y `insurance_alert` de una empresa son los mismos en `/policies?group_by=carrier`, `/carriers/{id}/policies` y `/trips` (todos leen `app.carrier_insurance_summary`) | `tests/test_insurance_alert.py` |
| S7 | Ningún endpoint de Seguros responde 200 con solo `directory.read` | `tests/test_policies.py` |

## Contratos

### Base (migración `20261020090000_insurance_facts_and_status_views.sql`, solo agrega)

- `public.insurance_policies`: + `cancelled_at timestamptz`, + `cancelled_reason text`. Relleno: `status = 'CANCELLED'`
  → `cancelled_at = updated_at` (hoy 0 filas).
- `public.insurance_installments`: + `paid boolean NOT NULL DEFAULT false`, + `paid_on date`, + `paid_by uuid`.
  Relleno: `paid := payment_status = 'PAID'`; `paid_on := paid_at::date` (las 54 sin fecha quedan `paid` y `paid_on`
  null). `paid_at timestamptz` sigue existiendo hasta la Entrega 2 y no se vuelve a escribir.
- Las columnas viejas (`status`, `expiration_alert_days`, `payment_status`, `total_installments`, `paid_at`) **no se
  borran aquí**: las borra la migración de la Entrega 2, con su copia a `public.audit_log`.
- `app.alert_thresholds`: fila `poliza_por_vencer` (`label` "Póliza por vencer", `warning_days` 30, `error_days` 0).
- Se borran `app.carrier_insurance_status`, `public.refresh_insurance_view()` y los 4 triggers `trg_refresh_view_on_*`.
- `app.insurance_status` (vista normal, una fila por cuota **y** por póliza sin cuotas):
  `policy_id, carrier_id, policy_state ('CANCELLED'|'EXPIRED'|'EXPIRING'|'VALID'|'NO_DATES'), installment_id,
  installment_number, installments_total (count over policy), due_date, amount_uf, paid, paid_on, paid_by,
  installment_state ('PAID'|'OVERDUE'|'PENDING'), outside_validity`.
- `app.carrier_insurance_summary` (vista normal, una fila por empresa con pólizas no canceladas):
  `carrier_id, policies, worst_state, unpaid_installments, overdue_installments, next_due_date,
  insurance_alert ('EXPIRED'|'OVERDUE_INSTALLMENTS'|'EXPIRING'|null)`. Regla D2: `OVERDUE_INSTALLMENTS` si alguna
  póliza tiene 2 o más cuotas vencidas.
- `REVOKE` de las dos vistas a `anon` y `authenticated`, como `20260818200000_seguridad_matviews_y_funciones.sql`.

### API

| Endpoint | Permiso | Cambia |
|---|---|---|
| `GET /policies` | `insurance.read` | **Nuevo.** `group_by=policy\|carrier`, `state=EXPIRED\|EXPIRING\|VALID\|UNPAID\|NO_FILE\|NO_POLICY`, `q`, `page`; filas con su estado; `facets` por cada filtro. Agrupando por empresa incluye las activas sin póliza (`worst_state = 'NO_POLICY'`) |
| `GET /policies/{id}` | `insurance.read` | Devuelve `policy_state`, cuotas con `installment_state` y `outside_validity` |
| `POST /policies/{id}/cancel` | `policies.edit` | **Nuevo.** `{ reason }` → `cancelled_at = now()` |
| `POST /policies/{id}/installments/generate` | `policies.edit` | 422 si alguna fecha cae fuera de la vigencia |
| `GET /installments` | `insurance.read` | **Nuevo.** `state=OVERDUE\|DUE_30\|PAID\|ALL`, `q`, `page`; con empresa y póliza; `facets` |
| `POST /installments/pay` | `policies.edit` | **Nuevo.** `{ ids, paid_on }`; responde `{ paid, errors }` por cuota |
| `PATCH /installments/{id}` | `policies.edit` | Se queda hasta la Entrega 2 (la usa el modal actual): pasa a escribir `paid`/`paid_on`/`paid_by` |
| `GET /carriers/{id}/policies` | `insurance.read` | Antes `directory.read`; lee la vista |
| `GET /carriers/insurance-overview` | `insurance.read` | Se queda hasta la Entrega 2 (la usa la pantalla actual): pasa a leer `app.carrier_insurance_summary`, con sus nombres de campo de hoy |
| `GET /trips` | sin cambio | `insurance_alert` sale de `app.carrier_insurance_summary` (se borra el `LATERAL` propio) |

Esquemas en `app/schemas/insurance.py`: entran `policy_state`, `installment_state`, `outside_validity`, `paid`,
`paid_on`, `paid_by`. Los campos viejos que hoy lee el frontend (`policy_health`, `payment_status`,
`total_installments`, `paid_at`) siguen en la respuesta **calculados desde la vista** (no desde las columnas) hasta la
Entrega 2, que los retira junto con el frontend que los lee. Así el frontend actual muestra el estado correcto desde
esta entrega.

## Tareas

### Tarea 1: migración y vistas
- **Files:** Create `backend/supabase/migrations/20261020090000_insurance_facts_and_status_views.sql`;
  Test `backend/api/tests/test_insurance_status_integration.py`.
- [ ] Tests S1 y S2 contra la copia local (cada uno crea su empresa, póliza y cuotas en `conexion_revertida`); verlos
  fallar (la vista no existe).
- [ ] Escribir la migración según el contrato (re-ejecutable: `IF EXISTS`/`IF NOT EXISTS`; la copia a `audit_log` y el
  borrado de columnas en una transacción).
- [ ] Aplicarla en la copia local (`.superpowers/local-sim`), correr S1 y S2: verdes.
- [ ] S5: ensayo con `BEGIN … ROLLBACK` en la base real, pegar en el ledger los conteos antes/después (60 pagadas,
  54 sin fecha, 44 fuera de vigencia, 33 pólizas). **No aplicar.**
- [ ] Commit.

### Tarea 2: lectura (`GET /policies`, `GET /installments`, `GET /policies/{id}`, `GET /carriers/{id}/policies`)
- **Files:** Modify `app/routers/policies.py`, `app/routers/carriers.py`, `app/schemas/insurance.py`;
  Create `app/routers/installments.py` (prefijo `/installments`, registrado en `app/main.py` como los demás);
  Test `tests/test_policies.py`.
- [ ] Test S7 (con solo `directory.read`, los cuatro GET responden 403); verlo fallar en `/carriers/{id}/policies`.
- [ ] Implementar los GET leyendo solo `app.insurance_status` y `app.carrier_insurance_summary`; `insurance-overview`
  pasa a leer `app.carrier_insurance_summary` (se borra `_INSURANCE_OVERVIEW_AGG`, la segunda versión de la regla).
- [ ] Ajustar `tests/test_carriers.py` y `tests/test_schemas_public.py` donde fijaban la vista materializada, diciendo
  por qué en cada uno.
- [ ] Commit.

### Tarea 3: escritura (pagar, generar, cancelar) y auditoría
- **Files:** Modify `app/routers/policies.py`, `app/routers/installments.py`; Test `tests/test_policies.py`.
- [ ] Tests S3 y S4; verlos fallar.
- [ ] `POST /installments/pay` (una transacción por lote; una fila de auditoría por cuota con `log_change`,
  `entity_type='INSURANCE_POLICY'`, `entity_id` = la póliza, `field='paid'`). `PATCH /installments/{id}` pasa a
  escribir los mismos hechos por la misma función (una sola implementación del pago).
- [ ] `generate`: validar las fechas contra la vigencia antes de insertar; quitar `total_installments` del INSERT.
- [ ] `POST /policies/{id}/cancel`; el resto de la auditoría de pólizas pasa a `INSURANCE_POLICY`.
- [ ] Commit.

### Tarea 4: el Monitor lee la misma regla
- **Files:** Modify `app/routers/trips.py`, `frontend/components/ui/InsuranceAlertBadge.tsx`, `frontend/lib/types.ts`;
  Test `tests/test_insurance_alert.py`; Create `frontend/components/ui/InsuranceAlertBadge.test.tsx`.
- [ ] Test S6 (una empresa con 2 cuotas vencidas: `OVERDUE_INSTALLMENTS` en `/trips`, en `/policies?group_by=carrier`
  y en `/carriers/{id}/policies`); verlo fallar en `/policies`.
- [ ] Reemplazar el `LATERAL` de `insurance_alert` en `_TRIP_FROM` por un `LEFT JOIN app.carrier_insurance_summary`.
- [ ] El valor `EXPIRING_SOON` pasa a `EXPIRING` (el nombre del glosario `lib/states.ts`). En el mismo commit:
  `frontend/components/ui/InsuranceAlertBadge.tsx` y el tipo de `insurance_alert` en `frontend/lib/types.ts`, con su
  test (`InsuranceAlertBadge` dice "Póliza por vencer" para `EXPIRING`). Un solo nombre para lo mismo, sin mapa de
  compatibilidad.
- [ ] Commit.

### Tarea 5: verificación y despliegue de la API
- [ ] Tests del área en la copia local (`-k "insurance or polic or installment or trip or carrier"`) y comparar los
  fallos contra la línea base (hoy fallan 8 de integración sin relación, AGENTLOG 15/10).
- [ ] Pedir autorización al usuario para aplicar la migración en la base real; aplicarla; desplegar Monitor API.
- [ ] Verificar en dev (solo lectura): `/policies?group_by=carrier` y `/trips` dan el mismo estado para Aguilera.

## Review Focus

- Una póliza sin `valid_to`: `NO_DATES`, nunca `VALID` (hoy la vista la deja `VALID` por omisión del CASE).
- Una empresa con todas sus pólizas canceladas: no aparece como `VALID`; agrupando por empresa cuenta como sin póliza.
- Pagar una cuota ya pagada: no cambia `paid_on` ni `paid_by` y lo dice en `errors`.
- La transición de día a las 21:00 de Chile (UTC 00:00): el estado usa la fecha de Chile, no la del servidor.
- El frontend actual (sin la Entrega 2) contra la API de la Entrega 1: sigue funcionando y muestra el estado
  correcto, porque los campos viejos salen de la vista. Lo verifica el humo de Seguros sobre la copia local.
