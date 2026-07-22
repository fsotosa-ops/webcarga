# Rediseño: "Cerrar el día" + Reportería (reemplaza la página de Cuadratura)

## Contexto

La primera versión de "Cuadratura del día" (`/dashboard/diario/cuadratura`, Fase 1/1.5 del plan de refinamiento del backlog de 17 HU) se implementó como una página aislada, con su propio date picker y un `<select>` "Por conductor/Por empresa/Por cliente" para agrupar. El usuario la rechazó explícitamente: *"no me cierra que la cuadratura funcione así... ese dropdown no me dice nada y la UI es horrible"*.

Tras una sesión de brainstorming, se identificaron **dos necesidades distintas mezcladas en una sola pantalla**:

1. Una acción operativa rápida — *cerrar el día* — que debe vivir dentro del Diario, en el contexto de lo que el operador ya está mirando.
2. Una vista analítica/BI — *ver el global de la operación en el tiempo* — que necesita la flexibilidad de una tabla dinámica real, y no tiene sentido acotada a un solo día.

Este spec reemplaza la página de Cuadratura por estas dos superficies.

## Alcance

- Elimina `/dashboard/diario/cuadratura` (page.tsx + page.test.tsx) tal como existe hoy.
- Agrega un overlay "Cerrar el día" lanzado desde un botón en el Diario.
- Agrega una página nueva "Reportería" (`/dashboard/diario/reporteria`), hermana de Diario dentro del grupo "Monitor de Viajes" del Sidebar.
- El backend de `daily_closures.py` (GET/PATCH/POST) se **reusa sin cambios** para el overlay de cierre.
- Se agrega un endpoint nuevo (rango de fechas) para alimentar Reportería.

Explícitamente fuera de alcance de este spec (quedan como fast-follow, ver "Gaps conocidos" más abajo): categorías de tipo de equipo específicas de Walmart (Equipo Completo/Tracto-Región/Z0/Se retira sin carga) y agrupación por zona/región de destino.

## A. "Cerrar el día" — overlay dentro del Diario

**Disparador**: un botón (ej. "Cerrar día", ícono `ClipboardCheck`) en el header del Diario, junto a los KPI existentes. Reemplaza cualquier acceso a la cuadratura desde el Sidebar.

**Comportamiento**:
- Abre un diálogo centrado a pantalla completa (mismo patrón visual que los diálogos grandes de Empresas — no un `TripSlideOver` lateral, necesita más espacio que eso pero menos que una página propia).
- Hereda la fecha actualmente activa en `useDiarioFilters` (`f.fecha`) — sin date picker propio.
- Contenido:
  - Resumen básico y operativo: 4 tiles (Total/Asignados/No asignados/Mismatch) — informativos, no clickeables a un pivot (esa interacción se removió a pedido del usuario).
  - Lista de conductores pendientes (UNASSIGNED sin motivo, o MISMATCH) con su acción de resolución inline (select de motivo reusando `app.unassigned_reasons`; nota "revisar en Empresas" para mismatch, sin botón de acción ahí — la resolución real de un mismatch pasa por el flujo de transferencia ya existente en Empresas).
  - Botón "Cerrar día", deshabilitado mientras haya pendientes; si el usuario tiene rol admin/owner, aparece la opción de forzar cierre con comentario obligatorio (override, ya implementado — reusa `public.audit_log`).
- Al cerrar el diálogo, vuelve exactamente a la vista del Diario tal como estaba (sin cambiar de URL).

**Backend**: sin cambios — reusa `GET/PATCH/POST /api/v1/daily-closures` tal cual existen hoy.

**Componentes a reutilizar**: `dailyClosuresApi` (`lib/api/dailyClosures.ts`), el catálogo de motivos ya cargado en el Diario (`fetchTripsMeta`), el patrón de diálogo centrado ya usado en Empresas.

## B. Reportería — tabla dinámica real

**Ubicación**: `/dashboard/diario/reporteria`, agregada como tercer item dentro del grupo expandible "Monitor de Viajes" en el Sidebar (junto a Diario).

**Filtro de período** (arriba de todo, siempre visible):
- Selector rápido: Hoy / Esta semana / Este mes / Este trimestre / Este semestre / Rango personalizado.
- Cada preset calcula `fecha_desde`/`fecha_hasta` en el cliente (semana ISO, mes calendario, trimestre calendario, semestre calendario — todo en huso horario `America/Santiago`, mismo criterio que `todayISO()` ya usado en el Diario).
- "Rango personalizado" habilita dos `<input type="date">`.

**Constructor de pivot** (debajo del filtro de período):
- Tres "cajones": **Filas**, **Columnas**, **Filtros** — cada uno acepta 0..N de los campos disponibles (lista fija, no drag-and-drop de archivos arbitrarios — ver "Campos disponibles" abajo). Interacción: un `<select>` "Agregar campo a Filas/Columnas/Filtros" + chips removibles para lo ya agregado — evita construir una librería de drag-and-drop completa, cubre el mismo resultado (arbitrariedad de qué va a filas/columnas/filtros) con una interacción más simple y consistente con el resto de la app (que ya usa chips/selects en todos lados, nunca drag-and-drop).
- Cuando el campo **Fecha** se agrega a Filas o Columnas, aparece un selector adicional de granularidad: Día/Semana/Mes/Trimestre/Semestre — determina cómo se buckets la fecha para esa fila/columna.
- La tabla se recalcula en el cliente a partir del dataset ya traído (ver más abajo) — no hay ida y vuelta al backend por cada cambio de fila/columna, solo quisiera hacerlo al cambiar el filtro de período (para no traer más datos de los necesarios).

**Campos disponibles hoy** (ya calculables sin cambios de modelo de datos):
| Campo | Fuente |
|---|---|
| Empresa | `carrier_name` (ya en el detalle de `driver_day_status`) |
| Cliente | `client_names` (Fase 1.5, puede ser multi-valor por conductor/día) |
| Estado | `status` (ASSIGNED/UNASSIGNED/MISMATCH) |
| Motivo | `unassigned_reason_label` (solo tiene sentido cuando Estado=UNASSIGNED) |
| Fecha | `business_date`, con granularidad seleccionable |

**Valores/medida**: conteo de conductores (fijo para esta versión — no se construye un selector de medida, ya que la única medida real disponible es "cantidad de conductores"; agregar más medidas queda para cuando exista una necesidad concreta).

**Export**: botón CSV de la tabla pivot tal como está armada en pantalla (mismo mecanismo ya construido en Fase 1.5, adaptado a N dimensiones en vez de una sola).

### Backend nuevo necesario

El endpoint actual `GET /daily-closures?fecha=` solo trae **un día**. Reportería necesita un rango. Se agrega:

`GET /daily-closures/report?fecha_desde=&fecha_hasta=` → devuelve el detalle de `driver_day_status` (mismas columnas que hoy: `driver_id, full_name, carrier_name, status, unassigned_reason_label, client_names`) **más `business_date`** por cada fila, para el rango completo — sin agregar (la agregación/pivot ocurre 100% en el cliente sobre este dataset plano). No dispara recompute (a diferencia de `GET /daily-closures` de un solo día) — Reportería es una vista de lectura sobre lo que ya quedó calculado/cerrado, no fuerza el cálculo en vivo de días pasados.

**Nota de escala**: si el rango pedido es muy amplio (ej. un semestre completo con cientos de conductores activos), el dataset plano podría llegar a varios miles de filas — aceptable para agregación en el cliente con JS puro (no es un dataset de millones de filas), pero si en el futuro se vuelve un problema de performance real, la mitigación es paginar por fecha o mover el groupBy a SQL — no se construye esa complejidad ahora sin evidencia de que hace falta.

## Gaps conocidos (fast-follow, no bloquean este spec)

- **Categorías de tipo de equipo (Walmart)**: "Equipo Completo"/"Tracto-Región"/"Z0"/"Se retira sin carga" no están modeladas en ningún lado hoy (no hay atributo de "configuración de equipo" en `trip_fleet_links`/`trips`). Requiere definir con el usuario qué significa cada categoría y de dónde se derivaría antes de poder agregarlas como campo del pivot.
- **Zona/Región de destino como campo**: técnicamente derivable de `trip_stops.operation_type`, pero un conductor puede visitar múltiples zonas el mismo día — falta decidir la regla (¿zona del primer destino? ¿todas las zonas visitadas, uno-a-muchos?) antes de modelarlo como dimensión.

## Verificación

- Backend: tests del nuevo endpoint `GET /daily-closures/report` (mock de pool, casos: rango vacío, rango con datos, fecha_desde > fecha_hasta → 422) + verificación contra Supabase real (igual que el resto de esta sesión).
- Frontend: tests del overlay "Cerrar el día" (abre con la fecha del Diario, resuelve motivo, cierra, bloquea con pendientes) y de Reportería (agregar/quitar campos de Filas/Columnas/Filtros, granularidad de fecha, presets de período, export CSV) — reemplazan los tests de la página de Cuadratura eliminada.
- `tsc --noEmit`, `vitest run`, `npm run build`, `pytest` en verde antes de dar por cerrado.
