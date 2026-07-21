# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-22 — Ronda 38: bug crítico de cuadratura (conductores no resueltos), terminología "Por regularizar" y Fase 2 (alerta de póliza crítica en el Diario, HU-12)

**Bug real reportado por el usuario**: *"porque no se ven conductores/patente asignados si el diario está reportando viajes con conductores"*. `daily_closures.py`'s `day_trips` CTE solo miraba `trip_fleet_links.driver_id` — pero esa tabla no recibe filas nuevas desde 2026-07-19 para viajes que llegan del TMS (confirmado con `GROUP BY planning_date`: 0 filas en 07-19 a 07-22). Corregido replicando la misma cadena de resolución en vivo que ya usa `_TRIP_FROM`/`available_drivers` (stored link → auto-resuelto por patente → `vehicle_driver_assignments`), **más un 3er nivel nuevo**: match exacto de nombre contra `public.drivers.full_name` (confirmado con el usuario vía `AskUserQuestion` — mismo nivel de confianza que ya usa `trips.py` para mostrar nombres, no un fuzzy match nuevo). Verificado contra datos reales: 3 → 17 ASIGNADOS para 2026-07-21. Test de regresión agregado (`test_recompute_sql_uses_full_live_resolution_chain`). Commit `60085cc`.

**Riesgo estructural anotado, no resuelto**: la cadena de resolución (stored → auto-por-patente → auto-por-nombre) ahora vive duplicada en 3 lugares del SQL (`_TRIP_FROM`, `available_drivers`, `daily_closures.py`). Esta duplicación fue justamente la causa del bug — si vuelve a pasar, consolidar en una vista/función compartida en vez de seguir parcheando cada copia.

**Terminología corregida a pedido del usuario**: *"usar términos como mismatch está fuera de foco de lo que es la app"*. El enum interno (`DriverDayStatusValue.MISMATCH`) no cambia — solo la etiqueta visible al usuario, renombrada a **"Por regularizar"** (vocabulario de Pablo en la reunión: "regularizar la operación sin perder trazabilidad") en `CloseDayDialog.tsx` y `lib/utils/pivot.ts`.

**Fase 2 completa — Seguros↔Diario (HU-12)** (commit `6ed576c`): alerta prominente en el Diario cuando el transportista resuelto de un viaje tiene póliza vencida o cuotas críticas impagas.
- Backend: LATERAL join sobre `app.carrier_insurance_status` en `_TRIP_FROM`, regla del eslabón más débil (una empresa puede tener varias pólizas) — `EXPIRED` > `OVERDUE_INSTALLMENTS` (2+ cuotas impagas, umbral textual de Pablo) > `EXPIRING_SOON` > null. Filtro `?insurance_alert=` en `GET /trips` (alias real de la LATERAL join, no repite CASE como `fleet_match`). Verificado contra datos reales (`planning_date='2026-07-21'`) antes de codear tests.
- Frontend: `InsuranceAlertBadge.tsx` (nuevo, mismo patrón que `ComplianceBadge`) — badge compacto en `TripTable` (mobile card + desktop, junto a EETT) y banner prominente en `TripSlideOver` (junto al nombre de la empresa, solo para EXPIRED/OVERDUE_INSTALLMENTS).
- Verificación: 287/287 backend, 475/475 frontend, `tsc`/`build` limpios.

#### Próximo paso exacto
1. [ ] Push de los 2 commits pendientes (`60085cc`, `6ed576c`) a `origin/dev` — no hecho todavía, confirmar con el usuario.
2. [ ] Fase 3 (HU-05 gatillo desde alerta + HU-06 fuzzy match, diseño ya aprobado por Pablo: ~80% similitud + confirmación humana) — sin empezar.
3. [ ] Fase 4 (locales + sync recurrente Mage `bronze.raw_shipper_locations → public.locations`) — sin empezar, requiere tocar Mage.
4. [ ] Fase 5 (tarifario, módulo nuevo "Tarifario 1.0" separado en el menú) — sin empezar.
5. [ ] Confirmar con el usuario si Vercel sigue siendo un deploy target real o si `CLAUDE.md` debe actualizarse a Cloud Run como fuente de verdad (heredado, Ronda 34).
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
8. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
9. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
