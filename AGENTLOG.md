# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-22 (cont.) — Ronda 41: Fase 5 — Tarifario 1.0 (HU-17), cierra el roadmap completo (Fases 0-5)

**Pedido del usuario**: *"pasa a la fase 5. Entiendes el concepto tarifario?"* — se explicó el concepto real (reunión del 20/07: tarifa por local + nombre favorito + origen + zona, ejemplo concreto de Pablo "CD Peñón → Tres Poniente") y se pasó por `superpowers:brainstorming` antes de codear, dado que era construcción nueva con varias decisiones de diseño abiertas.

**El alcance se recortó fuerte durante el brainstorming — 3 correcciones explícitas del usuario, en este orden:**
1. Sin lógica de rutas/alertas de cobertura: *"No implementemos nada de las tarifas. Está fuera del alcance del proyecto, solo agrega el módulo al sidebar y su page donde puedan poner el válido desde/hasta y un campo para definirlo."*
2. El campo de tarifa es **texto libre, no numérico** (se descartó el split numérico+notas que propuse): *"es que el tarifario va a depender del contexto del viaje"* — la tarifa real depende de contexto no modelado (tipo de carga, condiciones negociadas); imponerle estructura numérica sería falsa precisión.
3. Confirmó explícitamente **dos tablas separadas** (no columnas nuevas en `locations`) tras preguntarlo directamente — mismo patrón ya usado en el proyecto (`carriers`/`drivers`/`assets` vs. `compliance_records`/`insurance_policies`: entidad descriptiva actual vs. historial de eventos).

Spec final: `docs/superpowers/specs/2026-07-22-tarifario-design.md`. Plan: `docs/superpowers/plans/2026-07-22-tarifario-plan.md` (6 tareas, ejecutado inline en esta misma sesión, TDD en cada paso).

**Implementado** (commits `423bf08`, `ad51597`, `df4bc4e`, `a9e8ed3`, `c408c60`):
- Migración `public.location_rates` (`location_id` FK a `locations`, `tarifa` text, `valid_from`/`valid_to` date) — historial preservado, cada cambio es fila nueva, nunca se pisa una existente.
- Backend: `GET /locations?include_rate=true` (LEFT JOIN LATERAL a la fila vigente — `public.locations.id` sin alias, verificado en vivo antes de escribir el código), `GET/POST/PATCH /locations/{id}/rates`.
- Frontend: `LocationCreateForm.tsx` (nuevo) — se extrajo el formulario de alta de local de Configuración → Locales para reusarlo tal cual en la página nueva, sin duplicar (pedido explícito: *"el motor de update de public.locations también y al tarifario"*). Página `/dashboard/tarifario` (ítem nuevo y plano en el Sidebar, junto a Empresas/Seguros) — selector de generador de carga → tabla de locales con tarifa/vigencia editable inline, mismo patrón `useConfigList`/`useRowFeedback` que Configuración → Locales.
- **Explícitamente fuera de esta versión** (no es deuda, es la decisión tomada): campo "nombre favorito", origen como catálogo, cualquier alerta de "ruta sin tarifa", cualquier cálculo sobre la tarifa.
- Verificación: 305/305 backend, 496/496 frontend, `tsc`/`build` limpios (`/dashboard/tarifario` confirmado en el output del build).

**Esto cierra el roadmap completo del refinamiento de las 17 HU** (Fases 0 a 5, iniciado en Ronda 34 — ver `AGENTLOG_ARCHIVE.md`).

#### Próximo paso exacto
1. [ ] Push de los 6 commits pendientes a `origin/dev` — confirmar con el usuario.
2. [ ] Actualizar `AGENTLOG_ARCHIVE.md`/roadmap: no queda ninguna fase del plan original sin empezar — próximo trabajo debe salir de un pedido nuevo del usuario, no del roadmap de refinamiento.
3. [ ] (nuevo, no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run — siguen describiendo el flujo viejo de Vercel.
4. [ ] (nuevo, no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main`.
5. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
6. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
7. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
8. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
