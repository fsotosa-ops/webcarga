# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-22 (cont.) — Ronda 39: Fase 3 — fuzzy match de conductor (HU-06) + gatillo de alta (HU-05), y Vercel vs. Cloud Run confirmado

**Confirmación del usuario**: *"estamos operando en cloud run"* — cierra el ítem heredado desde Ronda 34. `CLAUDE.md` actualizado: tabla de servicios y sección de deploy del frontend corregidas (era Vercel, es Cloud Run, `webcarga-frontend-dev` confirmado vía `gcloud run services list --project=webcarga-dev-493220`). **No confirmado todavía**: `webcarga-frontend-prod` no aparece en el listado — no se sabe si ya hubo un primer deploy a `main`. Los skills `/deploy`/`/check-env` (`monitor-app/.claude/commands/`) siguen describiendo el flujo viejo de Vercel — marcados como desactualizados en `CLAUDE.md`, no reescritos todavía (fuera del pedido de esta ronda).

**Fase 3 completa** (commit `9115a55`), sobre la decisión ya confirmada en Ronda 35 (HU-04/05: solo alertar, resolución manual — sin auto-creación):
- **HU-06 (fuzzy match, diseño ya aprobado por Pablo — ~80% similitud + confirmación humana)**: `GET /drivers/fuzzy-match?name=` nuevo, `pg_trgm` habilitado (`CREATE EXTENSION` + índice GIN sobre `public.drivers.full_name`, migración `enable_pg_trgm_drivers_fuzzy_match`). Limpia RUT/puntuación que el TMS adjunta al nombre antes de comparar. **Umbral calibrado en 0.7 contra nombres reales** de viajes UNMATCHED (no el 0.8 literal que dijo Pablo): coincidencias legítimas con typos o nombre incompleto cayeron en 0.75-0.87, ruido se mantuvo bajo 0.30 — 0.7 da margen sin acercarse a la zona de ruido, y la confirmación humana sigue siendo obligatoria en cualquier caso, así que un candidato de más no vincula nada por sí solo.
- **HU-05 (gatillo "crear desde esta alerta")**: en `TripSlideOver`, la sección "Conductor y flota" sin vincular ahora muestra el nombre TMS reportado + los candidatos fuzzy (si hay) + un CTA explícito "Sin coincidencias — dar de alta en Empresas" cuando no hay ninguno (antes ese aviso solo aparecía si el operador ya había tipeado algo en la búsqueda manual).
- Frontend: `DriverPickCandidate.similarity` opcional, badge de % en `DriverSearchPicker` (solo se muestra si el candidato lo trae — nunca en búsqueda manual).
- Verificación: 290/290 backend, 480/480 frontend, `tsc`/`build` limpios.

#### Próximo paso exacto
1. [ ] Push del commit pendiente (`9115a55`) a `origin/dev` — no hecho todavía, confirmar con el usuario.
2. [ ] Fase 4 (locales + sync recurrente Mage `bronze.raw_shipper_locations → public.locations`) — sin empezar, requiere tocar Mage.
3. [ ] Fase 5 (tarifario, módulo nuevo "Tarifario 1.0" separado en el menú) — sin empezar.
4. [ ] (nuevo, no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run — hoy describen el flujo viejo de Vercel.
5. [ ] (nuevo, no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main` o si `main` todavía no se usa como rama de producción real.
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
8. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
9. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
