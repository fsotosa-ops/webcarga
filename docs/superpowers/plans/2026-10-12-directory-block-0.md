# Directorio · Bloque 0 (arreglos inmediatos de coherencia) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ningún día del Cierre quede bloqueado por líneas que la tabla no muestra, que ningún botón del Directorio responda 403, que un cambio del Directorio se vea sin recargar en Certificación, el Cierre, el Monitor y la vista rápida, que las asignaciones nuevas tomen la fecha de Chile, que el pre-cierre no renombre conductores y que la flota de una empresa dada de baja se vea marcada.

**Architecture:** Dos despliegues, ordenados por efecto (D-g de la spec). El **despliegue 1** son cambios de backend y una migración de metadato: la tabla del Cierre pasa a `LEFT JOIN active_roster` con una marca `in_roster`, el default de `start_date` pasa a `public.hoy_chile()`, el roster de conductores de una empresa se lee en vivo y el pre-cierre deja de renombrar. El **despliegue 2** es la coherencia entre pantallas: un permiso nuevo `directory.fleet_status` por el catálogo de RBAC, un mapa de permisos por campo en los `PATCH`, una fábrica de claves con una sola función de invalidación (`invalidateDirectory`), relectura de 15 s mientras el Cierre tiene recálculo pendiente, red mínima (confirmar, avisar, un diccionario de estados), la marca "Empresa dada de baja" en las lecturas de flota y los dos estados de Sin clasificar (H2, H4).

**Tech Stack:** FastAPI + asyncpg (Postgres 17 en Supabase), pytest (integración con `conexion_revertida`), Next.js 16 app router + React Query + Tailwind con tokens propios, vitest + Testing Library, Playwright MCP (copia local).

**Spec:** `docs/superpowers/specs/2026-10-12-directory-block-0-design.md` (aprobada el 12/10). Insumos: `docs/superpowers/plans/2026-10-12-directory-audit-findings.md` y sus lentes `-lens-a.md`, `-lens-b.md`, `-lens-c.md`; `docs/superpowers/plans/2026-10-11-sin-clasificar-ux-audit.md` (H2, H4).

## Global Constraints

- **Tests vistos fallar antes de implementar.** Cada paso "Run test to verify it fails" tiene que fallar por el motivo que dice el paso. Si falla por otro (import roto, mock sin preparar, fixture que no existe), se corrige el test y se reporta.
- **El código de test de este plan nunca corrió.** Es un punto de partida verificable, no una transcripción. Cada test se escribió copiando un test equivalente del repo (se nombra en el paso), pero si falla por un motivo distinto al esperado, el implementador corrige el test y lo reporta en su informe. **Nunca se afloja una aserción** para que pase.
- **Mutación en los tests de datos y de permisos.** Esos tests llevan un paso "Verificar que la mutación mata el test": revertir la línea de la implementación que nombra el paso, correr, ver FAIL, restaurar. Un test que sigue verde con la implementación revertida no protege nada.
- **Integración contra la base real** con `conexion_revertida` (transacción que siempre se revierte). Los sujetos los crea el test, con prefijo `ZZ-TEST-DIRECTORIO`. Los requisitos de test, si alguno hiciera falta, se insertan con `is_active = false`. Ningún test depende de datos de producción.
- **Venv del backend y primer plano:** `monitor-app/backend/api/venv/bin/python -m pytest …`, ejecutado desde `monitor-app/backend/api` (los tests importan `tests.conftest`), es decir `cd monitor-app/backend/api && venv/bin/python -m pytest …`. **Siempre en primer plano**, nunca en segundo plano: cortar una corrida a mitad deja conexiones del pooler tomadas.
- **Nunca** correr `tests/test_padron_conductor.py` con `--padron-completo`.
- **Sin triggers ni `REFRESH` nuevos.** La migración del 0.1 solo cambia defaults.
- **Mage no se toca.**
- **Interfaz en español neutral:** nunca voseo ("Elige", "Confirma", nunca "Elegí", "Confirmá"), cero emojis (solo íconos de `lucide-react`).
- **Sistema visual:** solo tokens y primitivas (`text-etiqueta/dato/lectura/titulo`, `text-informativo`, `text-accion`, `text-status-incidente`, `text-warning`, `text-espera`, `bg-bg-main`, `border-border`, `bg-text-primary`, `StatusChip`, `Estado`). Los trinquetes de `lib/ui/sistema.test.ts` (colores crudos) y `lib/ui/escala.test.ts` (tamaños bajo 11 px) **no pueden subir**: nada de `text-red-500`, `bg-amber-50`, `text-[10px]` en código nuevo.
- **Nombres en inglés** (funciones, componentes, archivos, claves JSON, rutas, parámetros); etiquetas en español.
- **Suite del área + `npm run build` solo al final de cada despliegue** (Tasks 5 y 13): se toca código compartido (`services/pre_cierre.py`, `trips.py`, una migración, `lib/types.ts`). Por tarea, solo los tests que la tarea toca.
- **Despliegue a `dev`; nada a `main`.**
- **Commits** terminan con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Un `PATCH` que mezcla `operational_status` con `full_name`, hecho por un Operador de Operaciones.** Se espera 403 para el cuerpo entero y ninguna escritura (la persona no puede creer que guardó la mitad). Test en la Task 6 (`test_un_cuerpo_mixto_del_operador_se_rechaza_entero_y_no_escribe`).
2. **Una transferencia refresca el roster de origen y el de destino.** Abrir la ficha de la empresa destino dentro del minuto tiene que mostrar al conductor transferido. Test en la Task 8 (`una transferencia invalida el roster de origen y el de destino`).
3. **Un día del Cierre cuya única línea que bloquea es de alguien que ya no está en el roster.** La tabla la muestra en "Ya no están en el roster", la tarjeta de Tractoreo dice "1 sin motivo — bloquean el cierre", y la cantidad de filas es la que cuenta la firma. Tests en la Task 1 (backend `test_la_tabla_cuenta_lo_mismo_que_la_firma` y frontend `quien salió del roster aparece arriba…`).
4. **Una asignación insertada a las 22:30 de Chile** (ya es el día siguiente en UTC). `start_date` tiene que ser el día de Chile. Test en la Task 2 (`test_a_las_2230_de_chile_la_asignacion_toma_el_dia_de_chile`).
5. **Operaciones no ve un 403 en ninguna parte.** El Operador ve "Dar de baja"/"Reactivar" de conductores y equipos (y la API los acepta), y no ve "Quitar del roster", "Guardar", "Eliminar" de contacto, "Activar empresa", "Crear empresa nueva" ni el alta de conductor del pre-cierre, porque la API los rechazaría. Tests en la Task 6 (backend) y la Task 7 (frontend, `el Operador ve la baja del conductor y nada que la API le rechace` y `sin directory.edit el pre-cierre no ofrece lo que la API rechazaría`).

## Rulings tomados al escribir el plan (desvíos de la spec)

- **R1 — Cuatro tablas, no cinco (0.1).** `public.carrier_fleet_service_types` no existe: se borró en `20260803030000_drop_carrier_fleet_service_types.sql`. Medido el 12/10 en la base real: `start_date` con `DEFAULT CURRENT_DATE` existe en `driver_assignments`, `asset_assignments`, `vehicle_driver_assignments` y `carrier_shippers`, y en ninguna otra tabla de `public` ni `app`. La migración cambia esas cuatro. Costo si estuviera mal: una línea más en la migración.
- **R2 — La medición de D15 cambió (0.4).** La spec cita "29 líneas de 14 conductores; 28 bloquean 4 días". Medido el 12/10 con el roster vivo contra todos los días con período `OPEN`: **671 líneas de 52 conductores, 640 bloquean, en 29 días abiertos** (julio 343 líneas en 7 días, agosto 319 en 20 días, septiembre 9 en 2 días). La diferencia es de universo: hay 38 períodos `OPEN` desde el 21/07 que nadie firmó. No cambia el diseño, pero el grupo "Ya no están en el roster" será grande en los días viejos de julio y agosto, y la medición de la Task 5 compara contra esta cifra, no contra 28. Costo si estuviera mal: ninguno en código; solo la expectativa de la verificación.
- **R3 — Nombres reales del Cierre (0.4).** La spec dice `_LINES_SQL`; el SQL de la tabla se llama `_DETAIL_SQL` (`app/routers/daily_closures.py:49`, `JOIN active_roster` en `:75`) y el del reporte `_REPORT_SQL` (`:161`, `JOIN` en `:170`). La firma cuenta en `cierre_lineas.cerrar` (`app/services/cierre_lineas.py:593`; pendientes en `:603-613`, conteos en `:665-671`). El cierre por tracto (`equipment_closures.py`) no filtra por roster: no se toca.
- **R4 — La marca de pendiente ya existe en `equipment-closures`, y el aviso ya se ve en todas las pestañas (0.6).** `GET /equipment-closures` devuelve `**frescura_del_dia(...)` (`equipment_closures.py:202`); solo `GET /trips/cierre-viajes` (`trips.py:2348`) no la devuelve, y se le agrega. `AvisoDeActualizacion` ya se dibuja una vez, arriba de las pestañas (`closures/page.tsx:338-340`), con la marca de `daily-closure`, que es la misma fuente. Lo que falta es la **relectura de 15 s** en `equipment-closures` y `cierre-viajes`: se agrega con una sola función, `refetchWhilePending`. No se dibuja un segundo aviso. Costo si estuviera mal: pasar el componente a una pestaña.
- **R5 — "Activar empresa" en el pre-cierre (0.3). Requiere decisión del usuario.** Pasar una empresa de `ONBOARDING` a `ACTIVE` desde el Cierre (`PreCierrePendingSection.tsx:48,69`) es un `PATCH` de `operational_status`. Con la tabla de la spec, exige `directory.delete`: los Supervisores de Operaciones, que hoy pueden activarla, dejan de poder (y el Operador, que hoy recibe 403, deja de ver el botón). El plan aplica la spec literal y, sin el permiso, muestra "La activación de una empresa la hace Certificación". Costo si estuviera mal: una condición por valor en el mapa (`ONBOARDING → ACTIVE` con `directory.edit`) y un texto.
- **R6 — "Quitar conductor habitual" también pasa a `directory.edit` (0.3).** `DELETE /assets/{id}/driver-assignment` (`assets.py:221-223`) exige `directory.delete`, pero su botón se muestra con `canEdit` (`VehicleDetailPanel.tsx:343`): un Supervisor de Operaciones recibe 403. Es el mismo gesto que "Quitar del roster" (terminar una asignación), así que sigue la misma regla de la spec. Costo si estuviera mal: volver una línea y cambiar el `canEdit` del botón.
- **R7 — Pólizas y contactos con su permiso (0.3).** En la ficha de empresa del Directorio, "+ Póliza" y el modal de pólizas se muestran con `directory.edit`/`directory.delete` (`carriers/[id]/page.tsx:790,871-872`), pero sus endpoints exigen `policies.edit`/`policies.delete` (`routers/policies.py`, `carriers.py:956`). Y "Eliminar" contacto se muestra con `canEdit` (`ContactCard.tsx:85-88`) pero `DELETE /contacts/{id}` exige `directory.delete` (`contacts.py:70`). Los dos responden 403 a un Supervisor de Operaciones. Se alinean (criterio §1 de la spec: "cada botón se muestra según el mismo permiso que pide su endpoint"). Costo si estuviera mal: tres props.
- **R8 — Permiso base de `PATCH /drivers` y `PATCH /assets` (0.3).** El Operador no tiene `directory.edit`, así que la ruta no puede seguir exigiéndolo. Se usa el patrón de `PATCH /trips/{id}` (`trips.py:2684-2706`): la ruta declara el permiso más bajo (`directory.read`) y un mapa campo → permiso (`require_fields`) decide; un campo sin permiso invalida el cuerpo entero. Un test obliga a que todo campo del cuerpo esté en el mapa. `test_matriz_roles.py` sigue válido sin cambios. `PATCH /carriers/{id}` conserva `directory.edit` como base (nadie tiene `directory.delete` sin `directory.edit`). Costo si estuviera mal: un `require()` más estricto.
- **R9 — El Cierre se marca viejo sin releer, salvo cuando el cambio se hace desde el Cierre (0.5).** `invalidateDirectory` usa `refetchType: 'none'` para las claves del Cierre (spec). Pero el pre-cierre vive **dentro** del Cierre: hoy relee `daily-closure` al instante, y esa relectura es la que trae `pendiente_desde` y arranca el aviso y la relectura de 15 s. `PreCierrePendingSection` llama a `invalidateDirectory` y además relee las dos consultas del día, como hoy. Costo si estuviera mal: una línea.
- **R10 — La búsqueda de conductores del Monitor devuelve la empresa aunque esté de baja (0.9).** Hoy `GET /drivers?q` hace `LEFT JOIN carriers c … AND c.operational_status = 'ACTIVE'` (`drivers.py:58`), así que un conductor de una empresa de baja sale "Sin empresa" (F-04). Para marcarlo hay que traer la empresa y su estado. Para no cambiar lo que se asigna a un viaje, `FleetAssignSection.pick` solo autocompleta la empresa si no está dada de baja (el mismo resultado que hoy). Costo si estuviera mal: volver la condición del `JOIN`.
- **R11 — Qué invalida `invalidateDirectory` además de la lista de la spec (0.5).** También `['carriers-insurance-overview']`, `['carriers-insurance-overview-count']` (Seguros lista empresas por estado) y `['carrier-assets', id]` (equipos de la empresa en el modal de pólizas). Son pantallas que leen lo que el cambio modifica; quedarían viejas igual que las demás. La clave unificada de la ficha de empresa es `['carrier-detail', id]` (cuatro usos); `TransporterSlideOver` deja `['carriers','detail',id]`. Costo si estuviera mal: sacar dos raíces de una lista.
- **R12 — `NewCarrierPanel`, `AltaDeFlota`, `GestionDeclarada`, `VincularConductorPropuesto` y `AltaConductorDesdeCierre` delegan.** Escriben y avisan por un callback (`onCreated`, `onCreado`, `onGuardado`, `onVinculado`, `onListo`); quien los monta llama a `invalidateDirectory`. Así sus tests (que no montan `QueryClientProvider`, p. ej. `NewCarrierPanel.test.tsx:16`) no cambian. El test de la Task 8 los reconoce como delegados y exige que el callback exista. `AltaConductorDesdeCierre` pasa la empresa elegida a `onListo` para invalidar su roster.
- **R13 — El aviso de éxito al transferir y el aviso del Cierre se muestran en la ficha del Directorio (0.6, 0.7).** La ficha de Certificación también transfiere, pero se retira en D4 junto con la segunda ficha; ahí solo cambia la invalidación. Costo si estuviera mal: montar `DirectoryNotice` en una pantalla más.
- **R14 — Lo que el pre-cierre deja de leer (0.10).** Se quitan `Renombre`, `Clasificacion.renombres`, la rama que los propone en `clasificar`, la rama `UPDATE public.drivers SET full_name` de `aplicar_correcciones`, y `full_name`/`is_manual_override` de `Conductor` y de `_SQL_CONDUCTORES` (solo alimentaban el renombre). **Se conserva** la rama `pre_cierre_actualizar_nombre` de `_resuelta` (`pre_cierre.py:431-433`): lee filas viejas de `audit_log`, y sin ella esas filas se mostrarían como "Se agregó … a la lista de clientes". Costo si estuviera mal: ninguno, la rama no se alimenta más.
- **R15 — H4 cubre también el error (0.8).** La rama que dice "Esta empresa no tiene requisitos pendientes…" (`TriageClassifyForm.tsx:202-208`) se dibuja igual cuando la consulta falla. Es la misma rama y la misma clase de defecto que H2 ("un null con dos significados"), así que el estado `error` entra en el mismo cambio. Costo si estuviera mal: tres líneas.
- **R16 — Lo que queda fuera aunque se nombró al leer.** (a) La pestaña "Inactivas" de la lista del Directorio (`carriers/page.tsx`, plural, filtro) no cambia; la spec retira la etiqueta de estado "Inactiva" de `TransporterCard`. (b) "Dar de alta" en el Monitor (`monitor/page.tsx:743`) se muestra con `trips.edit_sensitive` y el alta exige `directory.edit`: ningún rol de sistema tiene uno sin el otro, así que no responde 403 a nadie hoy; se anota para D4.

---

## File Structure

**Backend (`monitor-app/backend/api/`, salvo la migración)**

| Archivo | Responsabilidad |
|---|---|
| `app/routers/daily_closures.py` (modificar) | `_DETAIL_SQL` y `_REPORT_SQL` con `LEFT JOIN active_roster` y `in_roster` (0.4). |
| `../supabase/migrations/20261012100000_assignment_start_date_in_chile.sql` (crear) | Default `public.hoy_chile()` en `start_date` de las cuatro tablas (0.1). |
| `app/routers/carriers.py` (modificar) | Roster de conductores en vivo (0.2); mapa de permisos en `PATCH`; `DELETE` de roster con `directory.edit` (0.3); estado de la empresa en `/buscar` (0.9). |
| `app/services/pre_cierre.py` (modificar) | Sin renombres (0.10). |
| `app/authz/permissions.py` (modificar) | `directory.fleet_status`, roles, descripción de `directory.delete` (0.3). |
| `app/schemas/driver.py`, `asset.py`, `carrier.py` (modificar) | `DRIVER_FIELD_PERMISSIONS`, `ASSET_FIELD_PERMISSIONS`, `CARRIER_FIELD_PERMISSIONS` (0.3). |
| `app/routers/drivers.py` (modificar) | `PATCH` con mapa por campo (0.3); empresa y su estado en `GET /drivers?q` (0.9). |
| `app/routers/assets.py` (modificar) | `PATCH` con mapa por campo; quitar conductor habitual con `directory.edit` (0.3). |
| `app/routers/trips.py` (modificar) | `cierre-viajes` devuelve la frescura del día (0.6). |
| `app/services/entity_summary.py` (modificar) | Estado de la empresa en la referencia `carrier` (0.9). |
| `tests/test_closure_single_universe_integration.py` (crear) | 0.4. |
| `tests/test_assignment_start_date_integration.py` (crear) | 0.1. |
| `tests/test_live_driver_roster_integration.py` (crear) | 0.2. |
| `tests/test_pre_cierre_integracion.py`, `tests/test_pre_cierre.py` (modificar) | 0.10. |
| `tests/test_carriers.py` (modificar) | El test que fijaba la vista materializada (`:546`). |
| `tests/test_directory_permissions.py` (crear) | 0.3. |
| `tests/test_get_del_cierre_no_escribe_integracion.py` (modificar) | `cierre-viajes` trae la frescura (0.6). |
| `tests/test_carrier_status_in_fleet_reads_integration.py` (crear) | 0.9. |
| `scripts/generar_permisos_ts.py` (ejecutar) | Regenera `frontend/lib/authz/permisos.generated.ts`. |

**Frontend (`monitor-app/frontend/`)**

| Archivo | Responsabilidad |
|---|---|
| `lib/types.ts` (modificar) | `in_roster`; `DirectoryEntity`; `statusLabel`; `isCarrierDeactivated`; `CARRIER_DEACTIVATED_LABEL`; campos de estado de empresa; frescura en `CierreViajesResponse`. |
| `components/dashboard/sections/FlotaDelDiaSection.tsx` (+ test) | Grupo "Ya no están en el roster" (0.4); relectura de 15 s (0.6). |
| `lib/queries/directorio.ts` (+ test) (crear) | `directoryKeys`, `DirectoryChange`, `invalidateDirectory`, `CLOSURE_NOTICE` (0.5). |
| `components/dashboard/DirectoryNotice.tsx` (+ test) (crear) | El aviso tras guardar en el Directorio (0.6, 0.7). |
| `components/dashboard/AvisoDeActualizacion.tsx` (+ test) | `refetchWhilePending` (0.6). |
| `app/dashboard/carriers/[id]/page.tsx` (+ test) | Permisos, invalidación, avisos, marca de empresa de baja. |
| `app/dashboard/compliance/[carrierId]/page.tsx` (+ test) | Texto sin `directory.delete`; invalidación. |
| `app/dashboard/compliance/page.tsx`, `app/dashboard/carriers/page.tsx`, `app/dashboard/compliance/inbox/page.tsx`, `app/dashboard/operations/monitor/page.tsx`, `app/dashboard/operations/closures/page.tsx` | Invalidación, claves, relectura. |
| `components/dashboard/DriverDetailPanel.tsx`, `VehicleDetailPanel.tsx` (+ tests) | `canChangeFleetStatus`, confirmar "Quitar", `canDeleteContacts`. |
| `components/dashboard/ContactCard.tsx` | `canDelete`. |
| `components/dashboard/sections/PreCierrePendingSection.tsx` (+ test), `AltaConductorDesdeCierre.tsx` | Permisos e invalidación. |
| `components/compliance/ConfirmarBaja.tsx` (+ test) | `variant: 'remove'`. |
| `components/dashboard/TransferModal.tsx` (+ test) | `onTransfer(id, name)`. |
| `components/dashboard/TransporterCard.tsx` (+ test), `TransporterSlideOver.tsx`, `ChipDeBaja.tsx`, `DriverRosterCard.tsx`, `VehicleRosterCard.tsx` (+ tests), `ResultadosDelDirectorio.tsx`, `EntityQuickView.tsx` (+ test), `DriverSearchPicker.tsx` (+ test), `FleetAssignSection.tsx` (+ test) | Diccionario de estados y marca de empresa de baja. |
| `lib/api/entitySummary.ts` | `EntityRef.operational_status`. |
| `lib/status.test.ts` (crear) | Diccionario único y sin "Inactiva". |
| `components/compliance/TriageWorkbench.tsx`, `TriageClassifyForm.tsx` (+ tests) | H2, H4. |
| `lib/authz/permisos.generated.ts` (regenerado) | `directory.fleet_status`. |

---

# Parte 1 — Despliegue 1: lo que hoy da datos falsos o bloquea

### Task 1: El Cierre muestra lo mismo que cuenta la firma (0.4)

**Files:**
- Modify: `monitor-app/backend/api/app/routers/daily_closures.py:49-76` (`_DETAIL_SQL`) y `:161-171` (`_REPORT_SQL`)
- Create: `monitor-app/backend/api/tests/test_closure_single_universe_integration.py`
- Modify: `monitor-app/frontend/lib/types.ts:1326` (`DriverDayStatusRow`)
- Modify: `monitor-app/frontend/components/dashboard/sections/FlotaDelDiaSection.tsx:233-262` (`Row`), `:342-381` (filas), `:449-454` (totales), `:617-626` (encabezado de grupo)
- Test: `monitor-app/frontend/components/dashboard/sections/FlotaDelDiaSection.test.tsx`

**Interfaces:**
- Produces: cada fila de `GET /daily-closures` y de `GET /daily-closures/report` trae `in_roster: boolean`. En el frontend, `DriverDayStatusRow.in_roster?: boolean` (opcional: un backend anterior no lo manda y se lee como `true`).

- [ ] **Step 1: Write the failing backend tests**

Patrón copiado de `tests/test_cierre_por_origen_integracion.py` (`_escenario`, `TRACTOREO_ID`) y de su test que ejecuta `_DETAIL_SQL` directo. Crear `tests/test_closure_single_universe_integration.py`:

```python
"""Bloque 0 del Directorio, 0.4: la tabla del Cierre y la firma cuentan el mismo
universo (spec 2026-10-12-directory-block-0-design.md §3).

La línea de un conductor que salió del roster después de calcularse su día
sigue bloqueando la firma (cierre_lineas.cerrar cuenta todas las líneas). La
tabla tiene que mostrarla, marcada. Contra Postgres de verdad, en una
transacción revertida."""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.routers.daily_closures import _DETAIL_SQL, _REPORT_SQL

pytestmark = pytest.mark.integracion

# Un día sin líneas ni período (medido el 12/10): el universo del día es solo lo
# que crea el test, así que los conteos no dependen de producción.
D = date.fromisoformat("2020-01-06")
TRACTOREO_ID = "89822208-0189-463a-93a0-605fb570c71b"
PREFIJO = "ZZ-TEST-DIRECTORIO"


async def _conductor_en_roster(conn) -> dict:
    """Empresa ACTIVE + tracto Tractoreo + conductor asignado: el mínimo para
    entrar a TRACTOREO_ROSTER_CTE (mismo armado que test_cierre_por_origen)."""
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {uuid.uuid4().hex[:6]}")
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}", uuid.UUID(TRACTOREO_ID))
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        tractor, carrier)
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Conductor {uuid.uuid4().hex[:6]}")
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        driver, carrier)
    return {"carrier": carrier, "driver": driver}


async def _linea_sin_motivo(conn, driver) -> None:
    await conn.execute(
        "INSERT INTO app.closure_lines (business_date, subject_type, subject_id, status, requires_reason) "
        "VALUES ($1, 'DRIVER', $2, 'UNASSIGNED', true)", D, driver)


async def test_la_linea_de_quien_salio_del_roster_se_ve_marcada(conexion_revertida):
    conn = conexion_revertida
    queda = await _conductor_en_roster(conn)
    sale = await _conductor_en_roster(conn)
    await _linea_sin_motivo(conn, queda["driver"])
    await _linea_sin_motivo(conn, sale["driver"])
    # Sale del roster DESPUÉS de calcularse el día: es lo que dejó ocultas las líneas del 11/10.
    await conn.execute(
        "UPDATE public.driver_assignments SET status = 'INACTIVE' WHERE driver_id = $1", sale["driver"])

    filas = {f["driver_id"]: f for f in await conn.fetch(_DETAIL_SQL, D)}

    assert sale["driver"] in filas, "la línea de quien salió del roster tiene que verse"
    assert filas[sale["driver"]]["in_roster"] is False
    assert filas[sale["driver"]]["category"] == "SIN_RESOLVER"
    assert filas[queda["driver"]]["in_roster"] is True


async def test_la_tabla_cuenta_lo_mismo_que_la_firma(conexion_revertida):
    """Review Focus 3: un día cuya única línea que bloquea es de alguien que ya
    no está en el roster (aquí, por una baja del conductor)."""
    conn = conexion_revertida
    sale = await _conductor_en_roster(conn)
    await _linea_sin_motivo(conn, sale["driver"])
    await conn.execute("UPDATE public.drivers SET operational_status = 'INACTIVE' WHERE id = $1", sale["driver"])

    filas = await conn.fetch(_DETAIL_SQL, D)
    # Lo que lee la firma: cierre_lineas.cerrar cuenta todas las líneas DRIVER del
    # día (conteos) y bloquea con MISMATCH o UNASSIGNED sin motivo (pendientes).
    universo_de_la_firma = await conn.fetchval(
        "SELECT count(*) FROM app.closure_lines WHERE business_date = $1 AND subject_type = 'DRIVER'", D)
    bloquean = await conn.fetchval(
        "SELECT count(*) FROM app.closure_lines WHERE business_date = $1 AND subject_type = 'DRIVER' "
        "AND (status = 'MISMATCH' OR (status = 'UNASSIGNED' AND reason_id IS NULL))", D)

    assert len(filas) == universo_de_la_firma == 1
    assert bloquean == 1
    assert filas[0]["category"] == "SIN_RESOLVER" and filas[0]["in_roster"] is False


async def test_el_reporte_tambien_trae_a_quien_salio(conexion_revertida):
    conn = conexion_revertida
    sale = await _conductor_en_roster(conn)
    await _linea_sin_motivo(conn, sale["driver"])
    await conn.execute(
        "UPDATE public.driver_assignments SET status = 'INACTIVE' WHERE driver_id = $1", sale["driver"])

    filas = await conn.fetch(_REPORT_SQL, D, D)

    assert [f["in_roster"] for f in filas if f["driver_id"] == sale["driver"]] == [False]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_closure_single_universe_integration.py -q`
Expected: FAIL. Los dos primeros con `AssertionError: la línea de quien salió del roster tiene que verse` / `assert 0 == 1`; el tercero con `assert [] == [False]`. Si falla por un `KeyError: 'in_roster'` en la fila de `queda`, también vale (la columna no existe todavía), pero el primer assert tiene que ser el de "tiene que verse".

- [ ] **Step 3: Implement the backend**

En `_DETAIL_SQL` (`daily_closures.py`), agregar la columna después de `dds.status, dds.category, …` (línea 51), por ejemplo al final del `SELECT`, antes de `FROM`:

```sql
       hcd.name                   AS home_cd_name,
       -- Bloque 0 del Directorio (0.4): la firma cuenta TODAS las líneas del día
       -- (cierre_lineas.cerrar). Quien salió del roster después de calcularse su
       -- línea sigue bloqueando; la tabla lo muestra, marcado, en vez de ocultarlo.
       (ar.driver_id IS NOT NULL) AS in_roster
FROM {LINEAS_CONDUCTORES} dds
LEFT JOIN active_roster ar ON ar.driver_id = dds.driver_id
```

(reemplaza `JOIN active_roster ar ON ar.driver_id = dds.driver_id` de la línea 75; la coma que antes cerraba `hcd.name AS home_cd_name` pasa a estar antes de la columna nueva).

En `_REPORT_SQL`, igual:

```sql
       hcd.name AS home_cd_name,
       (ar.driver_id IS NOT NULL) AS in_roster
FROM {LINEAS_CONDUCTORES} dds
LEFT JOIN active_roster ar ON ar.driver_id = dds.driver_id
```

`active_roster` da una fila por conductor (índice único `idx_driver_assignments_one_active`), así que el `LEFT JOIN` no duplica líneas.

- [ ] **Step 4: Run the backend tests to verify they pass**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_closure_single_universe_integration.py tests/test_cierre_por_origen_integracion.py tests/test_get_del_cierre_no_escribe_integracion.py tests/test_daily_closures.py -q`
Expected: PASS.

- [ ] **Step 5: Verificar que la mutación mata el test**

Volver `LEFT JOIN active_roster` a `JOIN active_roster` solo en `_DETAIL_SQL`. Correr `tests/test_closure_single_universe_integration.py`. Expected: FAIL en `test_la_linea_de_quien_salio_del_roster_se_ve_marcada` y `test_la_tabla_cuenta_lo_mismo_que_la_firma`. Restaurar.

- [ ] **Step 6: Write the failing frontend test**

En `lib/types.ts`, dentro de `DriverDayStatusRow` (después de `today_trip_origin`), agregar el campo para que el test compile:

```ts
  /** Bloque 0 del Directorio (0.4): false si el conductor ya no está en el roster
   *  vivo pero su línea del día sigue contando para la firma. Opcional: un
   *  backend anterior no lo manda, y entonces se lee como true. */
  in_roster?:                  boolean
```

En `FlotaDelDiaSection.test.tsx` (patrón de los tests del grupo "Otros conductores del día", `:462` y `:600`), agregar dentro del `describe`:

```tsx
  it('quien salió del roster aparece arriba, en su grupo, y cuenta para la firma (0.4)', async () => {
    await soloConductores()
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ driver_id: 'd1', full_name: 'Ana Soto', status: 'ASSIGNED', today_trip_id: 't1', in_roster: true }),
        driverRow({ driver_id: 'd9', full_name: 'Pedro Fuera', status: 'UNASSIGNED', in_roster: false }),
      ],
    })
    renderSection()

    const titulo = await screen.findByText('Ya no están en el roster')
    const filas = screen.getAllByRole('row')
    const iGrupo = filas.findIndex(f => f.contains(titulo))
    // El grupo va primero (antes de cualquier otra fila de datos) porque bloquea.
    expect(iGrupo).toBe(1)
    expect(within(filas[iGrupo + 1]).getByText('Pedro Fuera')).toBeInTheDocument()
    // Se resuelve igual que siempre: con su motivo.
    expect(screen.getByRole('combobox', { name: 'Motivo de Pedro Fuera' })).toBeInTheDocument()
    // Y la tarjeta cuenta lo mismo que la firma.
    expect(screen.getByText('1 sin motivo — bloquean el cierre')).toBeInTheDocument()
  })

  it('sin la marca (backend anterior) no aparece el grupo', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    expect(screen.queryByText('Ya no están en el roster')).not.toBeInTheDocument()
  })
```

`filas[0]` es la fila de encabezados de la tabla; por eso el grupo es el índice 1.

- [ ] **Step 7: Run it to verify it fails**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/FlotaDelDiaSection.test.tsx`
Expected: FAIL en el primero con `Unable to find an element with the text: Ya no están en el roster`. El segundo pasa (ya es cierto hoy; queda como guarda).

- [ ] **Step 8: Implement the frontend**

En `FlotaDelDiaSection.tsx`:

1. En el tipo `Row` (después de `soloConductor?: boolean`):

```ts
    /** Ya no está en el roster, pero su línea del día cuenta para la firma (0.4). */
    outOfRoster?: boolean
```

2. Reemplazar `const conductorPorId = new Map(drivers.drivers.map(d => [d.driver_id, d]))` (`:344`) por:

```ts
  // 0.4: quien salió del roster sigue teniendo su línea del día, y esa línea
  // bloquea la firma. Va en su propio grupo, arriba, y nunca se funde con la
  // fila de un tracto: ya no es el habitual de nadie en la empresa de hoy.
  const enRoster = drivers.drivers.filter(d => d.in_roster !== false)
  const filasFueraDelRoster: Row[] = drivers.drivers
    .filter(d => d.in_roster === false)
    .map(d => filaDeConductor(d, { outOfRoster: true }))
  const conductorPorId = new Map(enRoster.map(d => [d.driver_id, d]))
```

3. En `filasDeConductoresSinTracto` (`:378`), cambiar `drivers.drivers` por `enRoster`.

4. Las dos listas que arman la vista de Tractoreo incluyen el grupo, primero:

```ts
  const rows: Row[] = esTractoreo
    ? [...filasFueraDelRoster, ...filasDeTractoreo, ...filasDeConductoresSinTracto]
    : equiposCompletos.equipment.map(filaDeTracto)
```

```ts
  const filasTractoreoTotales = [...filasFueraDelRoster, ...filasDeTractoreo, ...filasDeConductoresSinTracto]
```

5. Dentro del `paged.map`, antes del encabezado de "Otros conductores del día" (`:620`), el encabezado del grupo nuevo, con el mismo patrón:

```tsx
              {esTractoreo && !orden && r.outOfRoster && !paged[i - 1]?.outOfRoster && (
                <tr>
                  <td colSpan={11} className="px-3 py-2 bg-bg-main text-etiqueta text-informativo">
                    <span className="font-bold uppercase tracking-wide">Ya no están en el roster</span>
                    <span className="ml-2">Su línea del día sigue contando para la firma.</span>
                  </td>
                </tr>
              )}
```

- [ ] **Step 9: Run the frontend tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/FlotaDelDiaSection.test.tsx lib/ui lib/copy && npx tsc --noEmit`
Expected: PASS, trinquetes sin subir.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/backend/api/app/routers/daily_closures.py \
  monitor-app/backend/api/tests/test_closure_single_universe_integration.py \
  monitor-app/frontend/lib/types.ts \
  monitor-app/frontend/components/dashboard/sections/FlotaDelDiaSection.tsx \
  monitor-app/frontend/components/dashboard/sections/FlotaDelDiaSection.test.tsx
git commit -m "fix(cierre): la tabla muestra las líneas de quien salió del roster

La firma cuenta todas las líneas del día y la tabla filtraba por el roster
vivo: líneas sin motivo bloqueaban días sin verse. LEFT JOIN active_roster con
in_roster, y un grupo propio arriba (bloque 0 del Directorio, 0.4).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fecha de Chile en las asignaciones (0.1)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261012100000_assignment_start_date_in_chile.sql`
- Create: `monitor-app/backend/api/tests/test_assignment_start_date_integration.py`

**Interfaces:**
- Produces: `DEFAULT public.hoy_chile()` en `start_date` de `public.driver_assignments`, `public.asset_assignments`, `public.vehicle_driver_assignments` y `public.carrier_shippers` (R1). No toca filas existentes.

- [ ] **Step 1: Create the migration with only its header**

Para que el test falle por el motivo correcto (el default) y no por un archivo inexistente:

```sql
-- Bloque 0 del Directorio, 0.1 (spec docs/superpowers/specs/2026-10-12-directory-block-0-design.md):
-- el inicio de una asignación es el día de Chile, no el de UTC. La base corre en
-- UTC: desde las 21:00 de Chile, CURRENT_DATE ya es mañana, y un traslado del
-- 11/10 a las 21:55 quedaba con fecha 12/10 (F-10).
--
-- Solo cambia el DEFAULT: es metadato, no reescribe la tabla ni toca filas
-- existentes (corregir las viejas va en D2). Cubre a todos los escritores que no
-- mandan start_date, incluido el INSERT de carriers.py:_transferir.
--
-- carrier_fleet_service_types no está: se borró en 20260803030000.
--
-- Re-ejecutable: los tests la corren dentro de su transacción revertida.
```

- [ ] **Step 2: Write the failing test**

Patrón copiado de `tests/test_hoy_chile.py` (cargar la migración dentro de la transacción) y de `tests/test_exigibilidad_integracion.py:41-45` (`_hoy`, reemplazar `hoy_chile()` en la transacción). Crear `tests/test_assignment_start_date_integration.py`:

```python
"""Bloque 0 del Directorio, 0.1: una asignación nueva toma el día de Chile.

Carga la migración dentro de la transacción revertida (patrón de
test_hoy_chile.py): se prueba el SQL que se va a desplegar."""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.integracion

MIGRACION = (Path(__file__).resolve().parents[2]
             / "supabase/migrations/20261012100000_assignment_start_date_in_chile.sql")
TABLAS = ("driver_assignments", "asset_assignments", "vehicle_driver_assignments", "carrier_shippers")
PREFIJO = "ZZ-TEST-DIRECTORIO"


async def _cargar(conn) -> None:
    # ALTER TABLE toma un lock exclusivo sobre tablas de producción hasta el
    # ROLLBACK. Si alguien las tiene tomadas, el test falla en 3 s en vez de
    # quedarse esperando (y de hacer esperar a la app detrás suyo).
    await conn.execute("SET LOCAL lock_timeout = '3s'")
    await conn.execute(MIGRACION.read_text())


async def _hoy_chile_fijo(conn, dia) -> None:
    """Igual que test_exigibilidad_integracion._hoy: la función se reemplaza
    dentro de la transacción revertida."""
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$")


async def test_el_default_de_start_date_es_hoy_chile_en_las_cuatro_tablas(conexion_revertida):
    await _cargar(conexion_revertida)
    defaults = {r["table_name"]: r["column_default"] for r in await conexion_revertida.fetch(
        "SELECT table_name, column_default FROM information_schema.columns "
        "WHERE table_schema = 'public' AND column_name = 'start_date' AND table_name = ANY($1::text[])",
        list(TABLAS))}
    assert set(defaults) == set(TABLAS)
    for tabla, default in defaults.items():
        assert "hoy_chile()" in (default or ""), f"{tabla}: {default}"


async def test_a_las_2230_de_chile_la_asignacion_toma_el_dia_de_chile(conexion_revertida):
    """Review Focus 4. A las 22:30 de Chile el día UTC ya es el siguiente: se
    simula dejando hoy_chile() en la víspera de CURRENT_DATE."""
    conn = conexion_revertida
    await _cargar(conn)
    vispera = await conn.fetchval("SELECT CURRENT_DATE - 1")
    await _hoy_chile_fijo(conn, vispera)
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {uuid.uuid4().hex[:6]}")
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Conductor {uuid.uuid4().hex[:6]}")

    # Sin start_date: como lo inserta carriers.py:_transferir.
    inicio = await conn.fetchval(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) "
        "VALUES ($1, $2, 'ACTIVE') RETURNING start_date", driver, carrier)

    assert inicio == vispera
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_assignment_start_date_integration.py -q`
Expected: FAIL. El primero con `AssertionError: driver_assignments: CURRENT_DATE`; el segundo con `assert <CURRENT_DATE> == <víspera>`.

- [ ] **Step 4: Write the migration body**

Agregar al final del archivo:

```sql
ALTER TABLE public.driver_assignments          ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
ALTER TABLE public.asset_assignments           ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
ALTER TABLE public.vehicle_driver_assignments  ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
ALTER TABLE public.carrier_shippers            ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_assignment_start_date_integration.py tests/test_hoy_chile.py -q`
Expected: PASS.

- [ ] **Step 6: Verificar que la mutación mata el test**

Comentar la línea de `carrier_shippers`. Correr el primer test. Expected: FAIL con `carrier_shippers: CURRENT_DATE`. Restaurar.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261012100000_assignment_start_date_in_chile.sql \
  monitor-app/backend/api/tests/test_assignment_start_date_integration.py
git commit -m "fix(directorio): las asignaciones nuevas toman la fecha de Chile

DEFAULT public.hoy_chile() en start_date de las cuatro tablas de asignación;
solo metadato, sin tocar filas (bloque 0 del Directorio, 0.1). Se aplica en
la Task 5.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Roster de conductores en vivo (0.2)

**Files:**
- Modify: `monitor-app/backend/api/app/routers/carriers.py:709-725` (`list_carrier_drivers`)
- Create: `monitor-app/backend/api/tests/test_live_driver_roster_integration.py`
- Modify: `monitor-app/backend/api/tests/test_carriers.py:530-547` (el test fijaba la vista materializada)

**Interfaces:**
- Produces: `GET /carriers/{id}/drivers` con la misma forma de hoy (`id, tax_id, full_name, operational_status, total_requirements, last_document_update, pending_mandatory, compliance_health`), con nombre y estado leídos de `public.drivers`.

- [ ] **Step 1: Write the failing test**

Patrón copiado de `tests/test_entity_summary_integration.py` (llamar la función del router con `PoolDeUnaConexion`). Crear `tests/test_live_driver_roster_integration.py`:

```python
"""Bloque 0 del Directorio, 0.2: el roster de conductores de una empresa se lee
en vivo. app.carrier_driver_roster es una vista materializada sin trigger de
refresco en public.drivers: renombrar o dar de baja a un conductor dejaba la
lista vieja incluso después de recargar (F-14)."""
from __future__ import annotations

import uuid

import pytest

from app.routers.carriers import list_carrier_drivers
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-DIRECTORIO"


async def test_renombrar_y_dar_de_baja_se_ve_en_el_roster_sin_refrescar_vistas(conexion_revertida):
    conn = conexion_revertida
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {uuid.uuid4().hex[:6]}")
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Antes {uuid.uuid4().hex[:6]}")
    # Esta escritura SÍ refresca las vistas (trigger de sentencia en
    # driver_assignments): la vista queda con el nombre de antes.
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        driver, carrier)
    nuevo = f"{PREFIJO} Despues {uuid.uuid4().hex[:6]}"
    # Esta no: public.drivers no tiene trigger de refresco.
    await conn.execute(
        "UPDATE public.drivers SET full_name = $2, operational_status = 'INACTIVE' WHERE id = $1",
        driver, nuevo)

    filas = await list_carrier_drivers(str(carrier), pool=PoolDeUnaConexion(conn), _=None)

    assert [(f["id"], f["full_name"], f["operational_status"]) for f in filas] == [(driver, nuevo, "INACTIVE")]
    assert set(filas[0]) >= {"total_requirements", "pending_mandatory", "compliance_health"}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_live_driver_roster_integration.py -q`
Expected: FAIL: la tupla trae el nombre `… Antes …` y `ACTIVE`.

- [ ] **Step 3: Implement**

Reemplazar el cuerpo de `list_carrier_drivers` (`carriers.py:709-725`):

```python
@router.get("/{carrier_id}/drivers")
async def list_carrier_drivers(carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    # En vivo desde public.drivers (bloque 0 del Directorio, 0.2), igual que
    # list_carrier_assets lee el tipo de operación en vivo. La vista
    # app.carrier_driver_roster no tiene trigger de refresco en drivers, y
    # agregarle uno sumaría un REFRESH más por escritura (F-18). Los conteos de
    # documentos siguen saliendo de app.driver_compliance_status, que sí se
    # refresca cuando cambian los documentos.
    rows = await pool.fetch(
        f"""
        SELECT r.driver_id AS id, r.tax_id, r.full_name, r.operational_status,
               dcs.total_requirements, dcs.last_document_update,
               COALESCE(sev.pending_mandatory, 0) AS pending_mandatory,
               CASE WHEN COALESCE(sev.pending_mandatory, 0) > 0 THEN 'PENDING' ELSE 'OK' END AS compliance_health
        FROM (
            SELECT d.id AS driver_id, d.tax_id, d.full_name, d.operational_status
            FROM public.driver_assignments da
            JOIN public.drivers d ON d.id = da.driver_id
            WHERE da.carrier_id = $1 AND da.status = 'ACTIVE'
        ) r
        LEFT JOIN app.driver_compliance_status dcs ON dcs.driver_id = r.driver_id
        {_pending_mandatory_join('DRIVER', 'driver_id')}
        ORDER BY r.full_name
        """,
        carrier_id,
    )
    return [dict(r) for r in rows]
```

`_pending_mandatory_join` une por `r.driver_id`, que la subconsulta conserva.

- [ ] **Step 4: Update the mocked test that fixed the defect**

En `tests/test_carriers.py`, `test_list_carrier_drivers_includes_pending_mandatory` (`:546`) afirma `"FROM app.carrier_driver_roster r" in fetch_query`: es exactamente el defecto. Reemplazar esa línea por:

```python
    # En vivo (bloque 0, 0.2): nunca desde la vista materializada sin refresco.
    assert "carrier_driver_roster" not in fetch_query
    assert "JOIN public.drivers d" in fetch_query
```

- [ ] **Step 5: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_live_driver_roster_integration.py tests/test_carriers.py -q`
Expected: PASS.

- [ ] **Step 6: Verificar que la mutación mata el test**

Volver `FROM (…) r` a `FROM app.carrier_driver_roster r … WHERE r.carrier_id = $1`. Correr `tests/test_live_driver_roster_integration.py`. Expected: FAIL con el nombre viejo. Restaurar.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/routers/carriers.py \
  monitor-app/backend/api/tests/test_live_driver_roster_integration.py \
  monitor-app/backend/api/tests/test_carriers.py
git commit -m "fix(directorio): el roster de conductores se lee en vivo

Renombrar o dar de baja a un conductor dejaba la lista vieja incluso después
de recargar: la vista materializada no se refresca con drivers. Sin trigger ni
REFRESH nuevos (bloque 0 del Directorio, 0.2).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: El pre-cierre deja de renombrar conductores (0.10)

**Files:**
- Modify: `monitor-app/backend/api/app/services/pre_cierre.py:77-84` (`Conductor`), `:116-121` (`Renombre`), `:134-139` (`Clasificacion`), `:183-196` (rama en `clasificar`), `:243-256` (`_SQL_CONDUCTORES`), `:340-353` (rama en `aplicar_correcciones`), `:431-433` (comentario en `_resuelta`)
- Modify: `monitor-app/backend/api/tests/test_pre_cierre_integracion.py:75-83`
- Modify: `monitor-app/backend/api/tests/test_pre_cierre.py:80-92`

**Interfaces:**
- Produces: `Conductor(rut: str, es_canonico: bool, names: list[str], driver_id: str | None)`. `Clasificacion` sin `renombres`. La reasignación de tractos y el vínculo de clientes **no cambian** (P10, P11 abiertas).

- [ ] **Step 1: Turn the test that fixes the defect into the failing test**

En `tests/test_pre_cierre_integracion.py`, reemplazar `test_corrige_el_nombre_del_conductor_por_rut` (`:75-83`) por:

```python
async def test_un_nombre_distinto_en_el_tms_no_renombra_al_conductor(conexion_revertida):
    """Bloque 0 del Directorio, 0.10 (P9, 12/10): el nombre lo gestiona el
    Directorio; el TMS solo dice quién manejó cada viaje. Hasta acá este test
    afirmaba lo contrario: fijaba el defecto (A-7, el origen de D7)."""
    rut, canon = await _rut_libre(conexion_revertida)
    conductor = await conexion_revertida.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ('Ana', $1, 'ACTIVE') RETURNING id", canon)
    await _viaje(conexion_revertida, rut=rut, driver_name="Ana Paz")

    await pre_cierre.aplicar_correcciones(conexion_revertida, D)

    assert await conexion_revertida.fetchval("SELECT full_name FROM public.drivers WHERE id = $1", conductor) == "Ana"
    assert not await conexion_revertida.fetchval(
        "SELECT 1 FROM public.audit_log WHERE entity_id = $1 AND action = 'pre_cierre_actualizar_nombre'", conductor)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_pre_cierre_integracion.py -q -k no_renombra`
Expected: FAIL con `assert 'Ana Paz' == 'Ana'`.

- [ ] **Step 3: Implement**

En `pre_cierre.py`:

1. `Conductor` queda:

```python
@dataclass(frozen=True)
class Conductor:
    rut: str
    es_canonico: bool
    names: list[str]
    driver_id: str | None
```

2. Borrar el dataclass `Renombre` (`:116-121`) y el campo `renombres` de `Clasificacion` (`:136`).

3. En `clasificar`, el bucle de conductores queda (el resto del cuerpo no cambia):

```python
    # El nombre del conductor lo gestiona el Directorio (P9, 12/10): el TMS solo
    # dice quién manejó cada viaje. Por eso acá ya no se propone renombrar.
    for d in s.conductores:
        if not d.es_canonico:
            c.escalations["CONDUCTOR_NO_REGISTRADO"].append(
                {"driver_rut": d.rut, "reason": "El TMS informó un RUT que no es válido"})
            continue
        if not d.driver_id:
            c.escalations["CONDUCTOR_NO_REGISTRADO"].append(
                {"driver_rut": d.rut, "driver_name_tms": _single_value(d.names)})
```

4. `_SQL_CONDUCTORES`: el `SELECT` final y el `LATERAL` quedan:

```sql
SELECT r.rut, r.es_canonico, r.names, d.id::text AS driver_id
FROM r
LEFT JOIN LATERAL (
    SELECT id FROM public.drivers WHERE tax_id = r.rut LIMIT 1
) d ON r.es_canonico
```

5. En `aplicar_correcciones`, borrar entera la rama `if c.renombres:` (`:340-353`).

6. En `_resuelta`, sobre la rama `if r["action"] == "pre_cierre_actualizar_nombre":` (`:431`), un comentario:

```python
    # Ya no se escribe (bloque 0, 0.10); queda para leer las filas viejas de
    # audit_log, que sin esta rama se mostrarían como un cliente agregado.
```

- [ ] **Step 4: Adapt the unit tests to the new `Conductor`**

En `tests/test_pre_cierre.py`:
- en `test_rut_invalido_es_aviso_y_rut_sin_conductor_propone_el_nombre` (`:80-88`), quitar `full_name=None, is_manual_override=False` de los dos `Conductor(...)`;
- reemplazar `test_nombre_distinto_para_el_mismo_rut_se_corrige` (`:89-92`) por:

```python
def test_un_nombre_distinto_en_el_tms_no_es_una_correccion():
    """P9 (12/10): el nombre lo gestiona el Directorio."""
    c = clasificar(senales(conductores=[Conductor(
        rut="11111111-1", es_canonico=True, names=[" Ana Paz "], driver_id=D1)]))
    assert not hasattr(c, "renombres")
    assert c.escalations["CONDUCTOR_NO_REGISTRADO"] == []
```

- [ ] **Step 5: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_pre_cierre.py tests/test_pre_cierre_integracion.py tests/test_cierre_lineas.py -q`
Expected: PASS.

- [ ] **Step 6: Verificar que la mutación mata el test**

Restaurar temporalmente la rama `if c.renombres:` con su `UPDATE` (y el campo y la rama de `clasificar`) desde `git stash`/`git diff`; correr `-k no_renombra`. Expected: FAIL con `'Ana Paz' == 'Ana'`. Volver al cambio.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/services/pre_cierre.py \
  monitor-app/backend/api/tests/test_pre_cierre.py \
  monitor-app/backend/api/tests/test_pre_cierre_integracion.py
git commit -m "fix(cierre): el pre-cierre deja de renombrar conductores

El nombre del conductor lo gestiona el Directorio; el TMS solo dice quién
manejó cada viaje (P9, 12/10). La reasignación de tractos y el vínculo de
clientes no cambian (P10, P11). Bloque 0 del Directorio, 0.10.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificación y despliegue 1

**Files:**
- Modify: `AGENTLOG.md` (entrada del despliegue 1)

- [ ] **Step 1: Suite del área (backend, primer plano)**

Run:

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest \
  tests/test_closure_single_universe_integration.py tests/test_assignment_start_date_integration.py \
  tests/test_live_driver_roster_integration.py tests/test_pre_cierre.py tests/test_pre_cierre_integracion.py \
  tests/test_cierre_lineas.py tests/test_cierre_por_origen_integracion.py tests/test_daily_closures.py \
  tests/test_get_del_cierre_no_escribe_integracion.py tests/test_cola_del_cierre_integracion.py \
  tests/test_cola_del_cierre_ejecutor_integracion.py tests/test_firma_versionada_integracion.py \
  tests/test_firma_inmutable_integracion.py tests/test_modelo_de_cierre.py tests/test_status_report.py \
  tests/test_reporte_de_estatus_integracion.py tests/test_carriers.py tests/test_directorio.py \
  tests/test_entity_summary_integration.py tests/test_hoy_chile.py tests/test_toda_ruta_declara_permiso.py -q
```

Expected: todo en verde. Si aparece la roja conocida `test_cargar_catalogo_webcarga::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar`, no es de este cambio (no está en esta lista; si alguien la agrega, se anota y no se toca).

- [ ] **Step 2: Suite del área (frontend) y build**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections app/dashboard/operations lib && npx tsc --noEmit && npm run build`
Expected: verde. El build corre acá porque `lib/types.ts` es compartido.

- [ ] **Step 3: Ensayar la migración con ROLLBACK y aplicarla (MCP de Supabase)**

Con `mcp__claude_ai_Supabase__execute_sql(project_id="viclzoftiudkepqnhekv", query=…)` (no `psql`: el clasificador bloquea escrituras a producción por `psql`, y con razón). Primero el ensayo:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
-- contenido completo de 20261012100000_assignment_start_date_in_chile.sql
SELECT table_name, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'start_date'
  AND table_name IN ('driver_assignments','asset_assignments','vehicle_driver_assignments','carrier_shippers');
ROLLBACK;
```

Expected: las cuatro filas con `hoy_chile()`. Después, lo mismo con `COMMIT` en vez de `ROLLBACK`, y volver a leer los defaults fuera de la transacción.

- [ ] **Step 4: Push y workflows**

```bash
git push origin dev
gh run list --branch dev --limit 4
```

Esperar en primer plano (`gh run watch <id> --exit-status`) a `Deploy Monitor API` y `Deploy Frontend`. Expected: `success`. Si `Deploy Frontend` falla bajando Google Fonts (`next/font/google`), es la falla de red conocida: reintentar el run.

- [ ] **Step 5: Medir en dev los días bloqueados (solo lectura)**

Contar, con el roster vivo, las líneas fuera del roster en días abiertos (solo conteos, sin nombres):

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio
import asyncpg
from tests.conftest import credenciales_integracion
from app.services.driver_roster import TRACTOREO_ROSTER_CTE
async def main():
    c = await asyncpg.connect(**credenciales_integracion())
    try:
        await c.execute("BEGIN READ ONLY")
        for r in await c.fetch(f"""WITH {TRACTOREO_ROSTER_CTE}
            SELECT l.business_date, count(*) AS lineas,
                   count(*) FILTER (WHERE l.status = 'MISMATCH' OR (l.status = 'UNASSIGNED' AND l.reason_id IS NULL)) AS bloquean
            FROM app.closure_lines l
            JOIN app.closure_periods p ON p.business_date = l.business_date AND p.status <> 'CLOSED'
            LEFT JOIN active_roster ar ON ar.driver_id = l.subject_id
            WHERE l.subject_type = 'DRIVER' AND ar.driver_id IS NULL
            GROUP BY 1 ORDER BY 1"""):
            print(dict(r))
    finally:
        await c.close()
asyncio.run(main())
EOF
```

Expected (R2): del orden de 671 líneas en 29 días (medido el 12/10; puede variar). Elegir el día abierto más reciente de la lista, abrirlo en el frontend de dev (`/dashboard/operations/closures?date=<día>`) **sin escribir nada**, y comprobar que el grupo "Ya no están en el roster" tiene tantas filas como `lineas` para ese día y que la tarjeta de Tractoreo suma las que `bloquean`. Captura en `.playwright-mcp/directorio-b0-cierre-dev.png` (Playwright MCP, nunca claude-in-chrome).

- [ ] **Step 6: AGENTLOG y commit**

En `AGENTLOG.md`, en la sección del 12/10 del Directorio:
- qué se desplegó (commits de las Tasks 1-4), la migración aplicada y la medición del Step 5;
- las rulings R1-R3 y R14;
- siguiente paso exacto: Task 6 (Parte 2), y la decisión pendiente R5 ("Activar empresa").

```bash
git add AGENTLOG.md
git commit -m "docs(agentlog): Directorio bloque 0, despliegue 1 en dev

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin dev
```

---

# Parte 2 — Despliegue 2: coherencia entre pantallas

### Task 6: Permisos según D-e, en la API (0.3, backend)

**Files:**
- Modify: `monitor-app/backend/api/app/authz/permissions.py:33-35` (enum), `:79` (descripción), `:115` (`_OPS_OPERADOR`), `:136-138` (Supervisor de Certificación)
- Modify: `monitor-app/backend/api/app/schemas/driver.py`, `asset.py`, `carrier.py` (mapas por campo)
- Modify: `monitor-app/backend/api/app/routers/drivers.py:320-330`, `assets.py:102-112` y `:221-223`, `carriers.py:574-580`, `:812-814`, `:876-878`
- Create: `monitor-app/backend/api/tests/test_directory_permissions.py`
- Run: `monitor-app/backend/api/scripts/generar_permisos_ts.py` → `monitor-app/frontend/lib/authz/permisos.generated.ts`

**Interfaces:**
- Produces: `Permission.DIRECTORY_FLEET_STATUS = "directory.fleet_status"`; `DRIVER_FIELD_PERMISSIONS`, `ASSET_FIELD_PERMISSIONS`, `CARRIER_FIELD_PERMISSIONS: dict[str, Permission]`; en el frontend, el código `'directory.fleet_status'` en `PermissionCode`.
- Llega a `app.role_permissions` por `sync_catalog` al arrancar la API (`app/main.py:47-48`), igual que el 10/10. **No hace falta migración**: `app.permissions` y la composición de los roles de sistema se alinean al catálogo en cada arranque.

| Acción | Endpoint | Permiso |
|---|---|---|
| Baja / reactivar conductor o equipo | `PATCH /drivers/{id}`, `PATCH /assets/{id}` con `operational_status` | `directory.fleet_status` |
| Baja / reactivar empresa | `PATCH /carriers/{id}` con `operational_status` | `directory.delete` |
| Quitar del roster | `DELETE /carriers/{id}/drivers/{d}`, `DELETE /carriers/{id}/assets/{a}` | `directory.edit` |
| Quitar conductor habitual (R6) | `DELETE /assets/{id}/driver-assignment` | `directory.edit` |
| Resto de campos | `PATCH` de los tres | `directory.edit` |
| Borrar empresa y contactos | `DELETE /carriers/{id}`, `DELETE /contacts/{id}` | `directory.delete` (sin cambio) |

- [ ] **Step 1: Write the failing tests**

Patrón copiado de `tests/test_permisos_por_campo.py` (usuarios por rol con `usuario(...)`, cliente que **no** sobrescribe el guardia) y de `tests/test_drivers.py:120-140`, `tests/test_assets.py:82-99`, `tests/test_carriers.py:394-411`, `:890-901` (mocks de pool y conexión). Crear `tests/test_directory_permissions.py`:

```python
"""Bloque 0 del Directorio, 0.3: permisos según la decisión D-e (12/10).

Operaciones (Operador y Supervisor) da de baja y reactiva conductores y
equipos; la baja de una empresa es de Certificación (y del Propietario).
Quitar del roster es editar. Un campo sin permiso invalida el cuerpo entero:
aceptar la parte permitida dejaría al cliente creyendo que guardó todo."""
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase
from app.authz import Permission, require_fields
from app.authz.permissions import PERMISSION_META, SYSTEM_ROLES
from app.db import get_pool
from app.routers import assets as assets_router
from app.routers import carriers as carriers_router
from app.routers import drivers as drivers_router
from app.schemas.asset import ASSET_FIELD_PERMISSIONS, AssetPatchBody
from app.schemas.carrier import CARRIER_FIELD_PERMISSIONS, CarrierPatchBody
from app.schemas.driver import DRIVER_FIELD_PERMISSIONS, DriverPatchBody
from tests.conftest import usuario, wire_transactional_conn

OPERADOR = usuario("operations_operator", aal="aal1")
SUP_OPS = usuario("operations_supervisor", aal="aal1")
SUP_CERT = usuario("certification_supervisor", aal="aal1")
LECTURA = usuario("reader", aal="aal1")
ADMIN_SOLO = usuario("admin", aal="aal2")

FILA_CONDUCTOR = {
    "id": "d1", "tax_id": "1-9", "country_code": "CL", "full_name": "Juan",
    "operational_status": "INACTIVE", "is_manual_override": True, "created_at": None,
    "total_requirements": 1, "last_document_update": None,
    "home_location_id": "cd-1", "home_location_name": "CD", "home_location_shipper": None,
    "carrier_id": "c1", "carrier_name": "Acme",
}
FILA_EQUIPO = {
    "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION", "operational_status": "INACTIVE",
    "manufacture_year": None, "is_manual_override": True, "created_at": None,
    "total_requirements": 1, "last_document_update": None,
}


def cliente(user, pool):
    """No se sobrescribe el guardia: el test ejercita require() de verdad."""
    app = FastAPI()
    for r in (drivers_router.router, assets_router.router, carriers_router.router):
        app.include_router(r, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def pool_de_conductor():
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"full_name": "Juan", "operational_status": "ACTIVE", "home_location_id": "cd-1"}
    pool.fetchrow.return_value = FILA_CONDUCTOR   # tiene origen: get_driver no pide sugerencia
    return pool, conn


def pool_de_equipo():
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "asset_type": "TRACTOCAMION", "operational_status": "ACTIVE", "manufacture_year": None,
        "fleet_service_type_id": None, "webcarga_operation_type_id": None}
    pool.fetchrow.return_value = FILA_EQUIPO
    return pool, conn


# ── El catálogo ──────────────────────────────────────────────────────────────

def test_fleet_status_lo_tienen_operaciones_y_el_supervisor_de_certificacion():
    por = {r.code: r.permissions for r in SYSTEM_ROLES}
    fs = Permission.DIRECTORY_FLEET_STATUS
    assert {c for c, perms in por.items() if fs in perms} == {
        "operations_operator", "operations_supervisor", "certification_supervisor"}
    # Spec §8: Administración no cambia.
    assert fs not in por["admin"]


def test_la_descripcion_de_directory_delete_dice_lo_que_cubre():
    texto = PERMISSION_META[Permission.DIRECTORY_DELETE].description
    assert "empresas" in texto and "conductores" not in texto


def test_todo_campo_del_patch_tiene_permiso():
    assert set(DriverPatchBody.model_fields) == set(DRIVER_FIELD_PERMISSIONS)
    assert set(AssetPatchBody.model_fields) == set(ASSET_FIELD_PERMISSIONS)
    assert set(CarrierPatchBody.model_fields) == set(CARRIER_FIELD_PERMISSIONS)


def test_el_estado_de_la_empresa_exige_directory_delete():
    with pytest.raises(HTTPException) as err:
        require_fields(SUP_OPS, ["operational_status"], CARRIER_FIELD_PERMISSIONS)
    assert err.value.status_code == 403
    require_fields(SUP_CERT, ["operational_status", "business_name"], CARRIER_FIELD_PERMISSIONS)


# ── Conductores y equipos ────────────────────────────────────────────────────

def test_el_operador_da_de_baja_a_un_conductor():
    pool, conn = pool_de_conductor()
    res = cliente(OPERADOR, pool).patch("/api/v1/drivers/d1", json={"operational_status": "INACTIVE"})
    assert res.status_code == 200
    assert conn.execute.called


def test_el_operador_no_renombra():
    pool, conn = pool_de_conductor()
    res = cliente(OPERADOR, pool).patch("/api/v1/drivers/d1", json={"full_name": "Otro"})
    assert res.status_code == 403
    assert not conn.execute.called


def test_un_cuerpo_mixto_del_operador_se_rechaza_entero_y_no_escribe():
    """Review Focus 1."""
    pool, conn = pool_de_conductor()
    res = cliente(OPERADOR, pool).patch(
        "/api/v1/drivers/d1", json={"operational_status": "INACTIVE", "full_name": "Otro"})
    assert res.status_code == 403 and "full_name" in res.json()["detail"]
    assert not conn.execute.called


def test_lectura_no_da_de_baja():
    pool, conn = pool_de_conductor()
    res = cliente(LECTURA, pool).patch("/api/v1/drivers/d1", json={"operational_status": "INACTIVE"})
    assert res.status_code == 403


def test_el_operador_da_de_baja_un_equipo_y_no_edita_el_resto():
    pool, _ = pool_de_equipo()
    assert cliente(OPERADOR, pool).patch("/api/v1/assets/a1", json={"operational_status": "INACTIVE"}).status_code == 200
    pool, conn = pool_de_equipo()
    assert cliente(OPERADOR, pool).patch("/api/v1/assets/a1", json={"manufacture_year": 2019}).status_code == 403
    assert not conn.execute.called


# ── Empresas ─────────────────────────────────────────────────────────────────

def test_el_supervisor_de_operaciones_no_da_de_baja_una_empresa():
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    res = cliente(SUP_OPS, pool).patch("/api/v1/carriers/c1", json={"operational_status": "INACTIVE"})
    assert res.status_code == 403
    assert not conn.execute.called


def test_el_supervisor_de_certificacion_da_de_baja_una_empresa(monkeypatch):
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"updated_at": None, "business_name": "Acme", "operational_status": "ACTIVE",
                                  "tax_id": "1-9", "management_types": None}
    monkeypatch.setattr(carriers_router, "_assemble_carrier_detail", AsyncMock(return_value={"id": "c1"}))
    res = cliente(SUP_CERT, pool).patch("/api/v1/carriers/c1", json={"operational_status": "INACTIVE"})
    assert res.status_code == 200


# ── Quitar del roster y conductor habitual ───────────────────────────────────

@pytest.mark.parametrize("ruta", [
    "/api/v1/carriers/c1/drivers/d1", "/api/v1/carriers/c1/assets/a1", "/api/v1/assets/a1/driver-assignment"])
def test_quitar_es_editar(ruta):
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "UPDATE 1"
    assert cliente(SUP_OPS, pool).delete(ruta).status_code == 200
    assert cliente(OPERADOR, pool).delete(ruta).status_code == 403
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_directory_permissions.py -q`
Expected: FAIL en la colección con `ImportError: cannot import name 'ASSET_FIELD_PERMISSIONS'` (los mapas no existen). Es el RED correcto de este archivo: todo el contrato es nuevo. Después del Step 3 (solo el catálogo), volver a correr: deben fallar `test_el_operador_da_de_baja_a_un_conductor` (403), `test_el_supervisor_de_operaciones_no_da_de_baja_una_empresa` (200) y `test_quitar_es_editar` (403 para `SUP_OPS`).

- [ ] **Step 3: Catalog**

En `permissions.py`:

```python
    DIRECTORY_DELETE = "directory.delete"
    DIRECTORY_FLEET_STATUS = "directory.fleet_status"
```

```python
    P.DIRECTORY_DELETE: PermissionMeta("directory", "Dar de baja y reactivar empresas, y eliminar empresas y contactos"),
    P.DIRECTORY_FLEET_STATUS: PermissionMeta("directory", "Dar de baja y reactivar conductores y equipos"),
```

```python
_OPS_OPERADOR = (P.TRIPS_EDIT_BASIC, P.TRIPS_VOID, P.CLOSURES_DECLARE, P.CLOSURES_SIGN, P.DIRECTORY_FLEET_STATUS)
```

```python
    _rol("certification_supervisor", "Supervisor de Certificación",
         "Operador + aprobación de documentos, requisitos y directorio.",
         *_CERT_OPERADOR, P.DOCUMENTS_REVIEW, P.CERTIFICATION_CONFIGURE, P.DIRECTORY_EDIT, P.DIRECTORY_DELETE,
         P.DIRECTORY_FLEET_STATUS),
```

El Supervisor de Operaciones lo recibe por `*_OPS_OPERADOR` (`test_el_supervisor_incluye_al_operador`).

- [ ] **Step 4: Field maps (mismo patrón que `TRIP_FIELD_PERMISSIONS`, `schemas/trip.py:53`)**

`schemas/driver.py`, debajo de `DriverPatchBody`:

```python
from ..authz.permissions import Permission  # arriba, con los demás imports

# Permiso por campo del PATCH (bloque 0 del Directorio, 0.3; patrón de
# TRIP_FIELD_PERMISSIONS). Dar de baja o reactivar es de Operaciones; el resto
# de la ficha, de los supervisores. Un campo nuevo sin entrada acá hace fallar
# test_directory_permissions.test_todo_campo_del_patch_tiene_permiso.
DRIVER_FIELD_PERMISSIONS: dict[str, Permission] = {
    "full_name": Permission.DIRECTORY_EDIT,
    "home_location_id": Permission.DIRECTORY_EDIT,
    "operational_status": Permission.DIRECTORY_FLEET_STATUS,
}
```

`schemas/asset.py`, debajo de `AssetPatchBody`:

```python
ASSET_FIELD_PERMISSIONS: dict[str, Permission] = {
    "asset_type": Permission.DIRECTORY_EDIT,
    "manufacture_year": Permission.DIRECTORY_EDIT,
    "fleet_service_type_id": Permission.DIRECTORY_EDIT,
    "webcarga_operation_type_id": Permission.DIRECTORY_EDIT,
    "operational_status": Permission.DIRECTORY_FLEET_STATUS,
}
```

`schemas/carrier.py`, debajo de `CarrierPatchBody`:

```python
# La baja de una empresa es de Certificación (D-e, 12/10): directory.delete.
CARRIER_FIELD_PERMISSIONS: dict[str, Permission] = {
    "business_name": Permission.DIRECTORY_EDIT,
    "tax_id": Permission.DIRECTORY_EDIT,
    "management_types": Permission.DIRECTORY_EDIT,
    "expected_updated_at": Permission.DIRECTORY_EDIT,
    "operational_status": Permission.DIRECTORY_DELETE,
}
```

(en `asset.py` y `carrier.py`, el mismo `from ..authz.permissions import Permission`; `schemas/trip.py:4` ya lo hace sin ciclo).

- [ ] **Step 5: Routes**

`drivers.py` (importar `require_fields` desde `..authz` y `DRIVER_FIELD_PERMISSIONS` desde `..schemas.driver`):

```python
@router.patch("/{driver_id}")
async def patch_driver(
    # El permiso real lo decide el mapa por campo (R8 del plan del bloque 0):
    # el Operador da de baja sin poder editar el resto, y la ruta no puede
    # exigir directory.edit. Mismo patrón que PATCH /trips/{id}.
    driver_id: str, body: DriverPatchBody, pool=Depends(get_pool), user=Depends(require(Permission.DIRECTORY_READ)),
):
    require_fields(user, body.model_dump(exclude_none=True), DRIVER_FIELD_PERMISSIONS)
    async with pool.acquire() as conn:
        ...  # sin cambios
```

`assets.py`, igual con `ASSET_FIELD_PERMISSIONS`; y en `unassign_driver_from_asset` (`:223`) `require(Permission.DIRECTORY_EDIT)`.

`carriers.py`: `patch_carrier` conserva `require(Permission.DIRECTORY_EDIT)` y su primera línea es `require_fields(user, body.model_dump(exclude_none=True), CARRIER_FIELD_PERMISSIONS)`; `unassign_driver` (`:814`) y `unassign_asset` (`:878`) pasan a `require(Permission.DIRECTORY_EDIT)` con este comentario:

```python
    # Quitar del roster termina una asignación: es editar, igual que asignar
    # (POST de arriba). Hasta el 12/10 exigía directory.delete y el botón se
    # mostraba con directory.edit: 403 a los Supervisores de Operaciones (F-33).
```

- [ ] **Step 6: Regenerate the frontend permissions file**

Run: `cd monitor-app/backend/api && venv/bin/python scripts/generar_permisos_ts.py`
Expected: `escrito …/frontend/lib/authz/permisos.generated.ts`, con la línea `'directory.fleet_status': { area: 'directory', privileged: false },`.

- [ ] **Step 7: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_directory_permissions.py tests/test_authz_catalogo.py tests/test_matriz_roles.py tests/test_toda_ruta_declara_permiso.py tests/test_permisos_ts_en_sincronia.py tests/test_permisos_por_campo.py tests/test_drivers.py tests/test_assets.py tests/test_carriers.py tests/test_authz_sync_integracion.py -q`
Expected: PASS. `test_authz_sync_integracion` confirma que `sync_catalog` lleva el permiso nuevo a `app.role_permissions` dentro de la transacción revertida.

- [ ] **Step 8: Verificar que la mutación mata el test**

(a) Quitar `require_fields(...)` de `patch_driver`: `test_el_operador_no_renombra` y el de cuerpo mixto tienen que fallar. (b) Volver `unassign_driver` a `DIRECTORY_DELETE`: `test_quitar_es_editar[…/drivers/d1]` tiene que fallar. Restaurar los dos.

- [ ] **Step 9: Commit**

```bash
git add monitor-app/backend/api/app/authz/permissions.py monitor-app/backend/api/app/schemas \
  monitor-app/backend/api/app/routers/drivers.py monitor-app/backend/api/app/routers/assets.py \
  monitor-app/backend/api/app/routers/carriers.py monitor-app/backend/api/tests/test_directory_permissions.py \
  monitor-app/frontend/lib/authz/permisos.generated.ts
git commit -m "feat(rbac): directory.fleet_status para dar de baja conductores y equipos

Operaciones (Operador y Supervisor) y el Supervisor de Certificación dan de
baja y reactivan conductores y equipos; la baja de una empresa queda en
directory.delete; quitar del roster pasa a directory.edit. Permiso por campo
en los PATCH (D-e, bloque 0 del Directorio, 0.3).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Cada botón con el permiso de su endpoint (0.3, frontend)

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx:21-41`, `:296-313`, `:365-373`
- Modify: `monitor-app/frontend/components/dashboard/VehicleDetailPanel.tsx:20-54`, `:392-409`
- Modify: `monitor-app/frontend/components/dashboard/ContactCard.tsx:23-27`, `:85-88`
- Modify: `monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx:151-152`, `:452-471`, `:582-590`, `:790`, `:840-873`
- Modify: `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.tsx:821-850`
- Modify: `monitor-app/frontend/components/dashboard/sections/PreCierrePendingSection.tsx`
- Test: `DriverDetailPanel.test.tsx`, `VehicleDetailPanel.test.tsx`, `app/dashboard/carriers/[id]/page.test.tsx`, `app/dashboard/compliance/[carrierId]/page.test.tsx`, `components/dashboard/sections/PreCierrePendingSection.test.tsx`

**Interfaces:**
- Consumes: `'directory.fleet_status'` en `PermissionCode` (Task 6).
- Produces: `DriverDetailPanel`/`VehicleDetailPanel` reciben `canChangeFleetStatus: boolean` en lugar de `canAdmin`; `DriverDetailPanel` recibe además `canDeleteContacts: boolean`; `ContactCard` recibe `canDelete: boolean`.

- [ ] **Step 1: Write the failing tests**

En `DriverDetailPanel.test.tsx`, cambiar el helper `renderPanel` (`:49-65`): la opción `canAdmin` pasa a `canChangeFleetStatus` y se agrega `canDeleteContacts`:

```tsx
function renderPanel(driver: Driver | null, opts: {
  canEdit?: boolean; canChangeFleetStatus?: boolean; canDeleteContacts?: boolean
  canUploadDocuments?: boolean; canReviewDocuments?: boolean
  onPatch?: (...args: unknown[]) => Promise<void>
  onRemove?: () => Promise<void>
} = {}) {
  return renderWithClient(
    <DriverDetailPanel
      driver={driver}
      carrierId="c1"
      canEdit={opts.canEdit ?? true}
      canChangeFleetStatus={opts.canChangeFleetStatus ?? true}
      canDeleteContacts={opts.canDeleteContacts ?? true}
      canUploadDocuments={opts.canUploadDocuments ?? true}
      canReviewDocuments={opts.canReviewDocuments ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
    />,
  )
}
```

(y en los tests existentes del archivo, cambiar `canAdmin:` por `canChangeFleetStatus:`). Agregar:

```tsx
  it('el Operador ve la baja del conductor y nada que la API le rechace (Review Focus 5)', async () => {
    renderPanel(DRIVER, { canEdit: false, canChangeFleetStatus: true, canDeleteContacts: false })
    expect(screen.getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar del roster/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('sin directory.delete no ofrece eliminar un contacto', async () => {
    vi.mocked(driversApi.listContacts).mockResolvedValue(CONTACTS)
    renderPanel(DRIVER, { canEdit: true, canDeleteContacts: false })
    await screen.findByText('juan@example.com')
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })
```

En `VehicleDetailPanel.test.tsx`, el mismo cambio de `canAdmin` a `canChangeFleetStatus` en el helper (`:52,64`) y en los tests que lo pasan (`:138,170-171,239`).

En `app/dashboard/carriers/[id]/page.test.tsx`, reemplazar el mock de permisos (`:31-35`) por uno que permite negar cualquier permiso:

```tsx
// Por defecto lo tiene todo; cada test niega lo que necesita.
const permisos = vi.hoisted(() => ({ darDeBaja: true, negados: new Set<string>() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => (p === 'directory.delete' ? permisos.darDeBaja : !permisos.negados.has(p)),
}))
```

con `permisos.negados = new Set()` en el `beforeEach`, y agregar:

```tsx
  it('sin directory.delete dice quién da de baja la empresa', async () => {
    permisos.darDeBaja = false
    renderPage()
    expect(await screen.findByText('La baja de una empresa la hace Certificación.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Dar de baja$/ })).not.toBeInTheDocument()
  })

  it('el Operador (sin directory.edit) da de baja a un conductor desde su panel', async () => {
    permisos.darDeBaja = false
    permisos.negados = new Set(['directory.edit', 'policies.edit', 'policies.delete'])
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
      home_location_id: null, home_location_name: null, home_location_shipper: null, suggested_home_location: null,
    })
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    expect(await screen.findByRole('button', { name: 'Dar de baja' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar del roster/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Conductor' })).not.toBeInTheDocument()
  })

  it('"+ Póliza" se muestra con policies.edit, no con directory.edit', async () => {
    permisos.negados = new Set(['policies.edit'])
    renderPage()
    await clickTab(/Seguros/)
    expect(screen.queryByRole('button', { name: '+ Póliza' })).not.toBeInTheDocument()
  })
```

En `app/dashboard/compliance/[carrierId]/page.test.tsx` (mock en `:28-35`, `permisos.admin`), agregar un test igual al primero: con `permisos.admin = false`, espera el texto `La baja de una empresa la hace Certificación.` (copiar la forma de montar la página del test vecino que ya usa `permisos.admin`).

En `components/dashboard/sections/PreCierrePendingSection.test.tsx`, el componente pasa a leer permisos: agregar arriba, junto a los otros `vi.mock`:

```tsx
const permisos = vi.hoisted(() => ({ negados: new Set<string>() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: (p: string) => !permisos.negados.has(p) }))
```

con `permisos.negados = new Set()` en el `beforeEach`, y agregar (usando el `DailyClosureStatus` de prueba del archivo, con una escalación `EMPRESA_ONBOARDING` y una `PATENTE_NO_REGISTRADA`; copiar la forma de los tests existentes que ya las arman):

```tsx
  it('sin directory.edit el pre-cierre no ofrece lo que la API rechazaría (Review Focus 5)', async () => {
    permisos.negados = new Set(['directory.edit', 'directory.delete'])
    // … montar con una escalación EMPRESA_ONBOARDING y una PATENTE_NO_REGISTRADA
    expect(await screen.findByText('La activación de una empresa la hace Certificación.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activar empresa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear empresa nueva' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Lo resuelve un supervisor desde el Directorio.').length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/DriverDetailPanel.test.tsx components/dashboard/VehicleDetailPanel.test.tsx "app/dashboard/carriers/[id]/page.test.tsx" "app/dashboard/compliance/[carrierId]/page.test.tsx" components/dashboard/sections/PreCierrePendingSection.test.tsx`
Expected: FAIL. `tsc` en el editor marcará `canChangeFleetStatus` como prop desconocida; en vitest, los tests nuevos fallan por los textos que no existen y porque "Dar de baja" no aparece con `canAdmin` ausente.

- [ ] **Step 3: Implement the panels and `ContactCard`**

`ContactCard.tsx`: la firma recibe `canDelete: boolean` y el botón "Eliminar" (`:88`) se dibuja con `{canDelete && (<button …>Eliminar</button>)}`, dentro del mismo bloque `canEdit` de hoy.

`DriverDetailPanel.tsx`:
- en `Props`, reemplazar `canAdmin: boolean` por:

```ts
  /** Dar de baja y reactivar (`directory.fleet_status`): Operaciones lo tiene
   *  aunque no edite la ficha (D-e, 12/10). */
  canChangeFleetStatus: boolean
  /** Eliminar un contacto (`directory.delete`). */
  canDeleteContacts: boolean
```

- en la desestructuración, `canChangeFleetStatus, canDeleteContacts` en lugar de `canAdmin`;
- `{canAdmin && (` (`:296`) pasa a `{canChangeFleetStatus && (`;
- en `<ContactCard … canEdit={canEdit}`, agregar `canDelete={canDeleteContacts}`.

`VehicleDetailPanel.tsx`: igual con `canChangeFleetStatus` (`:28`, `:54`, `:392`).

- [ ] **Step 4: Implement the carrier page (Directorio)**

En `carriers/[id]/page.tsx`, junto a `canEdit`/`canAdmin` (`:151-152`):

```tsx
  // Cada botón con el permiso de SU endpoint (bloque 0, 0.3): ninguno responde 403.
  const canChangeFleetStatus = usePermiso('directory.fleet_status')
  const canEditPolicies = usePermiso('policies.edit')
  const canDeletePolicies = usePermiso('policies.delete')
```

- Debajo de los dos botones de la cabecera (`:452-471`), para quien no tiene `directory.delete`:

```tsx
              {!canAdmin && (
                <p className="text-etiqueta text-informativo">La baja de una empresa la hace Certificación.</p>
              )}
```

- `<ContactCard … canEdit={canEdit}` (`:582-587`): agregar `canDelete={canAdmin}`.
- `{canEdit && (` de "+ Póliza" (`:790`) pasa a `{canEditPolicies && (`.
- `<DriverDetailPanel …>` (`:840-850`): `canChangeFleetStatus={canChangeFleetStatus}` y `canDeleteContacts={canAdmin}` en lugar de `canAdmin={canAdmin}`.
- `<VehicleDetailPanel …>` (`:853-864`): `canChangeFleetStatus={canChangeFleetStatus}` en lugar de `canAdmin={canAdmin}`.
- `<InsurancePolicyModal …>` (`:866-873`): `canAdmin={canDeletePolicies}` y `canEdit={canEditPolicies}`.

- [ ] **Step 5: Implement the Certificación ficha**

En `compliance/[carrierId]/page.tsx`, después del bloque `{canAdmin && (…)}` del botón de la empresa (`:826-850`):

```tsx
        {!canAdmin && (
          <p className="text-etiqueta text-informativo">La baja de una empresa la hace Certificación.</p>
        )}
```

- [ ] **Step 6: Implement the pre-cierre gating**

En `PreCierrePendingSection.tsx`:

```tsx
import { usePermiso } from '@/lib/authz/PermisosProvider'
```

```tsx
  // Cada acción con el permiso de su endpoint (bloque 0, 0.3; R5 del plan):
  // crear, vincular y dar de alta piden directory.edit; activar una empresa es un
  // cambio de su estado y pide directory.delete.
  const puedeEditarDirectorio = usePermiso('directory.edit')
  const puedeCambiarEstadoDeEmpresa = usePermiso('directory.delete')
  const sinPermiso = (
    <p className="text-etiqueta text-informativo">Lo resuelve un supervisor desde el Directorio.</p>
  )
```

- `CONDUCTOR_SIN_EMPRESA`: `puedeEditarDirectorio ? <VincularConductorPropuesto … /> : <div key={esc.driver_id}>{sinPermiso}</div>`.
- `PATENTE_NO_REGISTRADA`: el bloque `creatingFor === … ? <NewCarrierPanel/> : <button>Crear empresa nueva</button>` solo con `puedeEditarDirectorio`; si no, `sinPermiso`.
- `EMPRESA_ONBOARDING`: el bloque de error con RUT y el botón "Activar empresa" solo con `puedeCambiarEstadoDeEmpresa`; si no:

```tsx
                <p className="text-etiqueta text-informativo">La activación de una empresa la hace Certificación.</p>
```

- `CONDUCTOR_NO_REGISTRADO`: `{!esc.reason && (puedeEditarDirectorio ? <AltaConductorDesdeCierre … /> : sinPermiso)}`.

- [ ] **Step 7: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard "app/dashboard/carriers" "app/dashboard/compliance" components/dashboard/sections lib/ui lib/copy && npx tsc --noEmit`
Expected: PASS, trinquetes sin subir.

- [ ] **Step 8: Verificar que la mutación mata el test**

Volver `{canChangeFleetStatus && (` a `{canEdit && (` en `DriverDetailPanel`: `el Operador ve la baja del conductor…` tiene que fallar. Restaurar.

- [ ] **Step 9: Commit**

```bash
git add monitor-app/frontend/components/dashboard monitor-app/frontend/app/dashboard/carriers \
  monitor-app/frontend/app/dashboard/compliance
git commit -m "feat(directorio): cada botón con el permiso de su endpoint

Operaciones ve dar de baja y reactivar conductores y equipos; quitar,
guardar, pólizas, eliminar contacto y las acciones del pre-cierre se muestran
solo con el permiso que exige la API. Quien no da de baja empresas lee
\"La baja de una empresa la hace Certificación\" (bloque 0, 0.3).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Una fábrica de claves y una invalidación (0.5)

**Files:**
- Create: `monitor-app/frontend/lib/queries/directorio.ts`
- Create: `monitor-app/frontend/lib/queries/directorio.test.ts`
- Modify: `monitor-app/frontend/lib/types.ts` (`DirectoryEntity`)
- Modify (sitios de mutación, enumerados de lente C §3.3 y verificados con `grep` el 12/10):
  - `app/dashboard/carriers/[id]/page.tsx:192-205` (claves), `:220-314` (todas las mutaciones), `:645-652`, `:742-750` (`AltaDeFlota.onCreado`)
  - `components/dashboard/VehicleDetailPanel.tsx:84` (clave), `:183-184`, `:197-198`
  - `components/dashboard/DriverDetailPanel.tsx:115-126` (contactos)
  - `app/dashboard/compliance/[carrierId]/page.tsx:514-518`, `:538-547`, `:579`, `:812-816`, `:1004-1012`, `:1066-1071`
  - `app/dashboard/compliance/page.tsx:131-143`, `:316-322`
  - `app/dashboard/compliance/inbox/page.tsx:19` (clave)
  - `app/dashboard/carriers/page.tsx:107-110` (alta), `:119`, `:137` (claves)
  - `hooks/useTransporters.ts:13`, `components/dashboard/TransporterSlideOver.tsx:42`, `components/compliance/DirectorioResumen.tsx:26` (claves)
  - `components/dashboard/sections/PreCierrePendingSection.tsx:39-70`, `:143`, `:163-168`, `:282`
  - `components/dashboard/sections/AltaConductorDesdeCierre.tsx:17`, `:60` (`onListo` con la empresa)
  - `app/dashboard/operations/monitor/page.tsx:743-756`

**Interfaces:**
- Produces:

```ts
// lib/types.ts
export type DirectoryEntity = 'carrier' | 'driver' | 'asset'

// lib/queries/directorio.ts
export const directoryKeys: {
  carrierList(params: unknown): readonly ['carriers', unknown]
  carrierCount(status: string, q: string): readonly ['carriers-count', string, string]
  search(q: string): readonly ['directorio-buscar', string]
  summary(): readonly ['carriers-directorio']
  carrierDetail(id: string | null | undefined): readonly ['carrier-detail', string | null | undefined]
  carrierDrivers(id: string): readonly ['carrier-drivers', string]
  carrierAssets(id: string): readonly ['carrier-assets-roster', string]
  driverDetail(id: string | null | undefined): readonly ['driver-detail', string | null | undefined]
  assetDetail(id: string | null | undefined): readonly ['asset-detail', string | null | undefined]
  assetDriverAssignment(id: string | null | undefined): readonly ['asset-driver-assignment', string | null | undefined]
}
export type DirectoryChange = {
  entity: DirectoryEntity
  type: 'create' | 'update' | 'assignment' | 'contact' | 'delete'
  id?: string | null
  carrierIds?: ReadonlyArray<string | null | undefined>
}
export const CLOSURE_ROOTS: readonly QueryKey[]
export const CLOSURE_NOTICE: string   // 'El Cierre se actualizará en alrededor de un minuto.'
export function invalidateDirectory(qc: QueryClient, change: DirectoryChange): Promise<{ affectsClosure: boolean }>
```

- [ ] **Step 1: Write the failing test**

No hay un test de invalidación entre módulos en el repo (C-18). Patrones copiados: el espía de `invalidateQueries` de `hooks/useSubirDocumento.test.tsx:37-45` y el recorrido del código fuente de `lib/ui/sistema.test.ts:14-32`. Crear `lib/queries/directorio.test.ts`:

```ts
// @vitest-environment node
/**
 * Lo que deja obsoleto un cambio del Directorio (bloque 0, 0.5).
 *
 * La lista de claves ya se perdió más de una vez sin que nada fallara (el
 * docstring de lib/queries/certificacion.ts cuenta dos). Una clave que nadie
 * invalida no rompe nada: deja una pantalla vieja que solo se nota mirándola.
 * Por eso estos tests miran el CÓDIGO FUENTE: una pantalla nueva que lee una
 * raíz sin clasificar, o una mutación nueva que no pasa por invalidateDirectory,
 * los hace fallar.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { CLOSURE_ROOTS, invalidateDirectory, type DirectoryChange } from './directorio'

const RAIZ = join(__dirname, '..', '..')

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
      acc.push(ruta)
    }
  }
  return acc
}
const fuentes = () => ['app', 'components', 'hooks', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))

async function invalidadas(change: DirectoryChange) {
  const qc = new QueryClient()
  const espia = vi.spyOn(qc, 'invalidateQueries')
  await invalidateDirectory(qc, change)
  return espia.mock.calls.map(([f]) => ({
    key: JSON.stringify(f?.queryKey), refetchType: f?.refetchType,
  }))
}
const claves = async (change: DirectoryChange) => (await invalidadas(change)).map(c => c.key)

describe('invalidateDirectory', () => {
  it('una transferencia invalida el roster de origen y el de destino (Review Focus 2)', async () => {
    const k = await claves({ entity: 'driver', id: 'd1', type: 'assignment', carrierIds: ['origen', 'destino'] })
    expect(k).toContain(JSON.stringify(['carrier-drivers', 'origen']))
    expect(k).toContain(JSON.stringify(['carrier-drivers', 'destino']))
    expect(k).toContain(JSON.stringify(['carrier-detail', 'destino']))
    expect(k).toContain(JSON.stringify(['driver-detail', 'd1']))
  })

  it('un equipo invalida el roster de equipos, no el de conductores', async () => {
    const k = await claves({ entity: 'asset', id: 'a1', type: 'update', carrierIds: ['c1'] })
    expect(k).toContain(JSON.stringify(['carrier-assets-roster', 'c1']))
    expect(k).toContain(JSON.stringify(['asset-driver-assignment', 'a1']))
    expect(k).not.toContain(JSON.stringify(['carrier-drivers', 'c1']))
  })

  it('alcanza Certificación, el Monitor, la vista rápida y las cifras del Directorio', async () => {
    const k = await claves({ entity: 'carrier', id: 'c1', type: 'update' })
    for (const raiz of [['carriers'], ['carriers-count'], ['carriers-directorio'], ['directorio-buscar'],
      ['certification-status'], ['entity-summary'], ['available-drivers'], ['available-assets']]) {
      expect(k).toContain(JSON.stringify(raiz))
    }
  })

  it('el Cierre se marca viejo sin releer: el servidor recalcula en un minuto', async () => {
    const llamadas = await invalidadas({ entity: 'driver', id: 'd1', type: 'update', carrierIds: ['c1'] })
    for (const raiz of CLOSURE_ROOTS) {
      expect(llamadas).toContainEqual({ key: JSON.stringify(raiz), refetchType: 'none' })
    }
  })

  it('un contacto no toca el Cierre ni el Monitor', async () => {
    const r = await invalidateDirectory(new QueryClient(), { entity: 'carrier', id: 'c1', type: 'contact' })
    const k = await claves({ entity: 'carrier', id: 'c1', type: 'contact' })
    expect(r.affectsClosure).toBe(false)
    expect(k).not.toContain(JSON.stringify(['daily-closure']))
    expect(k).not.toContain(JSON.stringify(['available-drivers']))
  })
})

// Raíces que leen las pantallas y que NINGÚN cambio de empresa, conductor o
// equipo deja obsoletas. Una raíz nueva que no está aquí ni la toca
// invalidateDirectory hace fallar el test de abajo: hay que decidir.
const NO_DEPENDEN_DEL_DIRECTORIO = new Set([
  'trips', 'trip', 'trip-notes', 'trips-meta', 'trips-activos',      // el viaje, no el maestro
  'taxonomias', 'taxonomies', 'tms-statuses', 'origenes', 'shippers',  // catálogos
  'locations-picker', 'coverage-types',
  'compliance-requirements', 'recalc-preview', 'vigencia-preview',     // configuración
  'planilla-vencimientos', 'config-inventario', 'config-busqueda', 'solicitables',
  'compliance-record-file', 'driver-compliance-records', 'asset-compliance-records', // documentos de una ficha abierta
  'compliance-pending-drawer',                                         // invalidada en CondicionPanel, ninguna consulta la lee
  'driver-contacts',                                                   // la invalida su propio panel
  'carrier-policies', 'policy-detail',                                 // Seguros: no cambia con el maestro
  'carrier-shippers',                                                  // solo la escribe el pre-cierre (P10, D3)
  'tarifario-all', 'tarifario-pending',                                // Comercial
  'closure-signatures', 'daily-closures-report',                       // la firma es inmutable; el reporte se pide al abrir
])

describe('cobertura', () => {
  it('toda raíz que lee una pantalla está clasificada', async () => {
    const tocadas = new Set<string>()
    for (const change of [
      { entity: 'carrier', id: 'x', type: 'update', carrierIds: ['x'] },
      { entity: 'driver', id: 'x', type: 'update', carrierIds: ['x'] },
      { entity: 'asset', id: 'x', type: 'update', carrierIds: ['x'] },
    ] as DirectoryChange[]) {
      for (const k of await claves(change)) tocadas.add(JSON.parse(k)[0])
    }
    const sinClasificar = new Set<string>()
    for (const ruta of fuentes()) {
      if (ruta.includes(join('lib', 'queries'))) continue
      for (const m of readFileSync(ruta, 'utf8').matchAll(/queryKey:\s*\[\s*'([^']+)'/g)) {
        if (!tocadas.has(m[1]) && !NO_DEPENDEN_DEL_DIRECTORIO.has(m[1])) sinClasificar.add(`${m[1]} (${relative(RAIZ, ruta)})`)
      }
    }
    expect([...sinClasificar]).toEqual([])
  })

  // Escriben y avisan por un callback; quien los monta llama a invalidateDirectory (R12).
  const DELEGAN: Record<string, string> = {
    'components/dashboard/NewCarrierPanel.tsx': 'onCreated',
    'components/dashboard/AltaDeFlota.tsx': 'onCreado',
    'components/compliance/GestionDeclarada.tsx': 'onGuardado',
    'components/dashboard/sections/VincularConductorPropuesto.tsx': 'onVinculado',
    'components/dashboard/sections/AltaConductorDesdeCierre.tsx': 'onListo',
  }
  const MUTACION = /(carriersApi\.(patch|create|delete|assignDriver|assignAsset|unassignDriver|unassignAsset|createContact)|driversApi\.(create|patch|createContact)|assetsApi\.(create|patch|assignDriver|unassignDriver)|contactsApi\.(patch|delete))\(/

  it('toda mutación del Directorio pasa por invalidateDirectory', () => {
    const faltan: string[] = []
    for (const ruta of fuentes()) {
      const rel = relative(RAIZ, ruta)
      if (rel.startsWith(join('lib', 'api'))) continue
      const texto = readFileSync(ruta, 'utf8')
      if (!MUTACION.test(texto)) continue
      const delegado = DELEGAN[rel.split('\\').join('/')]
      if (delegado ? !texto.includes(delegado) : !texto.includes('invalidateDirectory(')) faltan.push(rel)
    }
    expect(faltan).toEqual([])
  })
})
```

Si el test de cobertura lista una raíz que este plan no previó, se clasifica con su motivo (en `NO_DEPENDEN_DEL_DIRECTORIO` o en `invalidateDirectory`) y se reporta. **Nunca** se vacía la aserción.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd monitor-app/frontend && npx vitest run lib/queries/directorio.test.ts`
Expected: FAIL con `Failed to resolve import "./directorio"`. Después del Step 3 (solo el módulo), los cinco tests de `invalidateDirectory` pasan y `toda mutación del Directorio pasa por invalidateDirectory` sigue fallando: lista los archivos de mutación que todavía no la llaman (la ficha del Directorio, la de Certificación, `compliance/page.tsx`, `carriers/page.tsx` no, porque no muta directo; `VehicleDetailPanel`, `DriverDetailPanel`, `PreCierrePendingSection`, el Monitor). Ese es el RED que guía el Step 4. `toda raíz que lee una pantalla está clasificada` debería pasar ya; si lista alguna raíz, clasificarla con su motivo y reportarlo.

- [ ] **Step 3: Write `lib/queries/directorio.ts` and `DirectoryEntity`**

En `lib/types.ts`, junto a `OPERATIONAL_STATUS_LABELS` (`:958`):

```ts
/** Las tres entidades del Directorio. */
export type DirectoryEntity = 'carrier' | 'driver' | 'asset'
```

`lib/queries/directorio.ts`:

```ts
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { DirectoryEntity } from '@/lib/types'
import { invalidarCertificacion } from './certificacion'

/**
 * Las claves de caché del Directorio y lo que deja obsoleto un cambio en una
 * empresa, un conductor o un equipo (bloque 0 del Directorio, 0.5).
 *
 * Antes cada pantalla invalidaba su propia lista: ninguna mutación del
 * Directorio refrescaba Certificación, el Cierre, el Monitor ni la vista
 * rápida, la transferencia refrescaba solo la empresa de origen, y la misma
 * empresa tenía dos claves (F-13, F-17). Ahora todas las mutaciones —del
 * Directorio, Certificación, el Cierre y el Monitor— llaman a
 * `invalidateDirectory`, y `directorio.test.ts` falla si una pantalla nueva lee
 * una raíz sin clasificar o una mutación nueva no pasa por aquí.
 */
export const directoryKeys = {
  carrierList:     (params: unknown) => ['carriers', params] as const,
  carrierCount:    (status: string, q: string) => ['carriers-count', status, q] as const,
  search:          (q: string) => ['directorio-buscar', q] as const,
  summary:         () => ['carriers-directorio'] as const,
  /** La única clave de la ficha de una empresa (antes también `['carriers','detail',id]`). */
  carrierDetail:   (id: string | null | undefined) => ['carrier-detail', id] as const,
  carrierDrivers:  (id: string) => ['carrier-drivers', id] as const,
  carrierAssets:   (id: string) => ['carrier-assets-roster', id] as const,
  driverDetail:    (id: string | null | undefined) => ['driver-detail', id] as const,
  assetDetail:     (id: string | null | undefined) => ['asset-detail', id] as const,
  assetDriverAssignment: (id: string | null | undefined) => ['asset-driver-assignment', id] as const,
}

/** Qué cambió. `carrierIds` son las empresas cuyo roster cambió: la de la
 *  ficha y, en una transferencia, también la de destino. */
export type DirectoryChange = {
  entity: DirectoryEntity
  type: 'create' | 'update' | 'assignment' | 'contact' | 'delete'
  id?: string | null
  carrierIds?: ReadonlyArray<string | null | undefined>
}

/** Listas y cifras que dependen de cualquier entidad del Directorio. Seguros
 *  lista empresas por estado (R11). */
const DIRECTORY_ROOTS: QueryKey[] = [
  ['carriers'], ['carriers-count'], ['directorio-buscar'], ['carriers-directorio'],
  ['carriers-insurance-overview'], ['carriers-insurance-overview-count'],
]
/** Quién está disponible para un viaje, y la búsqueda de conductores. */
const MONITOR_ROOTS: QueryKey[] = [['available-drivers'], ['available-assets'], ['drivers'], ['driver-candidates']]
/** El Cierre: se recalcula en el servidor (cola, cada minuto). */
export const CLOSURE_ROOTS: QueryKey[] = [
  ['daily-closure'], ['equipment-closures'], ['cierre-viajes'], ['status-report'], ['fleet-driver-gap'],
]
export const CLOSURE_NOTICE = 'El Cierre se actualizará en alrededor de un minuto.'

function rosterKeys(entity: DirectoryEntity, carrierId: string): QueryKey[] {
  const drivers: QueryKey[] = [directoryKeys.carrierDrivers(carrierId)]
  const assets: QueryKey[] = [directoryKeys.carrierAssets(carrierId), ['carrier-assets', carrierId]]
  return [
    directoryKeys.carrierDetail(carrierId),
    ...(entity !== 'asset' ? drivers : []),
    ...(entity !== 'driver' ? assets : []),
  ]
}

function entityKeys(change: DirectoryChange): QueryKey[] {
  if (!change.id) return []
  if (change.entity === 'carrier') return rosterKeys('carrier', change.id)
  if (change.entity === 'driver') return [directoryKeys.driverDetail(change.id)]
  return [directoryKeys.assetDetail(change.id), directoryKeys.assetDriverAssignment(change.id)]
}

/**
 * Invalida solo lo afectado. Las raíces de Certificación incluyen la vista
 * rápida (`['entity-summary']`). El Cierre se marca viejo SIN releer
 * (`refetchType: 'none'`): el servidor lo recalcula en alrededor de un minuto y
 * una relectura inmediata leería la foto anterior; la pantalla del Cierre se
 * relee sola mientras el día tiene un recálculo pendiente (0.6). Devuelve si el
 * cambio llega al Cierre, para avisarlo.
 */
export async function invalidateDirectory(qc: QueryClient, change: DirectoryChange): Promise<{ affectsClosure: boolean }> {
  const keys: QueryKey[] = [...DIRECTORY_ROOTS, ...entityKeys(change)]
  for (const carrierId of change.carrierIds ?? []) {
    if (carrierId) keys.push(...rosterKeys(change.entity, carrierId))
  }
  // Un contacto no cambia quién opera ni dónde: no toca el Cierre ni el Monitor.
  const affectsClosure = change.type !== 'contact'
  if (affectsClosure) keys.push(...MONITOR_ROOTS)
  await Promise.all([
    ...keys.map(queryKey => qc.invalidateQueries({ queryKey })),
    invalidarCertificacion(qc),
    ...(affectsClosure ? CLOSURE_ROOTS.map(queryKey => qc.invalidateQueries({ queryKey, refetchType: 'none' })) : []),
  ])
  return { affectsClosure }
}
```

- [ ] **Step 4: Migrate the keys and every mutation site**

**Claves** (mismo valor, ahora desde la fábrica):
- `carriers/[id]/page.tsx:192,199,200,205,210`: `directoryKeys.carrierDetail(id)`, `.carrierDrivers(id)`, `.carrierAssets(id)`, `.driverDetail(selectedDriverId)`, `.assetDetail(selectedAssetId)`.
- `compliance/[carrierId]/page.tsx:579` y `compliance/inbox/page.tsx:19`: `directoryKeys.carrierDetail(…)`.
- `TransporterSlideOver.tsx:42`: `directoryKeys.carrierDetail(item?.id)` (unifica la clave; R11).
- `useTransporters.ts:13`: `directoryKeys.carrierList(params)`.
- `carriers/page.tsx:119`: `directoryKeys.search(qDebounced)`; `:137`: `directoryKeys.carrierCount(t.status, qDebounced)`.
- `DirectorioResumen.tsx:26`: `directoryKeys.summary()`.
- `VehicleDetailPanel.tsx:84`: `directoryKeys.assetDriverAssignment(asset?.id)`.

**Ficha del Directorio** (`carriers/[id]/page.tsx`). Borrar `invalidateCarrier`, `invalidateDrivers`, `invalidateAssets` (`:220-222`; `invalidatePolicies` se queda) y agregar:

```tsx
  /** Todo cambio pasa por acá: una sola lista de qué queda obsoleto. */
  async function afterChange(change: DirectoryChange) {
    await invalidateDirectory(queryClient, change)
  }
```

Cada handler, después de su llamada a la API (sin cambiar la llamada):

| Handler | Llamada nueva |
|---|---|
| `handleSaveBusinessName`, `handleChangeOperationalStatus`, `handleDeactivateCarrier`, `handleReactivateCarrier` | `await afterChange({ entity: 'carrier', id, type: 'update' })` |
| `handleDeleteCarrier` | `await afterChange({ entity: 'carrier', id, type: 'delete' })` antes del `router.push` |
| `handlePatchDriver` | `await afterChange({ entity: 'driver', id: driverId, type: 'update', carrierIds: [id] })` (reemplaza las dos invalidaciones) |
| `handleRemoveDriver` | `await afterChange({ entity: 'driver', id: driverId, type: 'assignment', carrierIds: [id] })` |
| `handlePatchAsset` | `await afterChange({ entity: 'asset', id: assetId, type: 'update', carrierIds: [id] })` |
| `handleRemoveAsset` | `await afterChange({ entity: 'asset', id: assetId, type: 'assignment', carrierIds: [id] })` |
| `handleConfirmTransfer` | `await afterChange({ entity: transferTarget.kind, id: transferTarget.id, type: 'assignment', carrierIds: [id, toCarrierId] })` (reemplaza `invalidateDrivers()`/`invalidateAssets()`) |
| `handleSaveContact`, `handleDeleteContact`, `handleAddContact` | `await afterChange({ entity: 'carrier', id, type: 'contact' })` |
| `AltaDeFlota` conductor (`:651`) | `onCreado={() => afterChange({ entity: 'driver', type: 'create', carrierIds: [id] })}` |
| `AltaDeFlota` equipo (`:749`) | `onCreado={() => afterChange({ entity: 'asset', type: 'create', carrierIds: [id] })}` |

**`VehicleDetailPanel.tsx`** (`:184`, `:198`): las dos `invalidateQueries({ queryKey: ['asset-driver-assignment', asset.id] })` pasan a:

```tsx
      await invalidateDirectory(queryClient, { entity: 'asset', id: asset.id, type: 'assignment', carrierIds: [carrierId] })
```

**`DriverDetailPanel.tsx`** (`:115-126`): `invalidateContacts()` queda, y además:

```tsx
  async function afterContactChange() {
    invalidateContacts()
    // El teléfono de la vista rápida sale del contacto principal.
    if (driver) await invalidateDirectory(queryClient, { entity: 'driver', id: driver.id, type: 'contact' })
  }
```

y los tres handlers de contactos llaman a `afterContactChange()` en lugar de `invalidateContacts()`.

**Ficha de Certificación** (`compliance/[carrierId]/page.tsx`):
- `ejecutarBaja` (`:517`): `await invalidateDirectory(queryClient, { entity: s.entity_type === 'ASSET' ? 'asset' : 'driver', id: s.entity_id, type: 'assignment', carrierIds: [carrierId] })` (reemplaza `invalidarCertificacion`; la incluye).
- `cambiarEstadoEmpresa` (`:546-547`): las dos líneas pasan a `await invalidateDirectory(queryClient, { entity: 'carrier', id: carrierId, type: 'update' })`.
- `GestionDeclarada.onGuardado` (`:813-816`): igual, `type: 'update'`.
- `AltaDeFlota` (`:1006`, `:1012`): `onCreado={async () => { await invalidateDirectory(queryClient, { entity: 'driver', type: 'create', carrierIds: [carrierId] }) }}` (y `'asset'` en el de equipos).
- `TransferModal.onTransfer` (`:1070`): `await invalidateDirectory(queryClient, { entity: s.entity_type === 'ASSET' ? 'asset' : 'driver', id: s.entity_id, type: 'assignment', carrierIds: [carrierId, destino] })`.
- Si `invalidarCertificacion` deja de usarse en el archivo para estas mutaciones, el import se conserva solo si queda otro uso (la línea 389 sigue usándolo para una fecha corregida).

**Certificación › Empresas** (`compliance/page.tsx`):
- `:321`: `await invalidateDirectory(qc, { entity: group === 'driver' ? 'driver' : 'asset', id: asignandoEmpresa.entity_id, type: 'assignment', carrierIds: [carrierId] })`.
- `handleCarrierCreated` (`:131`): pasa a `async` y, antes de navegar, `await invalidateDirectory(qc, { entity: 'carrier', id: created.id, type: 'create' })` (`qc` es el `useQueryClient()` que ya existe en la página; si se llama distinto, usar ese nombre).

**Directorio › lista** (`carriers/page.tsx:107`): `handleCarrierCreated` invalida igual antes de navegar; agregar `const queryClient = useQueryClient()` si la página no lo tiene.

**Cierre** (`PreCierrePendingSection.tsx`), con R9:

```tsx
  async function afterChange(change: DirectoryChange) {
    await invalidateDirectory(queryClient, change)
    // Esta pantalla ES el Cierre: se relee ya, para traer `pendiente_desde` y que
    // el aviso y la relectura de 15 s arranquen (0.6). Desde otras pantallas el
    // Cierre solo queda marcado viejo.
    await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
  }
```

y reemplaza a `invalidate()`:
- `handleActivate` y `handleSaveTaxId`: `await afterChange({ entity: 'carrier', id: carrierId, type: 'update' })`;
- `VincularConductorPropuesto`: `onVinculado={() => afterChange({ entity: 'driver', id: esc.driver_id, type: 'assignment', carrierIds: [esc.carrier_id] })}`;
- `NewCarrierPanel.onCreated`: `void afterChange({ entity: 'carrier', id: carrier.id, type: 'create' })`;
- `AltaConductorDesdeCierre`: `onListo={carrierId => afterChange({ entity: 'driver', type: 'create', carrierIds: [carrierId] })}`.

En `AltaConductorDesdeCierre.tsx`: `onListo: (carrierId: string | null) => Promise<void> | void` (`:17`) y `await onListo(empresa?.id ?? null)` (`:60`).

**Monitor** (`monitor/page.tsx:749-756`): después de `carriersApi.assignDriver` y de `tripsApi.assignDriver`:

```tsx
                await invalidateDirectory(queryClient, {
                  entity: 'driver', id: creado.id, type: 'create', carrierIds: [carrierId],
                })
```

- [ ] **Step 5: Run the tests**

Run: `cd monitor-app/frontend && npx vitest run lib/queries "app/dashboard/carriers" "app/dashboard/compliance" app/dashboard/operations components/dashboard components/compliance && npx tsc --noEmit`
Expected: PASS. Si un test de pantalla esperaba que una mutación releyera algo que ahora se relee igual (o con `refetchType: 'none'`), revisar si el test fijaba el comportamiento viejo antes de cambiarlo, y reportarlo.

- [ ] **Step 6: Verificar que la mutación mata el test**

(a) En `handleConfirmTransfer`, dejar `carrierIds: [id]` (sin destino): ningún test de `directorio.test.ts` lo nota (la función es correcta), así que esta mutación se prueba en la función: en `invalidateDirectory`, cambiar el `for (const carrierId of change.carrierIds ?? [])` por `change.carrierIds?.slice(0, 1) ?? []`. `una transferencia invalida el roster de origen y el de destino` tiene que fallar. (b) Borrar la llamada a `invalidateDirectory` del Monitor: `toda mutación del Directorio pasa por invalidateDirectory` tiene que listar `app/dashboard/operations/monitor/page.tsx`. Restaurar los dos.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/lib monitor-app/frontend/hooks monitor-app/frontend/app monitor-app/frontend/components
git commit -m "feat(directorio): una fábrica de claves y una sola invalidación entre módulos

Toda mutación de empresas, conductores y equipos —Directorio, Certificación,
Cierre y Monitor— llama a invalidateDirectory: Directorio, Certificación,
Monitor y vista rápida se refrescan; el Cierre queda marcado viejo sin
releer; una transferencia refresca origen y destino; una sola clave para la
ficha de empresa. Un test que mira el código falla con una raíz o una
mutación sin cubrir (bloque 0, 0.5).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Frescura del Cierre y aviso del Directorio (0.6)

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:29` (import), `:2416-2419` (respuesta de `cierre_viajes`)
- Modify: `monitor-app/backend/api/tests/test_get_del_cierre_no_escribe_integracion.py:16-20`
- Modify: `monitor-app/frontend/components/dashboard/AvisoDeActualizacion.tsx` (+ test)
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx:158`, `:200-204`
- Modify: `monitor-app/frontend/components/dashboard/sections/FlotaDelDiaSection.tsx:132-139` (+ test)
- Modify: `monitor-app/frontend/lib/types.ts:1714-1718` (`CierreViajesResponse`)
- Create: `monitor-app/frontend/components/dashboard/DirectoryNotice.tsx` (+ test)
- Modify: `monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx` (`afterChange`, render del aviso) (+ test)

**Interfaces:**
- Consumes: `CLOSURE_NOTICE`, `invalidateDirectory` (Task 8).
- Produces: `GET /trips/cierre-viajes` con `calculado_a` y `pendiente_desde`; `refetchWhilePending(query): number | false`, `REFETCH_WHILE_PENDING_MS = 15_000`; `DirectoryNotice({ message, onClose })`.

- [ ] **Step 1: Write the failing backend test**

En `test_get_del_cierre_no_escribe_integracion.py`, agregar `cierre-viajes` al `parametrize` (el test ya afirma `"pendiente_desde" in respuesta and "calculado_a" in respuesta`):

```python
from app.routers.trips import cierre_viajes
```

```python
    lambda pool, f: cierre_viajes(fecha=f, pool=pool, _=None),
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_get_del_cierre_no_escribe_integracion.py -q`
Expected: FAIL solo en el caso nuevo, con `assert 'pendiente_desde' in {...}`.

- [ ] **Step 3: Implement the backend**

`trips.py:29`: `from ..services.cierre_lineas import frescura_del_dia, ultima_firma`. Al final de `cierre_viajes`:

```python
    return {
        "grupos": grupos,
        "bloquean": len(grupos["hoy"]) + len(grupos["rezago"]) + incompletas_del_dia,
        # La misma marca que daily-closure y equipment-closures (bloque 0, 0.6):
        # mientras el día tiene un recálculo pendiente, la pantalla relee cada 15 s.
        **await frescura_del_dia(pool, day),
    }
```

Run de nuevo el Step 2. Expected: PASS.

- [ ] **Step 4: Write the failing frontend tests**

En `AvisoDeActualizacion.test.tsx` (patrón del propio archivo):

```tsx
import { refetchWhilePending, REFETCH_WHILE_PENDING_MS } from './AvisoDeActualizacion'

describe('refetchWhilePending', () => {
  it('relee cada 15 s solo mientras hay un recálculo pendiente', () => {
    expect(refetchWhilePending({ state: { data: { pendiente_desde: '2026-10-12T15:00:00Z' } } })).toBe(REFETCH_WHILE_PENDING_MS)
    expect(refetchWhilePending({ state: { data: { pendiente_desde: null } } })).toBe(false)
    expect(refetchWhilePending({ state: { data: undefined } })).toBe(false)
  })
})
```

En `FlotaDelDiaSection.test.tsx` (patrón de reloj de `app/dashboard/admin/settings/BuscadorConfig.test.tsx:34-45`, `useFakeTimers({ shouldAdvanceTime: true })` + `advanceTimersByTimeAsync`):

```tsx
  it('los tractos se releen cada 15 s mientras el día tiene un recálculo pendiente (0.6)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
      vi.mocked(equipmentClosuresApi.get).mockResolvedValue({ ...EQUIPMENT_STATUS, pendiente_desde: '2026-08-04T15:00:00Z' })
      renderSection()
      await screen.findByText('FCCP42')
      const antes = vi.mocked(equipmentClosuresApi.get).mock.calls.length
      await vi.advanceTimersByTimeAsync(15_000)
      await waitFor(() => expect(vi.mocked(equipmentClosuresApi.get).mock.calls.length).toBeGreaterThan(antes))
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin recálculo pendiente no relee', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
      renderSection()
      await screen.findByText('FCCP42')
      const antes = vi.mocked(equipmentClosuresApi.get).mock.calls.length
      await vi.advanceTimersByTimeAsync(31_000)
      expect(vi.mocked(equipmentClosuresApi.get).mock.calls.length).toBe(antes)
    } finally {
      vi.useRealTimers()
    }
  })
```

`DirectoryNotice.test.tsx` (nuevo):

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DirectoryNotice } from './DirectoryNotice'

describe('DirectoryNotice', () => {
  it('sin mensaje no dibuja nada', () => {
    const { container } = render(<DirectoryNotice message={null} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('anuncia el mensaje y se cierra', () => {
    const onClose = vi.fn()
    render(<DirectoryNotice message="El Cierre se actualizará en alrededor de un minuto." onClose={onClose} />)
    expect(screen.getByRole('status')).toHaveTextContent('El Cierre se actualizará en alrededor de un minuto.')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

En `carriers/[id]/page.test.tsx`:

```tsx
  it('dar de baja a un conductor avisa que el Cierre se actualizará', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
      home_location_id: null, home_location_name: null, home_location_shipper: null, suggested_home_location: null,
    })
    vi.mocked(driversApi.patch).mockResolvedValue({} as never)
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar baja' }))
    expect(await screen.findByText('El Cierre se actualizará en alrededor de un minuto.')).toBeInTheDocument()
  })
```

- [ ] **Step 5: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/AvisoDeActualizacion.test.tsx components/dashboard/sections/FlotaDelDiaSection.test.tsx components/dashboard/DirectoryNotice.test.tsx "app/dashboard/carriers/[id]/page.test.tsx"`
Expected: FAIL: `refetchWhilePending` y `DirectoryNotice` no existen; el test de 15 s no ve la segunda llamada; el texto del aviso no aparece. "Sin recálculo pendiente no relee" pasa (guarda).

- [ ] **Step 6: Implement the frontend**

`AvisoDeActualizacion.tsx`, debajo de `ATRASO_MS`:

```ts
/** Relectura cada 15 s solo mientras el día tiene cambios por entrar: la misma
 *  regla para las tres consultas del Cierre (bloque 0 del Directorio, 0.6). */
export const REFETCH_WHILE_PENDING_MS = 15_000

export function refetchWhilePending<T extends { pendiente_desde?: string | null }>(
  query: { state: { data: T | undefined } },
): number | false {
  return query.state.data?.pendiente_desde ? REFETCH_WHILE_PENDING_MS : false
}
```

`closures/page.tsx:158`: `refetchInterval: refetchWhilePending,` (importado desde `@/components/dashboard/AvisoDeActualizacion`); en `cierreViajesQuery` (`:200-204`) agregar `refetchInterval: refetchWhilePending,`. El aviso no cambia: ya se dibuja una vez arriba de las pestañas (R4).

`FlotaDelDiaSection.tsx:132-139`: `refetchInterval: refetchWhilePending,` en `driversQuery` y en `equipmentQuery`.

`lib/types.ts`, en `CierreViajesResponse`:

```ts
  /** Bloque 0, 0.6: la misma marca de frescura que el resto del Cierre. */
  calculado_a?:     string | null
  pendiente_desde?: string | null
```

`components/dashboard/DirectoryNotice.tsx`:

```tsx
'use client'

import { X } from 'lucide-react'

/** El aviso breve después de guardar en el Directorio: a dónde quedó lo que se
 *  transfirió, o que el Cierre se recalcula en alrededor de un minuto (bloque 0
 *  del Directorio, 0.6 y 0.7). Fijo abajo, para que se vea también con un panel
 *  lateral abierto. Mismo tono que el aviso de Sin clasificar (`bg-text-primary`):
 *  dos negros distintos para dos carteles que se ven juntos ya fue un hallazgo. */
export function DirectoryNotice({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null
  return (
    <div role="status"
         className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 inline-flex items-center gap-3 rounded-lg bg-text-primary py-1.5 pl-3 pr-2 text-etiqueta text-white shadow-sm">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Cerrar aviso"
              className="rounded p-0.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}
```

`carriers/[id]/page.tsx`: `afterChange` (Task 8) pasa a:

```tsx
  const [notice, setNotice] = useState<string | null>(null)
  /** Todo cambio pasa por acá: una sola lista de qué queda obsoleto, y el aviso
   *  cuando el cambio llega al Cierre (que se recalcula en el servidor). */
  async function afterChange(change: DirectoryChange, done?: string) {
    const { affectsClosure } = await invalidateDirectory(queryClient, change)
    const partes = [done, affectsClosure ? CLOSURE_NOTICE : null].filter(Boolean)
    setNotice(partes.length ? partes.join(' ') : null)
  }
```

y, al final del JSX (antes del cierre del contenedor principal), `<DirectoryNotice message={notice} onClose={() => setNotice(null)} />`.

- [ ] **Step 7: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard "app/dashboard/carriers" app/dashboard/operations lib/ui lib/copy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_get_del_cierre_no_escribe_integracion.py \
  monitor-app/frontend/components/dashboard monitor-app/frontend/app/dashboard monitor-app/frontend/lib/types.ts
git commit -m "feat(cierre): las tres consultas del Cierre se releen mientras hay recálculo pendiente

cierre-viajes devuelve la marca de frescura; tractos y viajes se releen cada
15 s solo con un recálculo pendiente, igual que conductores. Guardar en el
Directorio avisa que el Cierre se actualizará en alrededor de un minuto
(bloque 0, 0.6).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Red mínima: confirmar, avisar, un diccionario de estados (0.7)

**Files:**
- Modify: `monitor-app/frontend/components/compliance/ConfirmarBaja.tsx` (+ test)
- Modify: `monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx:139-151`, `:315-325`; `VehicleDetailPanel.tsx` (bloque equivalente, `:411-421`) (+ tests)
- Modify: `monitor-app/frontend/components/dashboard/TransferModal.tsx:15`, `:35-46`, `:82` (+ test)
- Modify: `monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx` (`handleConfirmTransfer`, `carrierName` a los paneles)
- Modify: `monitor-app/frontend/lib/types.ts:958-963`
- Modify: `monitor-app/frontend/components/dashboard/TransporterCard.tsx:13-15`, `:69` (+ test); `TransporterSlideOver.tsx:11`, `:117`; `app/dashboard/carriers/page.tsx:13`, `:303`; `app/dashboard/compliance/[carrierId]/page.tsx:30`, `:776`; `ChipDeBaja.tsx:24`; `ResultadosDelDirectorio.tsx:100`; `EntityQuickView.tsx:150-152` (+ test)
- Create: `monitor-app/frontend/lib/status.test.ts`

**Interfaces:**
- Consumes: `DirectoryEntity` (Task 8), `afterChange(change, done?)` (Task 9).
- Produces: `statusLabel(entity: DirectoryEntity, status: string): string`; `ConfirmarBaja` con `variant?: 'deactivate' | 'remove'`; `TransferModal.onTransfer(toCarrierId: string, toCarrierName: string)`; paneles con `carrierName?: string`.

- [ ] **Step 1: Write the failing tests**

`lib/status.test.ts` (patrón de recorrido de `lib/ui/sistema.test.ts`):

```ts
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { statusLabel } from '@/lib/types'

describe('statusLabel (bloque 0, 0.7)', () => {
  it('concuerda en género: la empresa dada de baja, el conductor y el equipo dados de baja', () => {
    expect(statusLabel('carrier', 'INACTIVE')).toBe('Dada de baja')
    expect(statusLabel('carrier', 'LEGACY_INACTIVE')).toBe('Dada de baja')
    expect(statusLabel('carrier', 'ACTIVE')).toBe('Activa')
    expect(statusLabel('carrier', 'ONBOARDING')).toBe('En onboarding')
    expect(statusLabel('driver', 'INACTIVE')).toBe('Dado de baja')
    expect(statusLabel('asset', 'ACTIVE')).toBe('Activo')
  })

  it('"Inactiva" ya no es una etiqueta de estado en ninguna pantalla', () => {
    const RAIZ = join(__dirname, '..')
    const recorrer = (dir: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) recorrer(ruta, acc) }
        else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) acc.push(ruta)
      }
      return acc
    }
    const con = ['app', 'components'].flatMap(d => recorrer(join(RAIZ, d)))
      .filter(r => readFileSync(r, 'utf8').includes("'Inactiva'"))
    expect(con).toEqual([])
  })
})
```

`ConfirmarBaja.test.tsx` (patrón del propio archivo):

```tsx
  it('la variante "remove" dice que quita del roster, no que da de baja', () => {
    render(<ConfirmarBaja abierto variant="remove" nombreSujeto="Juan Pérez" nombreEmpresa="Acme"
                          onCancelar={vi.fn()} onConfirmar={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByRole('dialog', { name: 'Quitar a Juan Pérez del roster de Acme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar del roster' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument()
  })
```

En `DriverDetailPanel.test.tsx` y `VehicleDetailPanel.test.tsx`, el test `shows "Quitar del roster" only when canEdit, and calls onRemove when clicked` (`:177` y `:142`) **fija el defecto** (quita con un clic). Reemplazarlo en los dos por:

```tsx
  it('"Quitar del roster" pide confirmación antes de quitar (0.7)', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onRemove, canEdit: true })   // ASSET en el de equipos
    fireEvent.click(screen.getByRole('button', { name: /Quitar del roster/ }))
    expect(onRemove).not.toHaveBeenCalled()
    const dialogo = screen.getByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Quitar del roster' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })
```

(importar `within` de `@testing-library/react`). El caso "no se ve sin canEdit" ya lo cubre la Task 7.

`TransferModal.test.tsx` (helper `montar`, `:14-29`; la firma de `onTransfer` en el helper pasa a `(toCarrierId: string, toCarrierName: string) => Promise<void>`):

```tsx
  it('entrega el destino con su nombre, para poder avisar a dónde quedó', async () => {
    const onTransfer = vi.fn().mockResolvedValue(undefined)
    montar({ onTransfer })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Otra' } })
    fireEvent.click(await screen.findByText('Otra Empresa'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar transferencia' }))
    await waitFor(() => expect(onTransfer).toHaveBeenCalledWith('c2', 'Otra Empresa'))
  })
```

(si el campo de búsqueda no es `textbox` único, copiar el selector que usan los tests vecinos del archivo).

En `carriers/[id]/page.test.tsx`:

```tsx
  it('al transferir avisa a dónde quedó el conductor', async () => {
    // … abrir a Juan Pérez como en el test de transferir (`:347`), clic en "Transferir a otra empresa",
    // elegir "Otra Empresa" (mock de carriersApi.list con { id: 'c2', business_name: 'Otra Empresa' })
    // y confirmar.
    expect(await screen.findByText(/Listo: conductor Juan Pérez quedó en Otra Empresa\./)).toBeInTheDocument()
  })
```

En `TransporterCard.test.tsx` (`:46-53`), los dos tests fijan las etiquetas viejas: `'Inactiva'` pasa a `'Dada de baja'` y `'Onboarding'` a `'En onboarding'`. En `EntityQuickView.test.tsx:75`, `'De baja'` pasa a `'Dado de baja'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run lib/status.test.ts components/compliance/ConfirmarBaja.test.tsx components/dashboard "app/dashboard/carriers/[id]/page.test.tsx"`
Expected: FAIL: `statusLabel` no existe; la variante no existe; "Quitar del roster" llama a `onRemove` sin diálogo; `onTransfer` se llama con un solo argumento; el aviso no aparece; las etiquetas viejas.

- [ ] **Step 3: Implement the dictionary**

`lib/types.ts`, debajo de `OPERATIONAL_STATUS_LABELS`:

```ts
/** Conductor y equipo: masculino. Con `OPERATIONAL_STATUS_LABELS` (empresa,
 *  femenino) son el ÚNICO diccionario de estados (bloque 0, 0.7). "Inactiva" se
 *  retiró: el mismo estado se llamaba distinto según la pantalla (F-35). */
const FLEET_STATUS_LABELS: Record<OperationalStatus, string> = {
  ACTIVE:          'Activo',
  INACTIVE:        'Dado de baja',
  LEGACY_INACTIVE: 'Dado de baja',
}

export function statusLabel(entity: DirectoryEntity, status: string): string {
  const labels: Record<string, string> = entity === 'carrier' ? OPERATIONAL_STATUS_LABELS : FLEET_STATUS_LABELS
  return labels[status] ?? status
}
```

`TransporterCard.tsx`: borrar `STATUS_LABELS` (`:13-15`, y su comentario pasa a apuntar a `statusLabel`); `:69` usa `statusLabel('carrier', item.operational_status)`. `STATUS_CLS` se queda. Los demás usuarios de `STATUS_LABELS`: `carriers/page.tsx:303`, `TransporterSlideOver.tsx:117` y `compliance/[carrierId]/page.tsx:776` pasan a `statusLabel('carrier', …)` (y sus imports a `import { statusLabel } from '@/lib/types'`). `carriers/[id]/page.tsx:433` pasa a `statusLabel('carrier', carrier.operational_status)`.

`ChipDeBaja.tsx:24`: `<UserX size={9} /> {statusLabel('driver', estado)}`. `ResultadosDelDirectorio.tsx:100`: `{statusLabel('driver', 'INACTIVE')}` (conductores y vehículos dicen lo mismo).

`EntityQuickView.tsx:150-152`:

```tsx
            <StatusChip tone={isActive(data.operational_status) ? 'resolved' : 'neutral'}>
              {statusLabel(target.kind, data.operational_status)}
            </StatusChip>
```

(y se borra `const female = …`, que solo alimentaba la etiqueta).

- [ ] **Step 4: Implement the confirmation**

`ConfirmarBaja.tsx`: en `Props`,

```ts
  /** 'deactivate' es el texto de Certificación; 'remove' es "Quitar del roster"
   *  del Directorio: el mismo gesto (termina la asignación), con su nombre.
   *  Una variante es una prop, no un componente hermano. */
  variant?: 'deactivate' | 'remove'
```

En el cuerpo:

```tsx
  const titulo = variant === 'remove'
    ? `Quitar a ${nombreSujeto} del roster de ${nombreEmpresa}`
    : `Dar de baja a ${nombreSujeto} de ${nombreEmpresa}`
  const accion = variant === 'remove' ? 'Quitar del roster' : 'Dar de baja'
```

`aria-label={titulo}`, el `<h2>` dice `{titulo}`, el botón dice `{accion}` y el error por defecto pasa a `variant === 'remove' ? 'No se pudo quitar' : 'No se pudo dar de baja'`.

`DriverDetailPanel.tsx`: agregar a `Props` `carrierName?: string`; reemplazar `removing`/`handleRemove` (`:139-151`) por `const [confirmingRemove, setConfirmingRemove] = useState(false)`; el botón "Quitar del roster" (`:315-325`) hace `onClick={() => setConfirmingRemove(true)}` (sin `disabled={removing}` ni el `Loader2`), y al final del JSX:

```tsx
      <ConfirmarBaja
        abierto={confirmingRemove}
        variant="remove"
        nombreSujeto={driver.full_name}
        nombreEmpresa={carrierName ?? 'esta empresa'}
        onCancelar={() => setConfirmingRemove(false)}
        onConfirmar={async () => { await onRemove(); setConfirmingRemove(false) }}
      />
```

`VehicleDetailPanel.tsx`: igual, con `nombreSujeto={asset.license_plate}`. En `carriers/[id]/page.tsx`, pasar `carrierName={carrier.business_name}` a los dos paneles.

- [ ] **Step 5: Implement the transfer notice**

`TransferModal.tsx`: `onTransfer: (toCarrierId: string, toCarrierName: string) => Promise<void>`; el estado `selectedId` pasa a `const [selected, setSelected] = useState<CarrierSearchResult | null>(null)` (importar el tipo de `CarrierSearchPicker`); `onPick={c => setSelected(c)}`, `selectedId={selected?.id ?? null}`, `onQueryChange={v => { setQ(v); setSelected(null) }}`, `disabled={!selected || submitting}` y `await onTransfer(selected.id, selected.business_name)`. Los llamadores de una sola variable (`compliance/page.tsx:316`, `compliance/[carrierId]/page.tsx:1066`) siguen compilando.

`carriers/[id]/page.tsx`, `handleConfirmTransfer`:

```tsx
  async function handleConfirmTransfer(toCarrierId: string, toCarrierName: string) {
    if (!transferTarget) return
    if (transferTarget.kind === 'driver') {
      await carriersApi.assignDriver(toCarrierId, transferTarget.id)
      setSelectedDriverId(null)
    } else {
      await carriersApi.assignAsset(toCarrierId, transferTarget.id)
      setSelectedAssetId(null)
    }
    await afterChange(
      { entity: transferTarget.kind, id: transferTarget.id, type: 'assignment', carrierIds: [id, toCarrierId] },
      `Listo: ${transferTarget.label} quedó en ${toCarrierName}.`,
    )
    setTransferTarget(null)
  }
```

- [ ] **Step 6: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run lib components/dashboard components/compliance "app/dashboard/carriers" "app/dashboard/compliance" && npx tsc --noEmit`
Expected: PASS, trinquetes sin subir.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/lib monitor-app/frontend/components monitor-app/frontend/app
git commit -m "feat(directorio): confirmar Quitar, avisar la transferencia y un solo diccionario de estados

Quitar del roster pide confirmación (variante de ConfirmarBaja); transferir
dice a qué empresa quedó; \"Dada de baja\" para la empresa y \"Dado de baja\"
para conductor y equipo, sin \"Inactiva\" (bloque 0, 0.7).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: La flota de una empresa dada de baja, marcada (0.9)

**Files:**
- Modify: `monitor-app/backend/api/app/services/entity_summary.py:57-62` (`_ref`), `:75-90`, `:121-133`
- Modify: `monitor-app/backend/api/app/routers/drivers.py:42-62` (`list_drivers`)
- Modify: `monitor-app/backend/api/app/routers/carriers.py` (`_SQL_BUSCAR_CONDUCTORES`, `_SQL_BUSCAR_VEHICULOS`)
- Create: `monitor-app/backend/api/tests/test_carrier_status_in_fleet_reads_integration.py`
- Modify: `monitor-app/frontend/lib/types.ts` (`isCarrierDeactivated`, `CARRIER_DEACTIVATED_LABEL`, campos), `lib/api/entitySummary.ts:9` (`EntityRef`)
- Modify: `monitor-app/frontend/components/dashboard/ChipDeBaja.tsx`, `DriverRosterCard.tsx`, `VehicleRosterCard.tsx`, `ResultadosDelDirectorio.tsx`, `EntityQuickView.tsx`, `DriverSearchPicker.tsx`, `FleetAssignSection.tsx:49-61`, `app/dashboard/carriers/[id]/page.tsx:664,762` (+ tests)

**Interfaces:**
- Produces (API): `carrier: {id, name, operational_status} | null` en `/drivers/{id}/summary` y `/assets/{id}/summary`; `carrier_operational_status` en cada fila de `GET /drivers?q` y en `conductores`/`vehiculos` de `GET /carriers/buscar`.
- Produces (frontend): `isCarrierDeactivated(status: string | null | undefined): boolean`; `CARRIER_DEACTIVATED_LABEL = 'Empresa dada de baja'`; `ChipDeBaja({ estado, carrierStatus? })`; `DriverRosterCard`/`VehicleRosterCard` con `carrierStatus?: CarrierOperationalStatus`.

- [ ] **Step 1: Write the failing backend tests**

Patrón copiado de `tests/test_entity_summary_integration.py` (`new_carrier`, `new_driver`, llamar el router con `PoolDeUnaConexion`). Crear `tests/test_carrier_status_in_fleet_reads_integration.py`:

```python
"""Bloque 0 del Directorio, 0.9: la flota de una empresa dada de baja se ve
marcada. Dar de baja archiva, no oculta (P1): la flota sigue vinculada como
historial, y las lecturas tienen que decir que su empresa está de baja (F-04)."""
from __future__ import annotations

import uuid

import pytest

from app.routers.assets import get_asset_summary
from app.routers.carriers import buscar_en_el_directorio
from app.routers.drivers import get_driver_summary, list_drivers
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-DIRECTORIO"


async def _flota_de_empresa_de_baja(conn) -> dict:
    s = uuid.uuid4().hex[:6]
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'INACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {s}")
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Conductor {s}")
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", driver, carrier)
    asset = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}")
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", asset, carrier)
    return {"carrier": carrier, "driver": driver, "asset": asset, "sufijo": s}


async def test_la_vista_rapida_dice_que_la_empresa_esta_de_baja(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_de_empresa_de_baja(conn)
    pool = PoolDeUnaConexion(conn)
    conductor = await get_driver_summary(f["driver"], pool=pool, _=None)
    equipo = await get_asset_summary(f["asset"], pool=pool, _=None)
    assert conductor["carrier"]["operational_status"] == "INACTIVE"
    assert equipo["carrier"]["operational_status"] == "INACTIVE"


async def test_la_busqueda_del_monitor_trae_la_empresa_y_su_estado(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_de_empresa_de_baja(conn)
    filas = await list_drivers(q=f"Conductor {f['sufijo']}", limit=10, pool=PoolDeUnaConexion(conn), _=None)
    assert [(r["carrier_id"], r["carrier_operational_status"]) for r in filas] == [(f["carrier"], "INACTIVE")]


async def test_el_buscador_del_directorio_trae_el_estado_de_la_empresa(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_de_empresa_de_baja(conn)
    r = await buscar_en_el_directorio(q=f"Conductor {f['sufijo']}", limit=10, pool=PoolDeUnaConexion(conn), _=None)
    assert [c["carrier_operational_status"] for c in r["conductores"]] == ["INACTIVE"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_carrier_status_in_fleet_reads_integration.py -q`
Expected: FAIL con `KeyError: 'operational_status'` / `KeyError: 'carrier_operational_status'`; en la búsqueda del Monitor, además, hoy `carrier_id` viene `None`.

- [ ] **Step 3: Implement the backend**

`entity_summary.py`:

```python
def _carrier_ref(row) -> dict | None:
    """La empresa, con su estado: un conductor o equipo de una empresa dada de
    baja tiene que poder decirlo (bloque 0, 0.9)."""
    if row["carrier_id"] is None:
        return None
    return {"id": str(row["carrier_id"]), "name": row["carrier_name"],
            "operational_status": row["carrier_status"]}
```

En los `SELECT` de `driver_summary` y `asset_summary`, junto a `c.business_name AS carrier_name`, agregar `c.operational_status AS carrier_status`; y `"carrier": _carrier_ref(row)` en lugar de `_ref(row, "carrier_id", "carrier_name")` en los dos.

`drivers.py`, `list_drivers`:

```sql
            c.id       AS carrier_id,
            c.business_name AS carrier_name,
            -- La empresa aunque esté de baja, con su estado (bloque 0, 0.9; R10):
            -- antes salía "Sin empresa". FleetAssignSection solo la autocompleta
            -- si no está dada de baja, así que lo que se asigna no cambia.
            c.operational_status AS carrier_operational_status,
```

y `LEFT JOIN public.carriers c ON c.id = da.carrier_id` (sin `AND c.operational_status = 'ACTIVE'`).

`carriers.py`: en `_SQL_BUSCAR_CONDUCTORES` y `_SQL_BUSCAR_VEHICULOS`, agregar `c.operational_status AS carrier_operational_status` después de `c.business_name AS carrier_name`.

- [ ] **Step 4: Run the backend tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_carrier_status_in_fleet_reads_integration.py tests/test_entity_summary_integration.py tests/test_entity_summary_routes.py tests/test_drivers.py tests/test_carriers.py -q`
Expected: PASS.

- [ ] **Step 5: Verificar que la mutación mata el test**

Volver a poner `AND c.operational_status = 'ACTIVE'` en `list_drivers`: `test_la_busqueda_del_monitor_trae_la_empresa_y_su_estado` tiene que fallar. Restaurar.

- [ ] **Step 6: Write the failing frontend tests**

`DriverRosterCard.test.tsx` (patrón del propio archivo, `:41-45`):

```tsx
  it('marca al conductor de una empresa dada de baja (0.9)', () => {
    render(<DriverRosterCard driver={DRIVER} carrierStatus="INACTIVE" onOpen={vi.fn()} />)
    expect(screen.getByText('Empresa dada de baja')).toBeInTheDocument()
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
  })
```

(y lo mismo en `VehicleRosterCard.test.tsx` con su fixture). En `EntityQuickView.test.tsx`:

```tsx
  it('con la empresa dada de baja no dice "Activo" (0.9)', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue(
      { ...DRIVER, carrier: { ...DRIVER.carrier, operational_status: 'INACTIVE' } } as never)
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal' })
    expect(await screen.findByText('Empresa dada de baja')).toBeInTheDocument()
    expect(screen.queryByText('Activo')).not.toBeInTheDocument()
  })
```

En `FleetAssignSection.test.tsx` (helper `Harness` y `CANDIDATE`, `:16-41`; copiar cómo un test vecino elige un sugerido):

```tsx
  it('no autocompleta una empresa dada de baja (R10)', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} suggested={[{ ...CANDIDATE, carrier_operational_status: 'INACTIVE' }]} />)
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ driver_id: 'd1', carrier_id: null, carrier_name: null }))
  })
```

En `DriverSearchPicker.test.tsx` (copiar su forma de pasar `suggested`):

```tsx
  it('marca al conductor de una empresa dada de baja', () => {
    render(<DriverSearchPicker query="" onQueryChange={vi.fn()} onPick={vi.fn()}
                               suggested={[{ ...CANDIDATO, carrier_operational_status: 'INACTIVE' }]} />)
    expect(screen.getByText('Empresa dada de baja')).toBeInTheDocument()
  })
```

(`CANDIDATO` es el fixture que el archivo ya tenga; si no hay, el `CANDIDATE` de `FleetAssignSection.test.tsx`). Si `DriverSearchPicker` necesita `QueryClientProvider` en su test, usar el envoltorio del propio archivo.

- [ ] **Step 7: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/DriverRosterCard.test.tsx components/dashboard/VehicleRosterCard.test.tsx components/dashboard/EntityQuickView.test.tsx components/dashboard/FleetAssignSection.test.tsx components/dashboard/DriverSearchPicker.test.tsx`
Expected: FAIL: el texto no existe y la empresa se autocompleta.

- [ ] **Step 8: Implement the frontend**

`lib/types.ts`, junto a `statusLabel`:

```ts
/** La empresa está dada de baja (no "en onboarding"). Su flota queda vinculada
 *  como historial (P1) y se marca en lugar de decir "Activo" (bloque 0, 0.9). */
export function isCarrierDeactivated(status: string | null | undefined): boolean {
  return status === 'INACTIVE' || status === 'LEGACY_INACTIVE'
}
export const CARRIER_DEACTIVATED_LABEL = 'Empresa dada de baja'
```

Tipos: en `DriverPickCandidate` (`:162`) `carrier_operational_status?: CarrierOperationalStatus | null`; en `DirectorioBusqueda.conductores` y `.vehiculos` (`:1517-1533`) `carrier_operational_status: CarrierOperationalStatus | null`; en `lib/api/entitySummary.ts:9` `export type EntityRef = { id: string; name: string; operational_status?: string }`.

`ChipDeBaja.tsx`:

```tsx
export function ChipDeBaja({ estado, carrierStatus }: { estado: OperationalStatus; carrierStatus?: string | null }) {
  const propia = estado !== 'ACTIVE'
  if (!propia && !isCarrierDeactivated(carrierStatus)) return null
  return (
    <span className="inline-flex items-center gap-1 text-etiqueta font-semibold px-1.5 py-0.5 rounded-full border border-border text-informativo mt-0.5">
      {propia ? <UserX size={9} /> : <Building2 size={9} />}
      {propia ? statusLabel('driver', estado) : CARRIER_DEACTIVATED_LABEL}
    </span>
  )
}
```

(`Building2` de `lucide-react`; `isCarrierDeactivated`, `statusLabel`, `CARRIER_DEACTIVATED_LABEL` de `@/lib/types`).

`DriverRosterCard.tsx` y `VehicleRosterCard.tsx`: prop `carrierStatus?: CarrierOperationalStatus`; la condición del chip pasa a `driver.operational_status !== 'ACTIVE' || isCarrierDeactivated(carrierStatus)` y el chip a `<ChipDeBaja estado={driver.operational_status} carrierStatus={carrierStatus} />` (igual con `vehicle`). En `carriers/[id]/page.tsx:664,762`, pasar `carrierStatus={carrier.operational_status}`.

`ResultadosDelDirectorio.tsx`: `Fila` recibe `empresaDeBaja: boolean` (`isCarrierDeactivated(c.carrier_operational_status)`, igual para vehículos) y, cuando `!deBaja && empresaDeBaja`, dibuja el mismo chip con `CARRIER_DEACTIVATED_LABEL`.

`EntityQuickView.tsx`, en `Identity`, antes del `StatusChip` de estado:

```tsx
            {target.kind !== 'carrier' && isActive(data.operational_status)
              && isCarrierDeactivated((data as DriverSummary | AssetSummary).carrier?.operational_status)
              ? <StatusChip tone="neutral">{CARRIER_DEACTIVATED_LABEL}</StatusChip>
              : (
                <StatusChip tone={isActive(data.operational_status) ? 'resolved' : 'neutral'}>
                  {statusLabel(target.kind, data.operational_status)}
                </StatusChip>
              )}
```

`DriverSearchPicker.tsx`, en la línea de la empresa:

```tsx
              <p className="text-etiqueta text-informativo">
                {d.carrier_name ?? 'Sin empresa'}{d.tractor_plate ? ` · ${d.tractor_plate}` : ''}
                {isCarrierDeactivated(d.carrier_operational_status) && <> · {CARRIER_DEACTIVATED_LABEL}</>}
              </p>
```

(reemplaza el `text-[10px] text-gray-400` de esa línea: baja la deuda de los dos trinquetes).

`FleetAssignSection.tsx`, en `pick`:

```tsx
    // La empresa se autocompleta solo si opera (R10): un viaje no se asigna a
    // una empresa dada de baja, igual que antes de que la búsqueda la trajera.
    const opera = !isCarrierDeactivated(d.carrier_operational_status)
```

y `carrier_id: opera ? d.carrier_id : null`, `carrier_name: opera ? d.carrier_name : null`.

- [ ] **Step 9: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard "app/dashboard/carriers" lib && npx tsc --noEmit`
Expected: PASS; `lib/ui/sistema.test.ts` y `lib/ui/escala.test.ts` iguales o más bajos.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/backend/api/app/services/entity_summary.py monitor-app/backend/api/app/routers/drivers.py \
  monitor-app/backend/api/app/routers/carriers.py monitor-app/backend/api/tests/test_carrier_status_in_fleet_reads_integration.py \
  monitor-app/frontend/lib monitor-app/frontend/components monitor-app/frontend/app
git commit -m "feat(directorio): la flota de una empresa dada de baja se ve marcada

La vista rápida, las búsquedas del Monitor y del Directorio traen el estado
de la empresa; tarjetas, resultados, vista rápida y búsqueda de conductores
dicen \"Empresa dada de baja\" en vez de \"Activo\". La empresa de baja no se
autocompleta en un viaje (bloque 0, 0.9).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Sin clasificar: error y carga nunca como vacío (0.8)

**Files:**
- Modify: `monitor-app/frontend/components/compliance/TriageWorkbench.tsx:487-490` (zona de carga), `:512-520` (cifra), `:543-547` (lista), `:594-599` (formulario)
- Modify: `monitor-app/frontend/components/compliance/TriageClassifyForm.tsx:22-40`, `:202-208`
- Test: `TriageWorkbench.test.tsx`, `TriageClassifyForm.test.tsx`

**Interfaces:**
- Produces: `TriageClassifyForm` con `pendingState?: 'loading' | 'error' | 'ready'` (default `'ready'`) y `onRetryPending?: () => void`.

- [ ] **Step 1: Write the failing tests**

En `TriageWorkbench.test.tsx` (helper `setup`, mocks del archivo):

```tsx
  it('H2: si la cola falla lo dice como error, nunca como "0 sin clasificar"', async () => {
    vi.mocked(documentIngestApi.listQueue).mockReset().mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue({ total: 2, rows: [row('i1', 'ACME'), row('i2', 'NORTE')] })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la cola')
    expect(screen.queryByText('No hay documentos sin clasificar')).not.toBeInTheDocument()
    expect(screen.queryByText('sin clasificar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('i1.png')).toBeInTheDocument()
  })
```

(si `Cifra` dibuja la etiqueta en otro nodo que `getByText('sin clasificar')` no encuentra igual hoy, ajustar el selector al que usa el test existente que afirma la cifra, y reportarlo).

En `TriageClassifyForm.test.tsx` (helper `setup`, `:43-52`; pasar las props nuevas directo):

```tsx
  it('H4: mientras cargan los pendientes muestra esqueletos, nunca "no tiene pendientes"', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <TriageClassifyForm targetIds={['i1']} subjects={[]} carrierLabel="ACME" pendingState="loading" onApplied={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('status', { name: 'Cargando lo que le falta a la empresa' })).toBeInTheDocument()
    expect(screen.queryByText(/no tiene requisitos pendientes/)).not.toBeInTheDocument()
  })

  it('H4 (R15): si fallan los pendientes lo dice y deja reintentar', () => {
    const onRetry = vi.fn()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <TriageClassifyForm targetIds={['i1']} subjects={[]} carrierLabel="ACME" pendingState="error"
                            onRetryPending={onRetry} onApplied={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar lo que le falta a la empresa')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalled()
    expect(screen.queryByText(/no tiene requisitos pendientes/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/compliance/TriageWorkbench.test.tsx components/compliance/TriageClassifyForm.test.tsx`
Expected: FAIL: con la cola en error hoy aparece "No hay documentos sin clasificar"; el formulario dice "Esta empresa no tiene requisitos pendientes…" en los dos estados.

- [ ] **Step 3: Implement**

`TriageWorkbench.tsx`:
- La zona de carga (`:489`): `vacia={queueQuery.isSuccess && total === 0}`.
- La cifra (`:514`): `{queueQuery.isSuccess && <Cifra valor={total} etiqueta="sin clasificar" />}` (el resto del encabezado igual).
- La lista (`:544`):

```tsx
              {queueQuery.isPending ? (
                <Estado tipo="cargando" />
              ) : queueQuery.isError ? (
                // H2: un error de la cola NUNCA se muestra como "0 sin clasificar".
                <Estado tipo="error" titulo="No se pudo cargar la cola" detalle="Los documentos siguen guardados.">
                  <button type="button" onClick={() => { void queueQuery.refetch() }}
                          className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
                    Reintentar
                  </button>
                </Estado>
              ) : (
                <TriageFileTable … />   // sin cambios
              )}
```

(importar `Estado` de `@/components/ui/Estado`; el `Loader2` de esa rama deja de usarse ahí).
- El formulario (`:594-599`), dos props más:

```tsx
                pendingState={!subjectCarrierId ? 'ready' : pendingQuery.isPending ? 'loading' : pendingQuery.isError ? 'error' : 'ready'}
                onRetryPending={() => { void pendingQuery.refetch() }}
```

`TriageClassifyForm.tsx`: en `Props`,

```ts
  /** El estado de la consulta de pendientes de la empresa (H4): "sin pendientes"
   *  se dice solo con el dato en mano. */
  pendingState?: 'loading' | 'error' | 'ready'
  onRetryPending?: () => void
```

y la rama `{!subjects.length && (…)}` (`:202-208`):

```tsx
          {!subjects.length && (
            pendingState === 'loading' ? (
              <div role="status" aria-label="Cargando lo que le falta a la empresa" className="space-y-2">
                <div className="h-3 w-4/5 animate-pulse rounded bg-border" aria-hidden="true" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-border" aria-hidden="true" />
              </div>
            ) : pendingState === 'error' ? (
              <Estado tipo="error" titulo="No se pudo cargar lo que le falta a la empresa">
                <button type="button" onClick={onRetryPending}
                        className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
                  Reintentar
                </button>
              </Estado>
            ) : (
              <p className="text-[11px] text-informativo bg-accent/5 border border-border rounded-lg px-2 py-1.5">
                {carrierLabel
                  ? 'Esta empresa no tiene requisitos pendientes que se puedan asignar. Suele pasar cuando la empresa no está activa.'
                  : 'Este documento todavía no tiene empresa. Elígela arriba y aparecerá qué le falta.'}
              </p>
            )
          )}
```

(el esqueleto copia el de `EntityQuickView.LoadingSections`).

- [ ] **Step 4: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run components/compliance lib/ui lib/copy && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance
git commit -m "fix(certificacion): Sin clasificar no dice vacío cuando falla o carga

H2: la cola en error se muestra como error con Reintentar, nunca como
\"0 sin clasificar\". H4: mientras cargan los pendientes de la empresa hay
esqueletos, y si fallan se dice (bloque 0 del Directorio, 0.8).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Verificación, recorrido, despliegue 2 y registro

**Files:**
- Modify: `AGENTLOG.md`

- [ ] **Step 1: Suite del área (backend, primer plano)**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest \
  tests/test_directory_permissions.py tests/test_authz_catalogo.py tests/test_authz_sync_integracion.py \
  tests/test_authz_efectivos_integracion.py tests/test_matriz_roles.py tests/test_toda_ruta_declara_permiso.py \
  tests/test_permisos_ts_en_sincronia.py tests/test_permisos_por_campo.py tests/test_carriers.py tests/test_drivers.py \
  tests/test_assets.py tests/test_contacts.py tests/test_entity_summary_integration.py tests/test_entity_summary_routes.py \
  tests/test_carrier_status_in_fleet_reads_integration.py tests/test_get_del_cierre_no_escribe_integracion.py \
  tests/test_cierre_viajes.py tests/test_directorio.py -q
```

Expected: verde.

- [ ] **Step 2: Suite del área (frontend) y build**

Run: `cd monitor-app/frontend && npx vitest run lib hooks components/dashboard components/compliance components/ui app/dashboard/carriers app/dashboard/compliance app/dashboard/operations && npx tsc --noEmit && npm run build`
Expected: verde. El build corre porque `lib/types.ts`, `lib/queries` y componentes compartidos cambiaron.

- [ ] **Step 3: Recorrido en la copia local (Playwright MCP, nunca claude-in-chrome)**

Levantar `.superpowers/local-sim/` como dice el AGENTLOG (§ copia local):
1. `supabase start` en esa carpeta.
2. Aplicar `20261012100000_assignment_start_date_in_chile.sql` a la base local (URL local de `supabase status`; es una base ficticia, `psql` sirve ahí).
3. API en :8100 con `api.env` (`uvicorn app.main:app --port 8100` desde `monitor-app/backend/api` con ese entorno). Al arrancar, `sync_catalog` lleva `directory.fleet_status` a la base local.
4. Web: `cd monitor-app/frontend && env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN npx next dev -p 3100` con las variables `NEXT_PUBLIC_*` y `FASTAPI_URL` locales.
5. El ejecutor del Cierre no corre solo en la copia local: simularlo llamando a `procesar_cola` (script del scratchpad, como en la auditoría, lente A §"Cómo se reprodujo el ejecutor").

Como `cert@sim.local` (Supervisor de Certificación), con la ficha de una empresa ficticia en una pestaña y Certificación, el Cierre, el Monitor y la vista rápida en otras:
- renombrar un conductor y darlo de baja: la lista de la ficha cambia sin recargar (0.2, 0.5); Certificación y la vista rápida cambian sin recargar; el Cierre muestra "Actualizando…", se relee solo y queda al día tras simular el ejecutor (0.6);
- transferir un equipo: aviso "Listo: equipo … quedó en …" y "El Cierre se actualizará en alrededor de un minuto."; la ficha de la empresa destino lo muestra al abrirla (Review Focus 2);
- "Quitar del roster" pide confirmación (0.7);
- dar de baja la empresa: sus tarjetas, la vista rápida de un conductor suyo y la búsqueda de conductores del Monitor dicen "Empresa dada de baja" (0.9); reactivarla.

Como `ops@sim.local` (Supervisor de Operaciones): recorrer la ficha de una empresa, los paneles de conductor y equipo, contactos, Seguros dentro de la ficha y el pre-cierre. **Ningún botón responde 403** (mirar la red en Playwright: ningún 403). No ve "Dar de baja" de la empresa, sí el texto "La baja de una empresa la hace Certificación."

Review Focus 5 con un **Operador**: si la copia local no tiene un usuario con solo `operations_operator`, asignarle ese rol a uno ficticio **en la base local** (nunca en producción) y repetir: ve "Dar de baja"/"Reactivar" de conductor y equipo y nada más que escriba en el Directorio; ningún 403.

Sin clasificar: detener la API un momento y recargar Certificación › Sin clasificar: error con "Reintentar", nunca "0 sin clasificar" (H2); con la API arriba y la red lenta (Playwright), elegir una empresa: esqueletos, nunca "no tiene pendientes" (H4).

Capturas a 1440 px y 390 px en `.playwright-mcp/directorio-b0-*.png`.

- [ ] **Step 4: Push y workflows**

```bash
git push origin dev
gh run list --branch dev --limit 4
```

Esperar en primer plano a `Deploy Monitor API` y `Deploy Frontend` (`gh run watch <id> --exit-status`). Expected: `success`. El arranque de la API corre `sync_catalog`: comprobar en dev (solo lectura) que el permiso llegó:

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio
import asyncpg
from tests.conftest import credenciales_integracion
async def main():
    c = await asyncpg.connect(**credenciales_integracion())
    try:
        print(await c.fetch("""SELECT r.code FROM app.role_permissions rp JOIN app.roles r ON r.id = rp.role_id
                               WHERE rp.permission_code = 'directory.fleet_status' ORDER BY 1"""))
    finally:
        await c.close()
asyncio.run(main())
EOF
```

Expected: `certification_supervisor`, `operations_operator`, `operations_supervisor`.

- [ ] **Step 5: Mirar dev sin escribir**

En el frontend de dev, con datos reales y **sin guardar nada**: abrir la ficha de una empresa dada de baja con flota (las hay: D4 de la auditoría, 7 conductores y 9 equipos) y ver la marca; abrir el Cierre de hoy en escritorio y teléfono; abrir Sin clasificar.

- [ ] **Step 6: AGENTLOG y commit**

Entrada en `AGENTLOG.md` (sección del Directorio, 12/10):
- qué se hizo en los dos despliegues, con commits;
- las rulings R1-R16, y R5 marcada como **decisión pendiente del usuario**;
- las capturas del recorrido y la medición de la Task 5;
- siguiente paso exacto: spec de D1 ("Una sola respuesta": `app.is_operating`, `app.carrier_of`, `app.carrier_operation_types`), intercalada con Certificación 2a (Sin clasificar).

Si con esto el checkpoint del bloque 0 queda cerrado, mover su sección a `AGENTLOG_ARCHIVE.md` (fuera de git a propósito) y dejar en `AGENTLOG.md` solo el checkpoint vigente.

```bash
git add AGENTLOG.md
git commit -m "docs(agentlog): Directorio bloque 0 desplegado en dev

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin dev
```

---

## Self-review

**1. Cobertura de la spec**

| Spec | Tarea |
|---|---|
| §1 criterios: días sin bloqueo oculto; ningún 403; refresco entre módulos; fecha de Chile; pre-cierre no renombra; flota marcada | T1; T6-T7; T8-T9; T2; T4; T11 |
| §3 0.4 `LEFT JOIN` + `in_roster` (línea y reporte), grupo arriba con su motivo, mismo universo | T1 (R3) |
| §3 0.1 default `hoy_chile()`, solo metadato | T2 (R1), aplicada en T5 |
| §3 0.2 roster en vivo, conteos de `driver_compliance_status`, sin trigger ni `REFRESH` | T3 |
| §3 0.10 sin rama de renombres; reasignación de tractos y clientes intactos | T4 (R14) |
| §4 0.3 tabla de permisos, catálogo + sync, descripción de `directory.delete`, `PATCH` mixto exige ambos, botones con el mismo permiso, texto de Certificación | T6 (R8), T7 (R5, R6, R7) |
| §4 0.5 fábrica de claves, `invalidateDirectory(qc, change)` con destino, todas las mutaciones, solo lo afectado, Cierre con `refetchType: 'none'`, sin sondeos nuevos, clave unificada, test claves vs pantallas | T8 (R9, R11, R12) |
| §4 0.6 aviso y relectura de 15 s en `equipment-closures` y `cierre-viajes`, marca agregada si falta, aviso "El Cierre se actualizará…" | T9 (R4) |
| §4 0.7 confirmar Quitar, aviso al transferir, un diccionario con concordancia, sin "Inactiva" | T10 (R13) |
| §4 0.9 marca en tarjetas, vista rápida (sin "Activo"), búsqueda del Monitor; estado de la empresa en `entity-summary` y la búsqueda | T11 (R10) |
| §4 0.8 H2 y H4 | T12 (R15) |
| §6 pruebas (fallar antes, base real, `ZZ-TEST-DIRECTORIO`, por endpoint y por botón, `test_toda_ruta_declara_permiso`, test de claves, componentes, trinquetes, recorrido local, medición en dev, suite y build por despliegue) | cada tarea; T5; T13 |
| §7 reglas transversales | Global Constraints |
| §8 `admin` sin cambios | T6 (`test_fleet_status_lo_tienen_operaciones_y_el_supervisor_de_certificacion`) |

Sin huecos. Lo que se nombró y queda fuera está en R16.

**2. Placeholders.** Ninguno de los prohibidos. Tres pasos piden copiar una forma de montar desde el test vecino en lugar de transcribirla (`compliance/[carrierId]/page.test.tsx`, el armado de escalaciones en `PreCierrePendingSection.test.tsx`, el recorrido de transferir en `carriers/[id]/page.test.tsx`): nombran el test exacto del que se copia, y las aserciones están escritas completas.

**3. Tipos y nombres.** `in_roster` (back y front); `DIRECTORY_FLEET_STATUS`/`'directory.fleet_status'`; `DRIVER_/ASSET_/CARRIER_FIELD_PERMISSIONS`; `DirectoryEntity` (T8) usado por `statusLabel` (T10); `directoryKeys`, `DirectoryChange`, `invalidateDirectory`, `CLOSURE_ROOTS`, `CLOSURE_NOTICE` (T8) usados en T9-T11; `afterChange(change, done?)` (T8, ampliado en T9, usado en T10); `canChangeFleetStatus`, `canDeleteContacts`, `canDelete` (T7); `refetchWhilePending`, `REFETCH_WHILE_PENDING_MS`, `DirectoryNotice` (T9); `statusLabel` (T10); `isCarrierDeactivated`, `CARRIER_DEACTIVATED_LABEL`, `carrier_operational_status`, `carrierStatus` (T11); `pendingState`, `onRetryPending` (T12). Coinciden entre tareas.

**4. Review Focus.** Los cinco tienen su test en la tarea dueña: (1) T6 `test_un_cuerpo_mixto_del_operador_se_rechaza_entero_y_no_escribe`; (2) T8 `una transferencia invalida el roster de origen y el de destino`; (3) T1 `test_la_tabla_cuenta_lo_mismo_que_la_firma` + frontend `quien salió del roster aparece arriba…`; (4) T2 `test_a_las_2230_de_chile_la_asignacion_toma_el_dia_de_chile`; (5) T6 (permisos del Operador) + T7 (`el Operador ve la baja del conductor…`, `sin directory.edit el pre-cierre no ofrece…`) + T13 (recorrido sin 403).

**5. ¿Qué línea muere si se borra la implementación?** T1: `assert sale["driver"] in filas` (mutación en Step 5). T2: `"hoy_chile()" in default` por tabla (Step 6). T3: la tupla `(id, nombre nuevo, INACTIVE)` (Step 6). T4: `== "Ana"` (Step 6). T6: los 403/200 por rol (Step 8). T7: "Dar de baja" visible para el Operador (Step 8). T8: origen **y** destino; el recorrido de mutaciones (Step 6). T9: el caso nuevo del `parametrize` (`pendiente_desde` en la respuesta) y la segunda llamada a `equipmentClosuresApi.get`. T10: el diálogo antes de `onRemove`; `onTransfer('c2', 'Otra Empresa')`; `'Inactiva'` ausente del código. T11: `carrier_operational_status` y `carrier_id` en la búsqueda (Step 5). T12: el `alert` en lugar de la cifra; el esqueleto en lugar del texto.

## Decisiones del usuario sobre el plan (12/10)

- **R2 → el Cierre no estaba habilitado en julio y agosto.** Esos días abiertos no se van a firmar. El grupo "Ya no están
  en el roster" (Task de 0.4) se muestra solo en los días desde la puesta en marcha del Cierre, que se deriva de los
  datos: el primer día firmado (`min(app.closure_signatures.business_date)`, hoy 2026-09-03). Sin fecha fija en el código
  ni configuración nueva. La firma no cambia. La verificación del despliegue 1 mide los días bloqueados desde esa fecha.
- **R5 → excepción:** activar una empresa nueva (`ONBOARDING` → `ACTIVE`) sigue con `directory.edit` (Supervisor de
  Operaciones, desde el pre-cierre). Solo dar de baja y reactivar una empresa (`ACTIVE` ↔ `INACTIVE`) exigen
  `directory.delete`.
- **Ejecución:** subagent-driven.
