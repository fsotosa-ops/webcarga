# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.
> (Rondas 51-54 — Centro de Flota, feedback post-deploy, auto-clasificación de zona, HU-18/24 — archivadas al cerrar la Ronda 55.)

### 2026-07-28 (cont.) — Ronda 55: cierre de ítem heredado #15 (verificado contra datos reales) + nomenclatura confirmada para el hub `/dashboard/operaciones`

**Ítem heredado "barrer `source_client` dentro de `qanalytics`" — CERRADO, verificado contra datos reales**: `pipeline_list` (Mage) + `execute_sql` (Supabase) confirman que hoy `bronze.tms_trips_snapshot` solo tiene dos valores de `source_client` bajo `tms_name='qanalytics'` — `walmart` (16.465 filas) e `iansa` (170 filas) — y que IANSA ya corre por un branch de pipeline propio y separado (`qanalytics_endpoint_scraper_iansa` → `insert_raw_tms_iansa_trips_qanalytics`), no mezclado con el scraper genérico de walmart. No hay evidencia de un tercer cliente "tipo IANSA" escondido en los datos actuales. Se da de baja del checklist.

**Los otros 3 ítems heredados siguen abiertos, verificados en el momento**: #16 (dbt en git) — no existe `dbt_project.yml` en el repo, sigue sin decisión; #17 (retirar bloques legacy de `legacy_drivers_transporters`) — `snapshot_transporters_data`/`webapp_transporter_porfiles` siguen presentes y cableados en el pipeline en vivo; #18 (`ops.pipeline_rejects`/`ops.pipeline_runs`) — siguen sin auditar, con 515 y 5 filas respectivamente.

**Nomenclatura confirmada por el usuario para el hub de `/dashboard/operaciones`** (dirección de producto ya capturada en Ronda 47, sin spec todavía — ver ítem 5 del checklist): el módulo unificado se llama **"Operaciones"**; el actual **"Diario" pasa a llamarse "Monitor"**; la actual **"Reportería" pasa a llamarse "Cierres"** (no "Cuadratura" — ese nombre ya fue usado y descartado para el cierre puntual de un día, spec `2026-07-21-cuadratura-reporteria-redesign-design.md`, reemplazado por el overlay "Cerrar el día"; reusarlo generaba ambigüedad histórica).

**Spec escrito y commiteado**: `docs/superpowers/specs/2026-07-28-operations-routes-normalization-design.md` (vía `superpowers:brainstorming`). Cubre no solo el hub sino también la normalización de slugs de Empresas/Seguros/Tarifario a inglés (`carriers`/`insurance`/`pricing` — coincide con vocabulario ya usado en el dominio interno; "pricing" en vez de "rates"/"tariffs" porque el módulo va a crecer más allá de tarifas). Decisiones clave: slugs de URL en inglés, labels visibles siguen en español; corte limpio sin redirect legacy en las rutas viejas (404 si se visitan); NO se tocan identificadores internos de código (`useDiarioFilters`, etc.) ni los valores de `?tab=seguros/conductores/...` de la ficha de carrier — ambos quedan explícitamente pendientes para otra iteración (ver checklist). Contenido/funcionalidad de "Cierres" (el pivot de Reportería) no cambia en este spec — el rediseño real con 3 formatos fijos por cliente es un **Spec 2 aparte**, bloqueado por el diseño de `app.equipment_day_status`.

**Plan escrito**: `docs/superpowers/plans/2026-07-28-operations-routes-normalization-plan.md` (8 tasks TDD, vía `superpowers:writing-plans`). **Implementado completo, vía `superpowers:executing-plans` (modo inline, pedido explícito, directo sobre `dev` sin worktree — también pedido explícito)**:
1. Rutas movidas: `diario`→`operations/monitor`, `diario/reporteria`→`operations/closures`, `transportistas`(+`empresa/[id]`)→`carriers`(+`[id]`), `seguros`→`insurance`, `tarifario`→`pricing`. Corte limpio confirmado: las rutas viejas ya no existen en el `route manifest` de `npm run build`.
2. Sidebar (`Sidebar.tsx`): grupo "Operaciones" (Monitor/Cierres) + `NAV_ITEMS` (Empresas/Seguros/Tarifario apuntando a los slugs nuevos, labels visibles sin cambios).
3. Entry points de auth actualizados (`proxy.ts`, `auth/callback`, `admin/layout` guard, `LoginForm`, `RegisterForm`, `ResetPasswordForm`, `app/page.tsx`).
4. 13 archivos de deep-links internos actualizados (`CloseDayDialog`, `TransporterSlideOver`, `TripAssignDialog`, `TripSlideOver` + sus tests, `TransporterCard`, comentarios en `seguros`/`carriers` pages) — los valores de `?tab=seguros/conductores` quedan sin cambios (ítem 18 del checklist).
5. `scripts/demo.spec.ts` actualizado a las rutas nuevas.

**Verificación**: frontend 557/557 (63 archivos), `tsc --noEmit` limpio, `npm run build` exitoso — el route manifest confirma exactamente las rutas esperadas y ninguna vieja. Click-through en vivo con Playwright no se pudo completar: la contraseña demo en `.env.local` de este sandbox es un placeholder (`"changeme"`), no una credencial real — confirmado que es un gap de configuración local, no un bug (la app respondió correctamente con "Credenciales incorrectas"). **Pusheado a `origin/dev`** (10 commits, `f39f86a..f049761`).

#### Próximo paso exacto
1. [ ] HU-20: validar con negocio si "Póliza de Seguro Vigente" (RC) debe rediseñarse como se propuso en Ronda 54 (ocultar `INSURANCE_POLICY`, activar `SEGURO_RC_EMPRESA`) — bloqueado hasta esa confirmación, no tocar `compliance_requirements`/Mage para este campo mientras tanto.
2. [ ] HU-24: decisión de negocio sobre "Control Documental Mensual" (`CONTROL_MENSUAL_COL_T`) — mantener, reformular o eliminar (0% completado en 118 registros desde su creación).
3. [ ] Ronda 54 quedó sin verificación visual en navegador (limitación de red del sandbox, ver detalle arriba) — hacer una pasada rápida en el entorno real: ficha de Empresa (Roll SII visible, RIOHS ya no duplicado) y ficha de Vehículo RAMPLA vs. TRACTOCAMION (Seguro de Carga en ambos, Cámara Frío/Resolución Sanitaria solo en RAMPLA).
4. [ ] Confirmar con el cliente a qué campo se refiere "LSS" — único punto sin resolver de los 10 criterios duros de Hito 3.
5. [x] Rediseño de navegación del hub Operaciones — **CERRADO E IMPLEMENTADO (Ronda 55)**: spec + plan + implementación completa, pusheada a `origin/dev`. Rutas nuevas: `/dashboard/operations/{monitor,closures}`, `/dashboard/{carriers,insurance,pricing}`. Falta una pasada visual en el entorno real (login no se pudo probar en este sandbox, ver detalle en la Ronda 55) — recomendable antes de dar el click-through por confirmado al 100%.
6. [ ] Diseñar (spec nuevo) `app.equipment_day_status` — desbloquea el rediseño real de "Cierres" (ex-Reportería; 3 formatos fijos según mockups de Figma, refinamiento v2 ítem 6). Distinto del "Centro de Flota" de la Ronda 51, que usa disponibilidad calculada en vivo, no un modelo persistido por día.
7. [ ] Evaluar si "Centro de Flota" pasa a ser módulo de navegación de primer nivel (con espacio para alertas de póliza/documentación de equipo) — explícitamente dejado fuera de la Ronda 51.
8. [ ] (opcional, negocio) Si se quiere que "Conductor habitual" deje de estar casi siempre vacío en Centro de Flota, hace falta que operaciones cargue `vehicle_driver_assignments` equipo por equipo desde la ficha de cada empresa (`VehicleDetailPanel.tsx`) — no es una tarea de desarrollo.
9. [ ] Borrar a mano en la UI de Mage el bloque `wingsuite_has_new_data` (desconectado).
10. [ ] Revisar en la UI de Mage por qué `centralizer_eett_sharepoint`/`load_compliance_records_08` siguen en `status: failed` (no bloqueante, datos fluyen igual).
11. [ ] Tarea 9 de status_taxonomies (DROP tablas legacy) — diferida, gated por tiempo en producción + confirmación explícita del usuario.
12. [ ] Ítem 1b — pendiente de que el usuario confirme el rol de los usuarios que no pueden subir documentación.
13. [ ] (no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run.
14. [ ] (no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main`.
15. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
16. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
17. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
18. [ ] Normalizar a inglés los valores de `?tab=seguros/conductores/equipos/...` y el `type Tab` interno de `carriers/[id]/page.tsx` — deferido explícitamente del spec de Ronda 55 (mismo blast radius de ~32 archivos que ya se evitó para el hub), decisión del usuario de dejarlo para otra iteración.
