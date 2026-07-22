# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-22 (cont.) — Ronda 40: documentación conductor/tracto/empresa en el Diario (catch-up post-Fase 2) + Fase 4 (auto-registro de locales, HU-15/16)

**Pregunta del usuario**: *"porque solo se ven las alertas de seguros en el diario y no está integrado lo asociado a la documentación de los carriers, drivers y vehicles?"* — hallazgo real, no percepción: `TripTable.tsx` tenía badges de compliance ya construidos (`plateAlert`/`driverAlert`, componente `ComplianceBadge`) pero **muertos** — alimentados por un `alertSummary` que nunca se poblaba desde que se borró el endpoint viejo (`GET /transporters/compliance-alerts/summary`, Checkpoint A-E). El propio plan de Fase 2 incluía "cierre de HU-09 en UI" y solo se entregó HU-12 (Seguros).

**Hallazgo bloqueante antes de codear**: contra datos reales, el **100% de conductores/tractos/empresas** tiene al menos 1 documento LEGAL_MANDATORY pendiente hoy (misma consulta que ya usa Empresas). Un badge binario ok/vencido saturaría cada fila del Diario. Confirmado con el usuario vía `AskUserQuestion` → **consolidado de N documentos pendientes**, con Licencia de Conducir/Carnet del conductor marcados "críticos" (pedido explícito), recalculado en cada request (sin cache, baja solo cuando se sube documentación real).

**Implementado** (commit `0b02650`):
- Backend: `_compliance_alert_lateral()` en `trips.py` — 3 LATERAL joins (conductor/tracto/empresa) contra `public.compliance_records`, misma cadena de resolución que `insurance_alert`. Expone `{driver,tractor,carrier}_pending_docs` (int) + `_critical` (bool, solo conductor: `LICENCIA_CONDUCIR`/`COPIA_CI_CONDUCTOR`). `NULL` explícito cuando el dominio no tiene ID resuelto (no confundir con "0 pendientes").
- Frontend: `PendingDocsBadge.tsx` (nuevo) reemplaza el `ComplianceBadge` muerto en `TripTable.tsx`; banner rojo en `TripSlideOver.tsx` solo para el caso crítico. `alertSummary`/`ComplianceAlertSummary` (dead code) eliminados de `TripTable.tsx`/`diario/page.tsx`.
- Verificación: 295/295 backend, 486/486 frontend, `tsc`/`build` limpios.

**Fase 4 completa — locales (HU-15/16)** (commit `8e1dc19`): confirmado con el usuario vía `AskUserQuestion` que el mecanismo correcto es un **trigger de Postgres** (mismo patrón que `trg_reconcile_new_driver/_carrier/_asset`), no el sync recurrente de Mage contra la planilla oficial que planteaba el roadmap original — no requiere la ruta de SharePoint del archivo (que no tenía) y cubre tanto la ingesta TMS (dbt) como la creación manual de viajes.
- `trg_reconcile_new_trip_stop_location` (`app.trip_stops`, AFTER INSERT, solo `stop_type='DESTINATION'` — el ORIGIN casi siempre es un CD, no un local de cliente): siembra un local incompleto en `public.locations` cuando el TMS reporta un destino sin cruce contra la planilla oficial. Backfill: **259 combos** (generador de carga, local) históricos confirmados sin fila — verificado con dry-run antes de aplicar.
- "Incompleto" se deriva de `operation_type IS NULL` (mismo campo que ya decide "Sin clasificar" en el Diario) — sin columna nueva.
- `?incomplete=true` en `GET /locations` + banner de conteo global y checkbox de filtro en Configuración → Locales, con highlight de filas sin clasificar.
- **Deuda de proceso corregida en el camino**: la migración de `pg_trgm` de la Fase 3 se había aplicado en vivo vía `apply_migration` pero nunca se comiteó como archivo local — respaldada ahora (`20260721233328_enable_pg_trgm_drivers_fuzzy_match.sql`).
- Verificación: 297/297 backend, 486/486 frontend, `tsc`/`build` limpios.

**Vercel vs Cloud Run**: confirmado por el usuario en la ronda anterior, `CLAUDE.md` ya actualizado — sin pendientes acá.

#### Próximo paso exacto
1. [ ] Push de los 3 commits pendientes (`0b02650`, `8e1dc19`, y el de compliance) a `origin/dev` — confirmar con el usuario.
2. [ ] Fase 5 (tarifario, módulo nuevo "Tarifario 1.0" separado en el menú, tabla `rate_card` con `valid_from/valid_to`) — sin empezar, última fase del roadmap.
3. [ ] (nuevo, no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run — siguen describiendo el flujo viejo de Vercel.
4. [ ] (nuevo, no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main`.
5. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
6. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
7. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
8. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
