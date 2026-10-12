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
