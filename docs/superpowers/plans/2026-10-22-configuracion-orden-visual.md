# Configuración: orden visual, estándar y deuda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configuración se ve y se usa como el resto de la app (tabla del kit, formularios para valores sueltos, un contenedor), sin "Sin revisar", y cada cambio de un ajuste, una persona o un rol queda registrado y visible como "Última modificación".

**Architecture:** El marco declarativo se conserva (`dominios.ts` → `SettingsSource` → un componente que dibuja). `SettingsList` pasa a dibujar con `DataTable`/`TableToolbar`; un `SettingsForm` nuevo dibuja las fuentes de valores sueltos. En el backend, un servicio `config_changes` escribe en `public.audit_log` junto a cada `registrar_revision` existente (y en usuarios y roles), y un endpoint devuelve el último cambio por elemento.

**Tech Stack:** Next.js 16 + React + TanStack Query + vitest (frontend); FastAPI + asyncpg + pytest (backend, integración contra la copia local `.superpowers/local-sim`).

**Spec:** `docs/superpowers/specs/2026-10-22-configuracion-orden-visual-design.md`

## Global Constraints

- Español neutral, nunca voseo; cero emojis (solo `lucide-react`); nada bajo 11 px ni color crudo de Tailwind (`lib/ui/sistema.test.ts`, `escala.test.ts`).
- Nombres nuevos de archivos, funciones, componentes, claves JSON y API en inglés; textos de pantalla en español.
- Se conservan, por sección, todos los campos, validaciones (`validate`), permisos (`PERMISO_DE_SECCION`, `usePuedeEditarSeccion`) y acciones (crear, mover, desactivar/borrar) que hoy tiene.
- `app.config_reviews` no se borra y el backend la sigue escribiendo (`registrar_revision` no se toca); `revision.tsx` se queda (lo usan Documentos exigidos: `RequirementProfile`, `CondicionPanel`, `compliance/requirements/page.tsx`). Configuración solo deja de leerla.
- Fuera de alcance: reagrupar áreas, Facturación, Cmd+K, pantalla de historial, Documentos exigidos.
- Base real: ninguna migración prevista. Si alguna tarea la necesitara, ensayo con ROLLBACK y autorización explícita antes de aplicar.
- Antes de dar algo por listo: `npx vitest run <archivos tocados>` + `npx tsc --noEmit`; backend `venv/bin/python -m pytest <archivos>` con `sim.env` cargado. Suite completa solo al final (Task 9).

## Review Focus

1. Un formulario con cambios en dos filas (Umbrales) y una falla a mitad: lo guardado se dice guardado, lo que falló conserva lo escrito y su error — Task 6, test `guarda fila por fila y conserva lo que falló`.
2. Un ajuste con clave de texto (`stale_report_hours`, `refrigerado`, `documento_por_vencer`) en `audit_log.entity_id` uuid: dos elementos distintos nunca comparten id y el mismo elemento siempre da el mismo — Task 1, test `entity_uuid_es_estable_y_distinto`.
3. Una lista reordenable (motivos con Subir/Bajar) dentro del kit: el orden visible es el guardado y ordenar por columna no lo rompe — Task 5, test `con mover, el orden es el guardado y las columnas no ordenan`.
4. Personas tras un cambio (activar/desactivar, roles): la tabla muestra el dato nuevo sin recargar la página — Task 8, test `tras desactivar, la fila dice Inactivo sin recargar`.
5. Editar el rol A y pasar a editar el rol B: el formulario muestra B — Task 8, test `pasar de editar un rol a otro no hereda el formulario`.

---

### Task 1: Servicio y endpoint de cambios de Configuración (backend)

**Files:**
- Create: `monitor-app/backend/api/app/services/config_changes.py`
- Modify: `monitor-app/backend/api/app/routers/config.py` (endpoint de lectura)
- Test: `monitor-app/backend/api/tests/test_config_changes_integration.py`

**Interfaces:**
- Produces:
  - `entity_uuid(area: str, section: str, element_id: str) -> str` — `md5(area/section/element_id)` con formato uuid (precedente: `md5(...)::uuid`).
  - `async registrar_cambio(pool_or_conn, *, actor: str, area: str, section: str, element_id: str, action: str, before: dict | None, after: dict | None) -> None` — escribe con `services.audit.log_change`: `entity_type = f"config:{area}/{section}"`, `entity_id = entity_uuid(...)`, `field = None`, `old_value = before`, `new_value = {**(after or {}), "element_id": element_id}`, `source = "config"`. `action` ∈ `"create" | "update" | "move" | "delete"`.
  - `GET /config/changes?area=&section=` → `[{ "element_id": str, "actor_name": str | null, "changed_at": iso str }]`, el último cambio por elemento (`DISTINCT ON (new_value->>'element_id')` sobre `entity_type = 'config:area/section'`, nombre desde `public.profiles.full_name`). Permiso: el mismo de leer la sección (`exigir_seccion` de `services/revisiones`, como `config_reviews.list_reviews`).

- [ ] **Step 1: Write the failing tests** — `test_entity_uuid_es_estable_y_distinto` (mismo trío → mismo uuid; cambiar cualquiera de los tres → distinto; formato `uuid.UUID(x)` válido); `test_registrar_y_leer_el_ultimo_cambio` (dos cambios del mismo elemento con actores distintos → el endpoint devuelve solo el segundo, con `actor_name` y `element_id`); `test_cambios_exige_permiso_de_la_seccion` (sin permiso → 403). Integración con `conexion_revertida`, como `test_closure_report_population_integration.py`.
- [ ] **Step 2: Run to verify RED** — `bash -c 'set -a; . ../../../.superpowers/local-sim/sim.env; set +a; venv/bin/python -m pytest tests/test_config_changes_integration.py -q'` (desde `monitor-app/backend/api`). Expected: FAIL, `ModuleNotFoundError: app.services.config_changes`.
- [ ] **Step 3: Implement** `config_changes.py` y el endpoint.
- [ ] **Step 4: Run to verify GREEN** — mismo comando. Expected: 3 passed.
- [ ] **Step 5: Commit** — `feat(configuracion): registro de cambios de Configuración en audit_log`.

### Task 2: Registrar cambios en catálogos, umbrales y rangos (backend)

**Files:**
- Modify: `app/routers/config.py` (statuses patch/move; alert-thresholds patch; temperature-ranges create/patch/delete; monitor-alert-rules patch), `app/routers/status_taxonomies.py` (create/patch/move/delete)
- Test: `tests/test_config_changes_integration.py` (agregar)

**Interfaces:**
- Consumes: `registrar_cambio` (Task 1).
- Regla: junto a cada `registrar_revision` existente (y en los que no la tienen: `move_*`, `delete_*`), llamar `registrar_cambio` con `before` = los campos que cambian leídos ANTES del UPDATE y `after` = los mismos campos después. Reglas del Monitor: `element_id` = la clave de la regla (`stale_report_hours`, …), uno por regla cambiada (no `'reglas'`). Taxonomías: `area/section` desde `SECCION_DE_TAXONOMIA` (como `_registrar`).

- [ ] **Step 1: Write the failing tests** — `test_patch_status_registra_antes_y_despues` (cambia `label` → una fila en `audit_log` con `old_value.label` viejo y `new_value.label` nuevo); `test_taxonomia_crear_y_desactivar_registran` (create → `action='create'`, delete → `action='delete'`); `test_regla_del_monitor_registra_por_regla` (patch de `dwell_red_min` → `new_value.element_id == 'dwell_red_min'`). Llamar a las funciones del router con el pool de la conexión revertida, como los tests existentes de `config.py` (buscar el patrón en `tests/` con `grep -l "patch_status\|patch_taxonomy" tests`).
- [ ] **Step 2: RED** — Expected: FAIL, 0 filas en `audit_log`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN** — los 3 nuevos + `tests/test_config*.py tests/test_status_taxonomies*.py` verdes.
- [ ] **Step 5: Commit** — `feat(configuracion): cada ajuste guardado queda en el registro de cambios`.

### Task 3: Registrar cambios de Personas y Roles (backend)

**Files:**
- Modify: `app/routers/users.py` (create, patch, delete), `app/routers/access.py` (roles post/patch/delete, `put_user_roles`)
- Test: `tests/test_access_changes_integration.py`

**Interfaces:**
- Consumes: `registrar_cambio` (Task 1).
- `area/section`: personas → `people/users`, `element_id` = id del usuario; roles → `people/roles`, `element_id` = id del rol. `put_user_roles` es un cambio de la PERSONA (`people/users`, `before/after = {"roles": [...]}`). Los permisos de un rol van en `before/after = {"permissions": [...]}`. Nunca se escribe una contraseña ni un token en `before/after`.

- [ ] **Step 1: Write the failing tests** — `test_cambiar_roles_de_una_persona_queda_registrado` (roles antes y después, actor); `test_editar_permisos_de_un_rol_queda_registrado`; `test_invitar_no_registra_secretos` (el `new_value` de create no tiene claves `password`, `token`, `link`).
- [ ] **Step 2: RED.** Expected: FAIL, 0 filas.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN** — nuevos + `tests/test_users*.py tests/test_access*.py` verdes.
- [ ] **Step 5: Commit** — `feat(accesos): invitar, cambiar roles y editar un rol quedan registrados`.

### Task 4: "Última modificación" en el frontend

**Files:**
- Modify: `monitor-app/frontend/lib/api/config.ts` (`changesApi`)
- Create: `monitor-app/frontend/app/dashboard/admin/settings/LastChange.tsx` (+ `LastChange.test.tsx`)

**Interfaces:**
- Produces:
  - `changesApi.list(area: string, section: string): Promise<{ element_id: string; actor_name: string | null; changed_at: string }[]>`
  - `useLastChanges(area: string, section: string): { of: (elementId: string) => { actorName: string | null; changedAt: string } | undefined; isPending: boolean; invalidate: () => void }` — query key `['config-changes', area, section]`.
  - `<LastChange change={...|undefined} pending={boolean} />` — con cambio: "Última modificación: {nombre o 'Sistema'}, dd/mm/aaaa"; sin cambio: "Sin cambios registrados desde el 22/10/2026" (constante `CHANGES_SINCE = '2026-10-22'` en `LastChange.tsx`, la fecha de puesta en marcha; ajustarla al desplegar si cambia); mientras carga: nada (no afirmar).

- [ ] **Step 1: Failing tests** — los tres estados de `LastChange` con sus textos exactos.
- [ ] **Step 2: RED** — `npx vitest run app/dashboard/admin/settings/LastChange.test.tsx`. Expected: FAIL (no existe).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** — `feat(configuracion): Última modificación de un ajuste`.

### Task 5: Las listas con la tabla del kit, sin "Sin revisar"

**Files:**
- Modify: `app/dashboard/admin/settings/settings-sources.tsx` (contrato), `SettingsList.tsx`, `SettingsList.test.tsx`
- Create: `monitor-app/frontend/components/ui/Card.tsx` (+ test) — la tarjeta de contenido: `bg-white rounded-2xl border border-border shadow-sm p-4 md:p-5` (la misma que envuelve la Flota del día).

**Interfaces:**
- Consumes: `useLastChanges`, `LastChange` (Task 4).
- Contrato `SettingsSource` (cambia): `columns: { id: string; header: string; value: (row: Row) => string | null; cell?: (row: Row) => ReactNode }[]` (`value` alimenta búsqueda, filtro y orden del kit; `cell` es el dibujo, por defecto el valor). Se quitan `filters` y `revisionId` (las secciones que filtraban por etapa o "Qué significa" lo hacen con el filtro de esa columna; su `value` es la etiqueta). Agregar `kind?: 'list' | 'form'` (por defecto `'list'`).
- `SettingsList`: `Card` > `TableToolbar` (buscador "Buscar…", "+ Filtro", Columnas sin preferencias guardadas; `actions` = botón del kit `Button variant="primary"` "+ Nuevo {noun}" si `create` y `puedeEditar`) > `DataTable`. Última columna `open` (no ocultable, no ordenable): el botón chevron "Abrir {title}". Vista en la URL con `useUrlView` (convive con `?item=`). Con `move`: todas las columnas `sortable: false` y filas en el orden de `list()`. Sin columna ni pestaña de revisión.
- `PanelElemento`: quitar `MarcaDeRevision` y `BotonConfirmar`; arriba `LastChange` del elemento; el botón "Guardar" del pie siempre visible, deshabilitado sin cambios; tras guardar, `invalidate()` de cambios y "Guardado" por 2 s.

- [ ] **Step 1: Failing tests** (en `SettingsList.test.tsx`, reemplazando los de revisión): `no muestra Sin revisar ni la columna Revisión`; `la barra del kit filtra por la columna Qué significa`; `con mover, el orden es el guardado y las columnas no ordenan`; `el panel muestra Última modificación y Guardar deshabilitado sin cambios`; `+ Nuevo va en la barra y solo con permiso de edición`. Y `Card.test.tsx`: dibuja sus hijos dentro de la tarjeta.
- [ ] **Step 2: RED** — `npx vitest run app/dashboard/admin/settings/SettingsList.test.tsx components/ui/Card.test.tsx`.
- [ ] **Step 3: Implement** contrato, `SettingsList`, `Card`, y adaptar todas las fuentes de `settings-sources.tsx` al contrato nuevo (cada `columns` con `id` y `value`).
- [ ] **Step 4: GREEN** + `npx vitest run app/dashboard/admin/settings` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(configuracion): las listas usan la tabla del kit; sale Sin revisar`.

### Task 6: Formulario para valores sueltos

**Files:**
- Create: `app/dashboard/admin/settings/SettingsForm.tsx` (+ `SettingsForm.test.tsx`)
- Modify: `paneles.tsx` (Alertas de vencimiento ×2 y Umbrales con `SettingsForm`; `SECCIONES_CON_LISTA` sin ellas), `settings-sources.tsx` (`kind: 'form'` en `thresholdSource` y `monitorRulesSource`)

**Interfaces:**
- Consumes: el contrato de Task 5, `useLastChanges`/`LastChange` (Task 4), `Card` (Task 5).
- `SettingsForm<Row>({ source })`: dentro de `Card`, por cada fila de `list()`, su título (`title(row)`) y sus `fields(row)` con su `help`; las claves del estado se separan por fila (`${row.id}.${key}`). Pie: `LastChange` del último cambio entre las filas, "Descartar" y "Guardar cambios" (primario), ambos deshabilitados sin cambios o sin permiso. `validate(values, row)` por fila, mostrado bajo esa fila. Guardar llama `source.save(row, cambiosDeLaFila)` fila por fila en orden; las que fallan conservan lo escrito y muestran su error; las guardadas salen del estado sucio. Mensaje "Guardado" al terminar sin errores.
- Aviso al salir con cambios: `beforeunload` mientras haya cambios; y `useUnsavedChanges(dirty: boolean)` en un módulo pequeño (`app/dashboard/admin/settings/unsavedChanges.ts`) que `SettingsIndex` consulta en el clic de sus enlaces (`window.confirm('Tienes cambios sin guardar. ¿Salir igual?')`).

- [ ] **Step 1: Failing tests**: `muestra cada regla con su campo y su ayuda`; `Guardar cambios está deshabilitado sin cambios`; `valida por fila: el crítico tiene que ser menor que el aviso`; `guarda fila por fila y conserva lo que falló`; `Descartar vuelve a los valores guardados`; `con cambios, salir desde el índice pide confirmación`; `sin permiso de edición los campos van deshabilitados`. Y en `dominios.test.ts`: `cada sección dibuja su tipo de página` (recorre `DOMINIOS`: las de formulario son exactamente `certification/expiry-alerts`, `insurance/expiry-alerts` y `operations/alert-thresholds`; el resto, lista o Personas/Roles).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(configuracion): umbrales y alertas se editan en un formulario`.

### Task 7: Índice sin números de revisión

**Files:**
- Modify: `SettingsIndex.tsx`, `SettingsIndex.test.tsx`

- [ ] **Step 1: Failing test**: `el índice no muestra números ni la frase de revisión` (con un `inventarioApi` que devuelve pendientes, no aparece ningún número ni "El número es lo que falta revisar").
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — quitar la consulta `config-inventario`, los números y la frase; el `aria-label` es el título.
- [ ] **Step 4: GREEN.**
- [ ] **Step 5: Commit** — `feat(configuracion): el índice queda limpio`.

### Task 8: Personas y Roles en el mismo marco

**Files:**
- Modify: `app/dashboard/admin/settings/usuarios-tab.tsx`, `components/admin/UsersTable.tsx` (+ tests), `app/dashboard/admin/settings/roles-tab.tsx` (+ test)

**Interfaces:**
- Consumes: `Card` (Task 5), `useLastChanges`/`LastChange` (Task 4).
- Personas: datos con React Query (`['users']`, `['access-roles']`, `['access-permissions']`), sin copia en estado; cada mutación invalida `['users']` y `['config-changes','people','users']`. La tabla pasa a `DataTable`/`TableToolbar` (columnas Persona, Roles, Estado, Acceso; filtros de columna en lugar de las pestañas "Administran/Activos/Inactivos"; "Invitar persona" en `actions`). El editor de una persona muestra `LastChange`. A 390 sin desplazamiento de página (roles se envuelven en la celda).
- Roles: `FormularioDeRol` con `key={modo.rol?.id ?? 'nuevo'}`; el texto "Los de sistema vienen con la app…" pasa a la cabecera de la lista de roles dentro de la `Card`; "+ Crear rol" con `Button variant="primary"` en esa cabecera; el detalle muestra `LastChange`.

- [ ] **Step 1: Failing tests**: `tras desactivar, la fila dice Inactivo sin recargar`; `las pestañas pasan a filtro de Estado del kit`; `pasar de editar un rol a otro no hereda el formulario`; `el detalle del rol muestra Última modificación`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(configuracion): Personas y Roles con la tabla del kit y su historial`.

### Task 9: Verificación completa, humo y registro

- [ ] **Step 1:** `npx vitest run && npx tsc --noEmit && npm run build` (frontend) y la suite backend contra la copia local. Expected: todo verde.
- [ ] **Step 2:** Revisión final de la rama (un revisor nuevo, el modelo más capaz).
- [ ] **Step 3:** Push a `dev`; cuando el usuario avise que desplegó: humo con Playwright en las 17 secciones a 1440 y 390 (sin desplazamiento horizontal; captura junto a la Flota del día), guardar un umbral y ver "Última modificación", y confirmar en `audit_log` la fila (lectura).
- [ ] **Step 4:** Actualizar `AGENTLOG.md` (qué se hizo, siguiente paso, decisiones) y mover a `AGENTLOG_ARCHIVE.md` lo que quede cerrado.
