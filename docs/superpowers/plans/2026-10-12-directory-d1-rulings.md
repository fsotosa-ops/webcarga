# Directorio D1 "Una sola respuesta": ledger de rulings y mutaciones (C-R17)

Plan: `docs/superpowers/plans/2026-10-12-directory-d1-one-answer.md`. Las rulings del controlador durante la
ejecución viven en `.superpowers/sdd/2026-10-12-directory-d1-one-answer/progress.md`; acá queda lo que el plan
pide registrar en el repositorio.

## Guardas de definición única (Task 10, 12/10)

`monitor-app/backend/api/tests/test_d1_single_definition_guards.py`. Topes medidos al cerrar la Task 9, todos
menores o iguales a la referencia previa a las T5-T7. Ninguno subió.

- `active_fleet`: la regla contaba `vehicle_driver_assignments` como asignación a la empresa (la subcadena
  `driver_assignments`) y marcaba el tracto habitual de `entity_summary.py` (C-R16, Task 7) como flota activa
  escrita a mano. Se corrigió la expresión (`\b` al inicio), no el tope; la guarda tiene una aserción que lo fija.
  Con eso `entity_summary.py` queda en 0.
- `mandatory_blocking` de `routers/trips.py` = 3 (Ruling F6): la lateral vieja que comparte el Cierre y
  `pending_mandatory` del embudo (`compliance.py`, R-E6) quedan con tope permanente.
- `tax_id_like` = 0 en todo `app/` (Task 9). `plate_trim` solo en `services/pre_cierre.py` (D3).
- La guarda mata: un `tax_id ILIKE` agregado a `carriers.py` pone en rojo
  `test_estado_habilitacion_e_identidad_solo_en_sus_duenos`.

## Mutación del despliegue 1 (spec §8.4)

Una a la vez, restaurada y verificada con `git diff` vacío.

1. **Por vencer bloquea la habilitación.** `fleet_compliance.py`: `_BLOQUEAN = _lista(BLOCKING_STATES + ("EXPIRING",))`
   (la constante compartida no se tocó). Corrida: `test_fleet_compliance_integration.py`,
   `test_d1_equivalence_integration.py`, `test_assignment_guard_integration.py` → 1 failed, 32 passed:
   `test_por_vencer_no_inhabilita`.
2. **El lote escribe a medias.** `trips.py` `assign_driver_bulk`: `if bloqueadas:` → `if False:` →
   `test_bulk_con_un_conductor_de_baja_no_escribe_nada` en rojo (1 failed, 16 passed).
3. **RUT sin canonizar.** `document_matcher.match_document`, rama de empresa: `if tax_id != rut:` →
   `test_rut_con_y_sin_puntos_encuentra_la_misma_empresa` en rojo (1 failed, 23 passed).

## Migración `20261013090000_directory_one_answer` (NOT NULL, Ruling T4-N)

Antes de aplicar se agregó `ALTER TABLE … ALTER COLUMN operational_status SET NOT NULL` en carriers, drivers y
assets (0 filas NULL el 12/10), con su test (`test_el_ciclo_de_vida_no_puede_quedar_vacio`).
Ensayo con ROLLBACK (MCP de Supabase, archivo pegado dos veces): sin error; `af_drivers` 85, `af_assets` 130,
conductores de empresas activas 78; `carrier_management_types` cambia 0 empresas ACTIVE y 1 no activa (A-R1, F5);
3 CHECK validados y 3 columnas NOT NULL. Nada quedó después del ROLLBACK.

Aplicada el 12/10 a las 16:41 (Chile), sin extracción en vuelo, sin transacciones largas, 2 min después de la
última escritura de Mage en `app.trips`. Mismas cifras fuera de la transacción. El MCP la registró con la versión
`20261012194100` (no la del nombre del archivo).

## Rendimiento, EXPLAIN ANALYZE después de aplicar (Execution Time; plan aparte)

| Consulta | Antes del fallback | Final |
|---|---|---|
| Directorio, filas (`list_carriers`) | 93-103 ms | 95-112 ms (plan 31-37) |
| Embudo (`/compliance-records/status`, carrier) | 266-276 ms | 154 ms (plan 51) |
| Pendientes, resumen por empresa | 210 ms | 212 ms |
| `_PENDING_ROWS_SQL` (cola global, `state=pending`) | 354 ms | 358 ms (SQL sin cambios de D1 salvo la cláusula de RUT de la T9) |
| `_attach_carrier_can_operate` (`carrier_compliance` filtrado por ids) | 81-105 ms | 84-88 ms (plan 23-25) |
| Guarda de asignación, `carrier_compliance` por id | 80 ms | 82 ms |

- **T6-X:** `app.carrier_of` dentro de `attributed` costaba ~125 ms extra (275 vs 150 ms, ~5.700 registros
  vigentes; la función tiene `SET search_path` y no se inlinea). Se aplicó el fallback de la Task 6: los dos
  LEFT JOIN con un comentario. Resultado idéntico (37 filas iguales).
- **T7-P:** `_attach_carrier_can_operate` suma ~110 ms en el servidor (plan + ejecución) más un viaje de red.
  Bajo el umbral de 150 ms.

## Despliegue 3 (Task 16): contraer

- **Retirado:** `compliance_health`, el filtro `health` de GET /carriers y sus facetas `pending`/`ok` (R-E7),
  `pending_mandatory` del Directorio y de los rosters (R-E6; se queda el de /compliance-records/status),
  `urgencia` de /pending (Pendientes agrupa sobre `document_state`), `funnel_group` con `'catalogo'` y
  `expired_count` (R-E12), `*_pending_docs_critical` de /trips (R-E13; se queda el del Cierre) y
  `alert_thresholds` de /trips/meta con la invalidación de su caché en el PATCH (R-E4).
- **T16-F:** el total del encabezado del embudo suma solo las empresas ACTIVE (= Pendientes). Producción tras el
  despliegue: embudo 2226 = Pendientes 2226 con 1 empresa en onboarding en la lista.
- **T16-CO:** sobre el SQL real del embudo (37 filas iguales en las tres variantes): LEFT JOIN 145-152 ms,
  `app.carrier_of` con `SET search_path` 270-277 ms, sin `SET search_path` 261-278 ms. `EXPLAIN VERBOSE` muestra
  la llamada a la función también sin el SET: Postgres no inlinea una función SQL escalar cuyo cuerpo tiene
  subconsultas. Se mantiene el fallback, con entrada `carrier_attribution_case` en la guarda y su motivo, y la
  función NO se redefinió (el cambio no daba el inline que lo justificaba y sumaba un aviso de search_path mutable).
- **Guardas:** backend `retired_fields` (campos retirados como alias o clave; topes permanentes: Cierre 1, R-E6 1),
  `carrier_attribution_case` (embudo 1, plantilla 1), `mandatory_blocking` de carriers.py a 0; frontend etiquetas
  `toEqual([])` y recálculo con el residuo R-E6 de CertificationStatusTable.tsx con motivo.
- **Migración `20261015090000_retire_per_document_alert_thresholds`:** ensayo con ROLLBACK: 1 fila
  (`documento_por_vencer` 30/0), 9 copias, segunda corrida sin duplicar. Aplicada el 12/10 a las 19:27 (Chile),
  después de Deploy Monitor API en verde, sin jobs de extracción en vuelo ni transacciones largas. Queda una fila
  (30/0) y 9 copias en audit_log (`ALERT_THRESHOLD`). El MCP la registró como versión `20261012222653`.
