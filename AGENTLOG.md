# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.
> **`AGENTLOG_ARCHIVE.md` NO está en git, y es a propósito** (decisión del usuario, 2026-08-15):
> el histórico no ensucia el repo ni los diffs. Consecuencia asumida: archivar mueve contenido
> fuera de control de versiones. El respaldo real son los commits viejos de `AGENTLOG.md`, que sí
> está trackeado — el `.gitignore` lo lista pero no lo afecta, porque ya lo estaba desde antes.
> No "arreglar" esto con `git add -f`.
> (Rondas 51-54, 55-109, 112-120 y 138-146 archivadas en su momento; ver el archivo.)
> (**Rondas 147-148 archivadas al cerrar la Ronda 149**: el backlog y el roadmap, el click-through
> de la app desplegada, el contrato, el rol `writer` y el test rojo. Lo que seguía abierto se
> consolidó ABAJO antes de mover nada.)
> (**Rondas 152-157 archivadas al cerrar la sesión del 2026-09-14**: todo su trabajo está
> desplegado, y lo que seguía abierto se consolidó en el checklist de la Ronda 160.)
> (**Rondas 149-161 archivadas al cerrar la Ronda 162**: el único pendiente propio de la 161 era
> la historia de usuario de Operación/CD, que ES la Ronda 162; lo demás que seguía abierto está
> consolidado en el checklist de abajo antes de mover nada.)

> (**Ciclo de vida del Directorio con motivo (21/10)** cerrado y archivado: estado de baja único, acciones con motivo,
> ambas migraciones aplicadas en la real. El test de sincronía de etapas del viaje (rojo desde el 17/10) quedó arreglado el mismo día.)

### PARA LA PRÓXIMA SESIÓN (cierre del 22/10, actualizado al final del día)

Todo lo de hoy está comiteado y en `dev` (último `27d46eb8`). El punto 0 (Configuración) quedó CERRADO y probado en
dev; sus 6 menores quedaron hechos y probados en dev el mismo día. Pendientes, en orden:
0. **Configuración ordenada (22/10, `febe1d8a..96c098d8` en dev, falta humo):** spec
   `docs/superpowers/specs/2026-10-22-configuracion-orden-visual-design.md`, plan `docs/superpowers/plans/2026-10-22-configuracion-orden-visual.md`
   (inline, 9 tareas + revisión final opus). Cierra el pendiente del 11/10 (pasada visual) y la deuda que seguía.
   - Decisiones del usuario: retirar "Sin revisar" de Configuración y registrar quién cambió qué (incluye Personas y Roles).
   - Listas con la tabla del kit (`SettingsList` sobre `DataTable`/`TableToolbar`, "+ Nuevo" en la barra, `Card`);
     Umbrales y las dos Alertas de vencimiento en `SettingsForm` (Guardar cambios/Descartar, aviso al salir con cambios,
     guardado parcial dice qué se guardó). Índice sin números. Personas: tabla del kit, datos de React Query (sin copia),
     menú del kit. Roles: botón del kit y cabecera en la tarjeta.
   - Registro de cambios: `services/config_changes.py` escribe en `public.audit_log` (`config:<area>/<section>`, id md5
     del elemento); Personas/Roles reusan ROLE/USER_ROLE y se agrega PERSON. Lectura: `GET /config/changes` (reference.read)
     y `GET /config/changes/people` (users.manage). "Última modificación" en panel, formulario, Personas y roles propios.
   - `app.config_reviews` y `revision.tsx` se quedan (Documentos exigidos los usa); el backend sigue escribiendo revisiones.
   - Verificación: backend 1.966 passed (copia local), frontend 2.131 + build + tsc; revisión final: 3 importantes
     arreglados con test rojo→verde; 6 menores diferidos (ledger: bandera única de cambios sin guardar, aviso solo en el
     índice, audit fuera de transacción, nombres de acción, Decimal vs float, doble clic en Personas).
   - HUMO EN DEV (22/10): 17 secciones a 1440 y 390 sin desplazamiento horizontal, sin "Sin revisar" ni errores.
     Umbrales: "Guardar cambios" deshabilitado sin cambios; Semáforo rojo 120→121→120 guardó, dijo "Guardado" y
     "Última modificación: Felipe Sumadots, 22/10/2026"; `audit_log` tiene las dos filas con antes y después. Valor
     restaurado. Con la sección quieta, 0 pedidos en 10 s (sin bucles).
   - El usuario vio "Too Many Requests" durante el humo: lo causó el recorrido rápido de Playwright (34 páginas
     seguidas) contra el límite de `proxy.ts` (60 pedidos/10 s por IP), compartido con su navegador. No es del código.
   - Cerrado. Menores diferidos: el usuario pidió el 2 y el 6 (22/10, en dev, falta humo):
     - 6 (`99386c5f`): el menú de acciones de Personas se deshabilita mientras la fila guarda (`ActionsMenu` acepta
       `disabled`).
     - 2 (+1): `useUnsavedChanges` escucha clics en el documento (captura, antes que el `Link` de Next) y pregunta en
       cualquier enlace interno —índice, menú lateral, migas—; cuenta formularios con cambios (arregla el 1). El botón
       Atrás del navegador queda fuera: un `popstate` no se cancela y simularlo choca con el router de Next.
     - Después, del más fácil al más difícil (pedido del usuario):
       - 5 (`270f9664`): `diferencia` compara números como Decimal: Decimal('0.1') vs 0.1 ya no es cambio.
       - 4 (`85accd71`): desactivar un motivo se registra como `deactivate` y solo si estaba activo; retirar persona
         registra `deactivate`, y `delete` recién después de que Supabase borra la cuenta.
       - 3: estados, umbrales, rangos, reglas del Monitor y vocabularios guardan cambio + revisión + registro en una
         transacción (test: si el registro falla, el cambio no queda). Invitar persona queda fuera (Supabase está fuera
         de la base). Los arneses simulados usan conexión = pool (`wire_transactional_conn(pool, pool)`).
       - Los 6 menores están hechos. Verificación: 526 tests de Configuración y accesos en verde (copia local).
     - HUMO EN DEV (22/10, `85f026c1`): con un cambio sin guardar, ir a Analítica por el menú lateral abre "Tienes
       cambios sin guardar. ¿Salir igual?"; al cancelar se queda en Umbrales con lo escrito (121). Guardar con la
       transacción nueva: "Guardado" + "Última modificación: Felipe Sumadots, 22/10/2026"; vuelto a 120 (base: 120).
       Sin cambios, el menú sale sin preguntar. El 404 de `table-preferences/analytics.trips` en consola es previo
       (sin preferencias guardadas), no de esto. CERRADO.
1. **Operaciones:** avisar que la Flota del día se baja y se copia ("Descargar Excel" / "Copiar"): la vista se arma una
   vez (columnas y filtros, p. ej. por Origen habitual) y se manda al CD desde ahí. Ver la sección de abajo.
2. **Certificación:** que quien grabó el video del arrastre lo pruebe con un arrastre de verdad (`da1ecd26`).
3. **Analítica:** marcha en paralelo de 2 semanas contra el Excel de Operaciones; Fase 3 (reportes estándar);
   `fct_trip_status_events`; quitar `bdot_people.sql` (deshabilitado) desde la UI de Mage; issue #14.
4. Lección del día: un pedido de reunión (export de la Flota del día, 16/10) se perdió por no anotarse. Al revisar una
   reunión, pasar cada pedido al AGENTLOG o a una HU el mismo día.

### CHECKPOINT VIGENTE — Analítica (BDOT en la app) (21/10, Fase 0 `22ef3d5c` en dev)

**Por qué:** la reunión del 16/10 (Granola 24f97159, Pablo/Fabián/Enrique) pidió un módulo Analítica que reemplace el
Excel BD OT: una sábana por viaje, vistas guardadas (BDOT completo, F30-1, Operaciones Walmart), Excel con datos
personales solo para administradores y reportes estándar. Plan aprobado: `~/.claude/plans/zany-wishing-cloud.md`.
Decisiones del usuario: el reporte diario cuenta "Asignados del día" (planificados ese día, como el Excel) y "En ruta
desde días anteriores" aparte. El grano es viajes + paradas, con todas las fechas. El módulo va primero en la app;
la herramienta de BI es una fase posterior ("basta con la lógica de cómo se reporta hoy"). Las columnas financieras
de la BD OT dependen de Facturación (fuera del MVP, cláusula 5.2).

**Hecho (Fase 0):**
- `status_report._build_asset_rows`: el día del equipo es su viaje planificado MÁS RECIENTE. Antes era el reportado
  más tarde, y un tracto con un viaje de hoy y otro de anteayer activo contaba como en ruta.
- El resumen trae `assigned_today`, y `multi_day.total` = en ruta. La pantalla, la versión imprimible y el Excel
  muestran "Asignados del día" y "En ruta desde días anteriores" (`CuatroCifras` pasó a `CifrasDelTipo`).
- `/daily-closures/report` ya no devuelve `tax_id`: la Reportería no lo usaba y lo leía todo el que tiene
  `operations.read`.
- Tests: `tests/test_status_report_dia_integracion.py`; la mutación se detecta (con la regla vieja da 2 ≠ 0).
  Backend del área 64/64, vitest del reporte 163/163, tsc.
- Base real (lectura), del 14 al 20/10: 1 a 4 equipos por día pasan de "Asignados" a "En ruta" (16/10: 37 con
  carga, 33 del día y 4 en ruta).
- Corrección al plan: la zona de destino NO se calcula en el frontend. Vive en `services/destination_zone.py`
  (Python, una sola fuente). Llevarla a SQL es parte de la Fase 1: el Python debe llamar a la función SQL, no
  copiarla.

**Siguiente paso:**
1. HECHO (21/10): humo en dev del Reporte de estatus del 16/10 en Tractoreo: 46 activos, 31 del día, 1 en ruta, 13 no
   trabajaron, 69,6 %. Revisado a 1440 y 390, y el Excel trae las dos filas. Hallazgo: las tablas por cliente y por origen habitual
   sumaban del día + en ruta (Walmart 32 contra 31). Decisión del usuario: separar en dos columnas, "Del día" y
   "En ruta". Hecho en la pantalla, la versión imprimible y el Excel (`by_client`/`by_home_origin` traen
   `assigned_today` e `in_route`). El encabezado del Cierre ("34 asignados") es otra cuenta y no se tocó.
   Humo de `7e396fd5` en dev (16/10, Tractoreo): Walmart 31 del día + 1 en ruta; por origen 15/4/11/1 = 31 y 1
   en ruta; Excel con totales 46/31/1. Revisado a 1440 y 390. (En Playwright, "Descargar Excel" abre un menú y la
   descarga sale con su botón "Descargar".)
2. Fase 1 REDEFINIDA (21/10). Las vistas anchas sobre `app` se descartan por no ser estándar: reescriben la historia
   y no tienen grano declarado. Va un modelo dimensional (Kimball) en dos capas:
   - **Gold, en dbt** (decisión del usuario). La fuente es `app`, no `silver`.
     - Hechos: `fct_trips` (accumulating snapshot, una columna por hito), `fct_trip_stops` y el estado diario de la
       flota (periodic snapshot, desde `closure_lines`).
     - Dimensiones compartidas con SCD2 donde hay historia (`fleet_assignment_periods`).
     - Datos personales solo en la dimensión conductor.
     - Tests de dbt que corran en el pipeline (hoy Mage no corre ninguno).
   - **Presentación en el schema `analytics`** (recomendado, por confirmar con el usuario). Vistas delgadas `rpt_*`
     y la sábana BDOT, sin lógica propia. La API y la herramienta de BI leen solo esta capa, con un rol sin datos
     personales.
   - DISEÑO ESCRITO (21/10): `docs/superpowers/specs/2026-10-21-analitica-modelo-dimensional-design.md`, por
     aprobar. Bus matrix; 4 hechos de la primera etapa (eventos de estado desde `bronze.tms_trips_snapshot`, viaje
     como accumulating snapshot, parada y estado diario de la flota desde las firmas); dimensiones con SCD donde
     hay historia; `analytics` con roles propios; pipeline `analytics_gold` con `dbt build`; contrato para los
     módulos nuevos (sección 8).
   - DISEÑO APROBADO por el usuario (21/10).
   - DEFECTO CORREGIDO (21/10): `trip_planning_date` sacaba el día en UTC. Los viajes de las 20:00 o 21:00 en
     adelante (Chile) quedaban con el día siguiente; el TMS sí manda hora de Chile.
     - Decisión del usuario: día de Chile, también hacia atrás.
     - Macro corregido en `.mage-agent/local_sync` y sincronizado (está en .gitignore: la fuente vive en Mage).
       La corrida de las 23:11 UTC ya compila con él.
     - Migración `20261031090000_planning_date_chile_day` APLICADA (ensayo con ROLLBACK + autorización):
       212 viajes, auditados como `fix_planning_date_timezone`. Firmas intactas (1.237).
     - Efecto (base real, 14-20/10): el 16/10 pasa de 37 a 39 con carga (34 del día, 5 en ruta). Los viajes de
       la noche ahora cuentan en su día y, al día siguiente, como en ruta.
     - Pendiente de la misma clase: `trips_del_dia` usa `status_reported_at::date` (marca sin huso en UTC).
   - PASO 1 HECHO (21/10): las reglas de lugar del viaje viven en la base. Migración `20261101090000_trip_location_rules`
     APLICADA (ensayo con ROLLBACK + autorización):
     - Funciones: `app.location_operation_type`, `operation_type_zone`, `trip_origin_local`,
       `trip_last_destination_local` y `trip_destination_zone`.
     - Índices: dos sobre `public.locations`.
     - La API las llama: `services/destination_zone.py` y `origen_del_viaje.py`. Se retiró la copia en Python
       (`split_local`, `normalize_location_name`, `resolve_operation_type`, `zone_of`).
     - Cambio a propósito: el último destino sale de la lista vigente (`trips.stops`), no de una versión vieja de
       `trip_stops`. Cambian 85 destinos y 7 zonas desde julio, ninguna en un día cerrado. Un nombre de local
       ambiguo (2 casos) queda sin resolver en vez de elegir al azar.
     - El cliente del viaje NO pasó a función: es un cruce por `shipper_id`, no una regla. Gold lo hace con
       `dim_client`.
     - Tests: `test_trip_location_rules_integration.py` (18 casos a mano; mutación detectada). Área del backend
       723 + 36 en verde.
     - Rendimiento medido en la real: página del Monitor unos 10 ms netos, 300 zonas unos 130 ms.
   - PASOS 2-3 ESCRITOS Y PROBADOS (21/10), SIN SINCRONIZAR A MAGE NI CORRER EN PRODUCCIÓN:
     - Archivos en `.mage-agent/local_sync/dbt/tms/` (fuera de git):
       - `models/gold/`: dim_date, dim_client, dim_carrier (SCD2), dim_driver, dim_asset, dim_location,
         dim_reason, dim_trip_status, bridge_fleet_membership, fct_trips (incremental), fct_trip_stops
         (incremental; las versiones viejas quedan con is_current = false) y fct_fleet_daily_status.
       - `snapshots/snapshot_carriers.sql`.
       - `tests/assert_fct_trips_same_trips_as_app.sql` y `tests/assert_fleet_daily_status_matches_signed_totals.sql`.
       - `dbt_project.yml` con la carpeta `gold`.
     - Probado con dbt 1.8 local (venv en el scratchpad, perfil a la copia local): 64/64.
     - Ensayo con ROLLBACK en la real, todo revertido:
       - fct_trips: 3.757 = app.trips, en unos 2 s; 95 % con empresa.
       - fct_trip_stops: 10.314 vigentes y 1.474 de historia.
       - fct_fleet_daily_status: 9.090 filas; 0 días firmados que no cuadran.
     - Nueva migración `20261102090000_closure_line_category`, SIN APLICAR: la categoría de una línea del Cierre
       pasa a `app.closure_line_category`, y `cierre_lineas._CATEGORIA` la llama. Tests del Cierre 336 verdes;
       la mutación se detecta (2 rojos).
     - Hallazgo: 4 catálogos viejos (DRIVER_REASON, EQUIPMENT_STATE, FLEET_SERVICE_TYPE, OPERATIONAL_STATE) tienen
       valores sin `code`.
   - EN PRODUCCIÓN (21/10, autorizado por el usuario):
     1. `20261102090000` APLICADA: misma categoría en las 9.090 líneas. Backend subido (`c4271800`).
     2. Gold sincronizado a Mage.
        - Pipeline `analytics_gold`: un bloque dbt con `build --select snapshot_carriers gold`; trigger
          `triggers.yaml` a las :20 de cada hora, CONFIRMADO: corrió solo a las 00:20 UTC del 22/10.
        - Primera corrida, run 15780 (unos 60 s), en la real: fct_trips 3.757 = app.trips; fct_trip_stops 11.792
          (10.317 vigentes); fct_fleet_daily_status 9.090; dim_carrier 251 (historia desde hoy).
        - `tms_daily_tests` excluye `tag:analytics`. Con `--indirect-selection cautious` se perdía un test propio,
          así que se descartó.
     3. Copia versionada en `monitor-app/analytics/dbt` (`sync-gold-from-mage.sh`, README). Se edita en Mage,
        no ahí.
   - SIGUIENTE:
     - HECHO: la corrida programada de las 00:20 UTC entró sola. Segunda corrida manual (run 15785): incremental
       correcto (1.999 recargados, 1.758 intactos), 3.757 = app.trips y 251 versiones de empresa sin duplicar.
     - HECHO (21/10): humo del paso 1 en dev (API `c4271800`).
       - Responden con 200: Reporte del 16/10 (Tractoreo: 20 RM, 9 Z0, 3 sin clasificar = 32), Flota del día de
         conductores y de equipos, y Monitor (25 en curso, paradas con tipo: 38 RM, 12 Z0, 1 Región Sur, 5 sin
         resolver).
       - El listado del Monitor tarda entre 1,8 y 2,3 s; `trips/meta` tarda 0,9 s. Las reglas nuevas suman unos
         10 ms en la base. No hay medición de antes del cambio: comparar si alguien lo nota lento.
     - `fct_trip_status_events` (desde `bronze.tms_trips_snapshot`: hitos publicado y asignado).
     - HECHO (22/10): capa `analytics` en producción.
       - Migración `20261103090000` APLICADA (ensayo con ROLLBACK + autorización): schema `analytics` y roles
         `analytics_reader` y `analytics_personal_reader` (NOLOGIN).
       - Las tablas son modelos de dbt (`models/analytics`): `bdot`, `bdot_people` y `fleet_daily`, con `grants`.
         Tablas y no vistas porque dbt reconstruye gold con `DROP ... CASCADE`; probado en local que se llevaba las
         vistas.
       - El pipeline corre `snapshot_carriers gold analytics`. Run 15792 en la real: bdot 3.758 = app.trips,
         bdot_people 3.758, fleet_daily 9.090.
       - Permisos verificados: el lector ve `bdot` y `fleet_daily` y no ve `bdot_people`; el lector personal ve
         las tres; anon y authenticated, nada.
       - `gold` sigue en `pgrst.db_schemas` pero es inocuo (anon y authenticated sin USAGE). Retirarlo es en la
         configuración de API de Supabase.
     - Fase 2: el módulo Analítica. HU ESCRITA (22/10), por aprobar: `monitor-app/docs/user-stories/20261022/01-hu-analitica.md`.
       - 15 criterios, diseño contrastado con Samsara, Motive, Salesforce, Linear y Metabase, y sus cuatro estados.
       - Permisos: `analytics.read` (READ_ALL), `analytics.export`, `analytics.manage_views` y
         `analytics.personal_data` (privilegiado).
       - Modo servidor nuevo en el kit de tabla y el período en `useUrlView`.
       - Tabla nueva `app.saved_views`.
       - Excel en el servidor y auditado.
       - Reportería fusionada como "Tabla dinámica" de Flota por día.
       - `bdot_people` pasa a `driver_identity`.
     - MÓDULO IMPLEMENTADO (22/10, ejecución inline, ledger en .superpowers/sdd/2026-10-22-modulo-analitica/progress.md):
       - Backend: `routers/analytics.py` (`/columns`, `/rows`, `/export`), `routers/analytics_views.py`,
         `services/analytics_{columns,query,export}.py`.
       - Permisos: `analytics.read/export/manage_views/personal_data`.
       - Frontend: `/dashboard/analytics` con `AnalyticsWorkspace`, `PeriodPicker`, `SavedViewsPanel`,
         `SaveViewDialog`, `FleetPivot`, y el modo servidor del kit de tabla.
       - La Reportería redirige a Flota por día › Tabla dinámica (conductores, este mes).
       - Revisión final (opus): 0 críticos, 6 importantes y 9 menores arreglados con test RED→GREEN; 6 menores
         diferidos en el ledger (conteos en 11 consultas, `q` sin escapar, tope de 200 valores por filtro, etc.).
       - Producción (autorizado): `20261104090000_saved_views` APLICADA (3 vistas sembradas);
         `analytics.bdot_people` borrada; su modelo quedó deshabilitado en Mage (falta borrar el archivo desde la
         interfaz de Mage).
       - HUMO EN DEV, 1ª pasada (22/10): la tabla carga con datos reales. El usuario observó que el menú de vistas
         (una columna a la izquierda) no seguía el look & feel de la app ni el estándar.
         - Decisión: patrón de HubSpot, con comparativa en la HU. Las vistas fijadas por persona son pestañas
           (`app.saved_view_pins`, migración 20261105090000 APLICADA). "Todas las vistas" las administra. La barra
           de cambios ofrece Guardar, Guardar como nueva y Descartar.
         - La pantalla sigue el esqueleto del Cierre. Filas de una línea y fechas en dd/mm/aaaa (`f04c6dbd`).
       - DECISIÓN DEL USUARIO (22/10): los reportes del Cierre conviven en los dos lados hasta que WebCarga decida.
         - La Reportería vuelve a su pantalla (`fa50eafd`) y además está en Analítica como Tabla dinámica.
         - El Reporte de estatus del día está en el Cierre y en Analítica ("Reporte del día", mismo componente).
         - Por eso `/daily-closures/report` vuelve a tener uso.
       - HUMO EN DEV del rediseño (22/10, `5ae00dbd`, despliegues lanzados a mano porque Actions venía con más de
         40 min de atraso):
         - Pestañas con las vistas fijadas: Todos, BDOT completo y Operación por cliente.
         - Abrir "Operación por cliente" y cambiar el período: la vista se mantiene y aparece "Cambios sin guardar ·
           Guardar". El caso raro de la 1ª pasada no se repitió.
         - "Guardar como nueva": la vista "Prueba humo" quedó fijada y se borró al terminar.
         - Excel: 944 viajes de septiembre, con la línea de período y datos y 8 columnas; `audit_log`
           ANALYTICS_EXPORT con `rows=944` y `personal=false`.
         - Tabla dinámica contra la Reportería, septiembre, conductores: 1.085 contra 1.077. La única diferencia es
           el 02/09 (49 contra 41): antes de la primera firma (03/09) la Reportería cuenta solo a los conductores que
           estaban en el roster de Tractoreo ese día. RESUELTO (22/10, `7c54b5b9`, decisión del usuario "opción 1"):
           - El usuario preguntó si se mezclaba el Cierre con la reportería. Sí: la regla "quién cuenta" vivía en el
             SQL del router del Cierre. Decisión: definirla UNA vez en la base y que la lean todos.
           - Migración `20261106090000_closure_report_population` (APLICADA en la base real, con autorización):
             `app.tractoreo_roster(día)` y `app.closure_line_in_report(tipo, sujeto, día)`. `driver_roster.py` y el
             WHERE de `_DETAIL_SQL`/`_REPORT_SQL` las llaman. gold: `fct_fleet_daily_status.in_report` (el hecho
             guarda todo); `analytics.fleet_daily` filtra `WHERE s.in_report`.
           - Ensayo con ROLLBACK en la base real: 0 diferencias de roster (día por día desde 01/07) y 0 de regla
             (todas las líneas); ~2 s. Tests: `test_closure_report_population_integration.py` (7, mutación
             detectada); 238 tests del Cierre verdes en la copia local.
           - Tras `analytics_gold` (run 15888): septiembre 1.077 y 02/09 = 41, igual que la Reportería. 673 líneas
             del hecho quedan fuera del reporte (casi todas de julio-agosto, antes de la primera firma): las cifras
             de Analítica de esos meses bajan en esa cantidad.
           - HUMO EN DEV (22/10, API `webcarga-monitor-api-dev-00262`): Cierre del 02/09 carga sin errores; conductores
             41 (28 asignados, 12 no asignados, 1 por regularizar), 0 fuera del roster. 21/10: 45, con 2 fuera del
             roster marcados (después de la primera firma, correcto). Reportería septiembre: 1.077 filas, 02/09 = 41.
             Analítica (`analytics.fleet_daily`): 02/09 = 41 y 21/10 = 45. Las tres pantallas dicen lo mismo.
         - Reporte del día del 16/10: 30 del día y 2 en ruta (la fecha de Chile movió 1).
         - 390 sin desplazamiento horizontal.
         - Arreglado: con el permiso, Conductor y RUT aparecían como columnas de entrada; ahora se eligen en Columnas
           (test RED→GREEN).
     - PLAN ESCRITO (22/10): `docs/superpowers/plans/2026-10-22-modulo-analitica.md`, 13 tasks.
       - dbt: `driver_identity` y los clientes del día en `fleet_daily`.
       - Permisos.
       - Catálogo de columnas.
       - Consulta paginada.
       - Excel auditado.
       - `app.saved_views` (migración 20261104090000).
       - Modo servidor del kit.
       - Período en la URL.
       - Cliente de la API.
       - Pantalla.
       - Vistas en la pantalla.
       - Tabla dinámica + retiro de la Reportería.
       - Producción y humo.
       Pendiente: el usuario elige el modo de ejecución.
     - BACKLOG: identificación internacional, en el issue #14
       (https://github.com/fsotosa-ops/webcarga/issues/14).
       - Hoy `drivers` exige un RUT chileno canónico (CHECK) y `tax_id` es UNIQUE sin país en drivers y carriers.
       - Estándar: país + tipo de documento + número, con unicidad sobre los tres.
       - El modelo analítico ya identifica por uuid; solo falta exponer país y tipo en `bdot_people`.
   - DECISIÓN DEL USUARIO (22/10): Analítica no depende de Operaciones. Se construye con lo resuelto; los puntos para
     Operaciones (FRTC42, GPRZ30, tipos de Reclutamiento, Sodimac sin tracto, onboarding de conductores, umbral
     `stale_trip_days`) son backlog aparte y no bloquean nada de Analítica.
   - (hecho) Leído el proyecto dbt de Mage (`.mage-agent/local_sync/dbt/tms`, y `monitor-app/docs`
     contra la base real), la convención de dbt del proyecto y cómo se programa su ejecución.
   - Antes: llevar la zona de destino a una función SQL que `destination_zone.py` reutilice.
   - Verificar de dónde sale la hora de asignación (TMS o `audit_log`).
   - Migración con ensayo con ROLLBACK y autorización.
3. Fase 2: módulo `/dashboard/analytics`.
   - API paginada con un catálogo de columnas único.
   - `app.saved_views`.
   - Permisos `analytics.read`, `analytics.export` y `analytics.export_personal_data`.
   - Exportación auditada.
   - La Reportería se fusiona como vista del módulo.
4. Fase 3: reportes estándar (no asignados por día de oferta, hora de asignación por CD, cuadratura contra el TMS,
   F30-1).
5. Marcha en paralelo de 2 semanas contra el Excel de Operaciones.

### 2026-10-22 — Flota del día: bajar y copiar la vista (pedido de la reunión del 16/10)

- Feedback: las vistas por persona de la Flota del día se hicieron, pero no se podían bajar ni copiar para mandarlas al
  CD; "Copiar estatus" estaba solo en el Reporte. Contrastado con la transcripción (Granola 24f97159): 29:34 "que aquí
  hubiera un exportar", 37:12 copian y pegan del Excel al WhatsApp del CD, 65:01 "un export y un Excel". El pedido no
  estaba anotado en ningún lado: se había perdido.
- Decisión del usuario (estándar, sin parche): capacidad del kit de tablas, no de la pantalla.
  `components/ui/tabla/data/ViewExportActions.tsx` ("Descargar Excel" y "Copiar") sobre `visibleTable` y la nueva
  `viewForPasting` (`viewExport.ts`): columnas de la persona en su orden, todas las filas que pasan los filtros (no solo
  la página), encabezado con día, alcance y filtros. La copia lleva html (tabla, para correo) y texto (una línea por
  fila, para WhatsApp), como Google Sheets. Sale de los datos, no del DOM. Sin imagen (no es estándar en tablas).
  "Copiar estatus" del Reporte no se tocó.
- La Flota del día lo enciende en `TableToolbar actions`. No hay RUT en la tabla: no expone datos personales.
- Tests RED→GREEN: `viewExport.test.tsx` (2), `ViewExportActions.test.tsx` (4), `FlotaDelDiaSection.test.tsx` (1).
  tsc y 288 tests del kit y el Cierre verdes.
- HUMO EN DEV (`550a8a0e`, 21/10 Tractoreo): Copiar con "No asignados" copió las 21 filas (la página muestra 20),
  encabezado "Flota del día 21/10 · Tractoreo · Estado: No asignado · 21 filas" y tabla html. 390 sin desplazamiento
  horizontal. **Descargar Excel FALLABA**: Excel no acepta "/" en el nombre de hoja y el título lleva "21/10"; los
  tests simulaban la descarga. Arreglo `ee4fbc68`: `nombreDeHoja` limpia []/\:*? en un solo lugar (tabla y secciones
  del Reporte), test con write-excel-file real (RED→GREEN); botones al tamaño de "Columnas"; el error va a consola.
- HUMO de `ee4fbc68` en dev: el Excel baja (`flota_del_dia_2026-10-21_tractoreo.xlsx`), hoja "Flota del día 21-10 ·
  Tractoreo", recorte arriba, 12 columnas en el orden de la persona, 21 filas, todas "No asignado". Cerrado.
- **Siguiente:** avisar a Operaciones que la vista se arma una vez (columnas y filtros) y se manda desde ahí.

### 2026-10-22 — Certificación: el blanco de arrastre titilaba (`da1ecd26` en dev)

- Reporte en video (`monitor-app/bugs/20261022/bug-upload-documents-compliance.mp4`, narrado): al arrastrar un PDF
  sobre un requisito, el resaltado parpadea y cuesta soltar.
- Causa: `useGestoDeCarga.onDragLeave` apagaba el blanco con cualquier dragleave, y el navegador lo lanza al pasar a
  cada hijo del renglón. Además, al recibir, el renglón oculta estado y acciones y cambia el elemento bajo el puntero.
- Arreglo: solo se apaga si `relatedTarget` está fuera de la zona. Sirve a `RenglonPendiente` y `DocumentChecklist`.
  Test RED→GREEN en `RenglonPendiente.test.tsx` (jsdom no tiene DragEvent: el evento se arma a mano). tsc y 335
  tests de Certificación verdes.
- HUMO EN DEV (22/10): en Pendientes, eventos de arrastre nativos de Chrome recorriendo 3 veces todos los hijos de un
  renglón (57 pasos): el blanco no se apagó ninguna vez y sí al salir. Sin soltar (no se subió nada). El panel por
  empresa del video usa el mismo renglón (`SubjectDocumentRows` → `RenglonPendiente`).
- **Siguiente:** que quien grabó el video lo pruebe con un arrastre de verdad.

### CHECKPOINT VIGENTE — Onboarding de empresas como etapa del alta (21/10, `8087d893` en dev)

**Por qué:** el usuario observó que "En onboarding" no calzaba con la industria: era "empresa creada sin RUT"
(con RUT nacía activa sin documentos, salía solo con el RUT, no podía recibir documentos y su carpeta no entraba a
Pendientes). Decisiones: criterio de salida = el de la habilitación; activar sin cumplirlo = Certificación con motivo.
El usuario pidió la versión robusta (no el parche de marcar bloqueos en la rama "no activa").

**Hecho:** `CARRIER_STATUSES_IN_CERTIFICATION` (ACTIVE+ONBOARDING) en el glosario, espejo en `lib/states.ts`.
`carrier_compliance_cte`: un solo camino para las empresas en certificación (mismo alcance de Pendientes y mismos
bloqueos); dadas de baja como historial. `ComplianceSummary.requirements_met` (sin bloqueos, sin mirar el ciclo de
vida); `can_operate` = eso + ACTIVE. `in_scope_sql` incluye onboarding. `initial_status` siempre ONBOARDING.
`activate`: `requires_requirements_met` → 409 `ONBOARDING_INCOMPLETE`; excepción con `directory.delete` + motivo
`ACTIVATION_EXCEPTION_REASON` (migración `20261030090000` APLICADA en la real, ensayo con ROLLBACK + autorización).
Total del embudo = Pendientes (ahora con onboarding). Frontend: carga en onboarding, aviso de la pantalla, encabezado
"Faltan N obligatorios para activarla", `LifecycleDialog` con `action="activate"` (excepción), pre-cierre pide RUT
solo con 422. Tests: backend del área 1302/1302 (mutaciones detectadas), vitest 2049/2049, tsc.
Arreglado de paso: `test_states` fallaba desde `7690b11a` (alias `OperationalStatus` retirado de driver/asset).

**Siguiente paso:**
1. HECHO (21/10): humo en dev con una empresa de prueba (RUT 61905889-5): nació En onboarding con 13 obligatorios,
   la ficha dijo "Faltan 13", la API dio 409 ONBOARDING_INCOMPLETE, se activó como excepción con motivo (auditado)
   y se eliminó. Hallazgo arreglado: la carga en lote y la gestión declarada solo se ofrecían a una activa.
2. HECHO: plan del BDOT retomado (checkpoint Analítica arriba; la fuga del RUT quedó cerrada en `22ef3d5c`).
3. Propuesto, sin decidir: onboarding de conductores y equipos.

### CHECKPOINT VIGENTE — Tipo de operación del viaje (21/10, `c08c7992` en dev)

**Por qué:** levantamiento con Operaciones (planilla "Tipo de operación: preguntas para Operaciones", 21/10).
El tipo de un viaje salía solo del tracto; Sodimac nunca trae patente → 114/144 viajes (90 d) sin tipo, en los dos
alcances del Cierre. Respuestas: Sodimac/Iansa/Colun solo Equipo Completo, Walmart los dos, Spot se indica al crear;
conflicto tracto vs cliente = avisar y que Operaciones decida (usuario: gestión por excepción, estándar TMS).

**Hecho:** `shippers.operation_types` + `app.trip_operation_types` + 3 columnas en `app.v_trip_fleet_resolution`
(declarado > cliente de un solo tipo > tracto; `operation_type_source`, `operation_type_conflict`). Migración
`20261029090000` APLICADA en la real (ensayo con ROLLBACK + autorización): Sodimac 114 → 0 sin tipo, 0 conflictos.
Cierre y avisos usan el tipo del viaje (`closure_scope.operation_type_join`); el tracto sigue en roster, líneas ASSET
y Reporte de estatus (cuenta EQUIPOS, no viajes: no se tocó). Aviso `OPERATION_TYPE_CONFLICT` (no bloquea),
`PUT/DELETE /trips/{id}/operation-type` (trips.edit_sensitive), ficha del cliente "Tipos de operación"
(operations.configure), Nuevo viaje pide el tipo si el cliente tiene dos o ninguno, detalle del viaje dice el origen.
Tests: 15 de la regla (mutación detectada), backend del área 653+86, vitest 2044 + tsc.

**Siguiente paso:**
1. HECHO (21/10, solo lectura): Cierre del 20/10 con los 3 Sodimac en Equipo Completo "según el cliente" (el único
   sin alcance es un Walmart con patente fuera del Directorio, ZL7865); ficha de Sodimac con "Tipos de operación";
   Nuevo viaje de Webcarga Spot exige el tipo; detalle del viaje 898217 dice "Equipo Completo · Según el cliente".
2. Responder a Operaciones (sin desarrollo): FRTC42 en Iansa = 2 viajes de prueba anulados el 11/10;
   dar de baja GPRZ30 con motivo; Reclutamiento completa TK1912, BKSL42, DPRP69 y la rampla KDKP93.
3. Pendiente aparte (no tocado): un Sodimac sin tracto sigue en "Asignación incompleta" del Cierre (bloquea si es del
   día); Operaciones dijo que vinculan el camión por viaje (P4). Confirmar con el usuario si se mantiene.

### CHECKPOINT VIGENTE — Cierre con un solo patrón (16/10, desplegado en dev)

**Qué hicimos** (plan `docs/superpowers/plans/2026-10-17-cierre-un-solo-patron.md`, spec
`docs/superpowers/specs/2026-10-16-cierre-un-solo-patron-design.md`; commits 517f5d98..58277e73, push a dev 16/10):
- Kit de tabla de datos `components/ui/tabla/data/` (TanStack Table): columnas declaradas una vez; filtro por columna con
  búsqueda y cifras facetadas; columnas de varios valores; filtros del servidor (Cliente del Reporte); recuadros-atajo de
  uno o varios valores; barra con chips, "+ Filtro", "Columnas" (ocultar/mover, por persona en `app.table_preferences`).
- La vista vive en la URL y se escribe con `history.replaceState` (`useUrlView`), no con `router.replace`: con el router,
  dos filtros seguidos podían dejar la URL de antes (hallado en el humo con el router real).
- Un alcance (Tractoreo / Equipo Completo) arriba de las cuatro pestañas; Flota, Viajes, Pendientes y Reporte con el kit.
  Reporte: Cliente como filtro (varios; backend acepta `shipper_id` repetido), Nº viaje en Asignados y Segundas vueltas,
  "Descargar Excel" = lo que estás viendo (con recorte) o todo el día; el PDF no cambió.
- Migración `20261026090000_table_preferences` APLICADA en la base real (16/10, ensayo con ROLLBACK, autorizada).
- Fix aparte: la invitación por correo lleva a "crea tu contraseña" (`e7cd93b4`).
- Verificado: vitest 1924/1924, tsc, build, backend del área 167/167 en la copia local, humo C11 + matriz 25/25,
  capturas 1440/390. Revisión final opus: 4 Important arreglados (+ 1 re-graduado y 1 hallado en el pase).

**17/10 — Cierre y Monitor con el sistema visual (`62e4b404`, en dev):** `PageContainer` (20 pantallas, guarda) y
`Button`/`buttonClass` (trinquete de botones a mano en 27) en el kit; Monitor con Tabs, SearchInput y Popover del kit y el
color de las señales por significado (`SignalTone` + `SIGNAL_TONE_TEXT`); trinquetes: color crudo 574, bajo 11 px 80.
Resuelto 17/10 (`62db5890`): el título es "Monitor"; se removió el tablero (1 de 2.046 viajes movidos a mano en 60 días) y la agrupación de estados pasó a llamarse "etapa del viaje" (TRIP_STAGES / tripStageStyle; "Estados del viaje" y "Etapa" en Configuración).

**17/10 — Certificación con tokens (`1aa8690e`, en dev):** los paneles y modales (Por asignar, Actualizar por planilla,
Reasignar, Descartados, Documentos exigidos) pasan a los tokens y a la escala; color crudo 574 → 504, bajo 11 px 80 → 70.

**17/10 — Paneles del Monitor y Reportería del Cierre con el kit (en dev):**
- `PanelLateral` con `placement="center"` y `description`: el modal es una variante del panel (mismo fondo, Escape, foco,
  Tab y capas). Grupo, Carga masiva y Nuevo viaje dejan de reimplementarlo (Nuevo viaje copiaba el atrapado de Tab).
- `ToggleChip` (kit): el chip de filtro que se enciende; `ChipsDeFiltro` se arma sobre él. Filtros del Monitor sobre el
  `Popover` del kit; un apartado sin opciones no se dibuja; las acciones de grupo cierran el panel.
- `lib/ui/groupColors.ts`: la paleta que elige quien arma un grupo, una vez (antes 2 copias distintas, 9 y 8 colores; el
  selector ofrece los 9 que acepta la API). No son colores del sistema; quedan fuera del trinquete a sabiendas.
- `Popover` del kit con alto máximo hasta la barra del teléfono y desplazamiento propio (en el teléfono el panel de
  Filtros quedaba cortado). La altura de esa barra es `--mobile-nav-height` en `globals.css` (4rem; 0 desde md), y el
  layout la usa en vez de `pb-16`.
- Nuevo viaje: `SegmentedControl` para el origen; `RouteEditor`, `FleetAssignSection`, `DriverSearchPicker` sin
  mayúsculas ni 10 px. Reportería: período con `SegmentedControl`, CSV con `Button`, tabla con `CABECERA`.
- Trinquetes: color crudo 504 → 247 (72 de la baja son la paleta de grupos movida a lib), bajo 11 px 70 → 27, botones
  a mano 27 → 23.

**17/10 — Kit completo para ventanas, campos y color (en dev):**
- `Dialog` (components/ui): el comportamiento de toda ventana, una vez (fondo, Escape, foco de ida y vuelta, Tab, capas,
  `dismissible` mientras algo viaja). `PanelLateral` = Dialog + encabezado/pie; `ConfirmDialog` = las reglas de
  `ConfirmarBaja` (foco en Cancelar, no cerrar mientras viaja, quedar abierta si falla). 17 ventanas migradas (incluidas 4
  que ni declaraban `aria-modal`: CreateUserForm, DocumentPreviewModal, TransferModal, asignar conductor). Guardia:
  `aria-modal` o fondo oscuro solo en Dialog.tsx. Arreglado de paso: Dialog robaba el foco a un `autoFocus` y no lo
  devolvía al botón que la abrió.
- `inputClass` + `Field` + `FIELD_LABEL` (components/ui/Field.tsx): ~45 archivos; guardia `focus:ring-accent` a mano = 0
  (excepción con motivo: StopTimeInput). Casillas y botones pasan a `focus-visible:`.
- Color crudo y bajo 11 px en `app/` y `components/`: **0, ahora regla** (`toEqual([])`). Decisiones de significado:
  semáforo de espera verde → neutro (no `resuelto`), amarillo/naranjo = dos intensidades de `warning`; persona
  Activo/Inactivo por el glosario (`lifecycleStyle('user')`, Inactivo neutro, no rojo); aviso de viajes activos en
  ConfirmarBaja `espera` → `warning`. Barra del teléfono z-30 (bajo el fondo de las ventanas).
- Verificado: vitest 1962/1962, tsc, build; capturas 1440/390 (Monitor, empresa, viaje, asignar conductor, login).

**Siguiente paso exacto:**
1. Confirmar Deploy Frontend y Deploy Monitor API en verde y recorrer el Cierre en dev con sesión.
2. ~~Hallazgo 3~~ RESUELTO (16/10, decisión del usuario): modelo estándar estado + tipo de motivo (`e2b45aeb`, `42a732d0`,
   en dev). Pendiente del usuario: configurar "Viaje entregado sin cierre del TMS" (`stale_trip_days`, hoy vacío: por eso
   el viaje 2015669, entregado el 25/07, sigue en Por resolver) y anular el 2015269 (registrado por error).
3. Menores diferidos (ledger, sección Final): C7 solo en Flota (llevar al kit); elegir Cliente cierra el filtro;
   `cancelQueries` en preferencias; `ShortcutTiles.loading`/`ready` sin uso; lista de alcances repetida; alcance de
   Conductor sin empresa ignora tractos sin tipo.
4. Prioridad #2 del usuario: descarga de viajes para cuadrar con las fuentes (Propietario/admins, diario y fin de mes).
5. `SearchInput` compartido en las 12 listas.
6. ~~Campo, ventanas y color restante~~ HECHO 17/10 (ver abajo).
7. Pendiente menor: `AsignarConductorPopover` conserva la etiqueta en mayúsculas ("El TMS reportó"); 17 botones
   principales escritos a mano (trinquete en 17); `TEXTO_CUERPO` (gray-600, lib/ui/texto.ts) sin token equivalente.
8. ~~Administración en dev~~ MIRADA 17/10 (Personas, Crear usuario, Editar roles; 1440 y 390). Halló que el fondo de una
   ventana abierta dentro de un `space-y` heredaba margin-bottom y medía 16 px menos: `Dialog` va envuelta en un
   contenedor sin caja (`251ec162`, test incluido). `SelectorDeRoles` alineado 17/10: títulos con `FIELD_LABEL` y el
   nivel por área con el aspecto del kit (`segmentClass`/`SEGMENT_GROUP`, expuestos por SegmentedControl), sin perder
   la semántica de radio.
9. Seguros por empresa: spec `docs/superpowers/specs/2026-10-17-seguros-por-empresa-design.md` (opción C elegida por el
   usuario 17/10: lista plana por empresa que abre en "No al día" + panel con pólizas y cuotas; Pólizas pierde el modo
   por empresa; marca pagado alguien de WebCarga, como hoy). Spec aprobado 17/10; plan
   `docs/superpowers/plans/2026-10-17-seguros-por-empresa.md` (7 tareas). **HECHO 17/10** (`274fc4dd..4007c88c`):
   - Base: `app.carrier_insurance_summary` calcula `insurance_verdict` (EXPIRED > NO_POLICY > OVERDUE > NO_DATES >
     EXPIRING > UP_TO_DATE), `severe_overdue` y los datos de la razón; se arma desde `public.carriers`. Migración
     `20261027090000_insurance_verdict` ensayada con ROLLBACK y **APLICADA en la real con autorización** (41 empresas:
     7 vencidas, 18 sin póliza, 16 con cuotas vencidas, 0 al día; las 7 columnas de antes y las alertas del Monitor
     sin cambios).
   - API: `/insurance/carriers` y `/insurance/carriers/{id}`; fuera `group_by` de /policies y `/carriers/{id}/policies`.
   - Frontend: Seguros › Empresas (abre en "No al día", recuadros, razón, panel con pólizas y cuotas), Pólizas en
     `/dashboard/insurance/policies`, contador del menú en Empresas (con `insurance.read`), `useUrlView({ initial })`,
     `formatUf` único, guardia E9 (el veredicto solo por el glosario).
   - Revisión opus: 2 Important + 4 re-graduados, arreglados con test. Pendientes menores cerrados el 17/10 (noche):
     vaciar la vista deja `view=all` (Atrás y marcadores no reaplican "No al día"; `markAllView`/`isAllView` en
     `lib/table/viewInUrl.ts`); coberturas en la tarjeta del panel (`policy_coverages_sql`, una consulta para la ficha
     de la póliza y el detalle de empresa); marcadores viejos de Pólizas (`?state`, `?page`, `?group`) redirigen
     desde el servidor (`legacyPoliciesHref`; la vista pasó a `components/insurance/CarrierInsuranceOverview.tsx`).
     "NO_POLICY con una renovada con deuda" no puede ocurrir: cancelar la sucesora borra el enlace y la vieja vuelve a
     su estado (test que lo fija). Queda: `worst_state` sin uso en el frontend; tabla del kit sin diseño para teléfono
     (propuesta: modo tarjetas en `DataTable`, para todas las tablas).
   - Verificación: vitest 2.023/2.023, tsc, build, backend del área 110 (copia local), humo 29/29 (8 reintentados por
     carga de la máquina, load 150; todos timeouts). Backend: 11 fallos previos al plan (D1 Directorio, identity,
     cliente del viaje, tablero retirado) siguen fuera de alcance.
   - Verificado en dev 17/10 (Deploy Frontend y Monitor API verdes): Empresas abre en "No al día" con 41, recarga con
     el filtro, sin desborde a 390, panel → "Abrir la póliza" cierra el panel y ofrece "Volver a Seguros" con el
     filtro; API sin errores (el 404 de table-preferences es "sin preferencias guardadas").
10. Navegación en el teléfono: spec `docs/superpowers/specs/2026-10-17-navegacion-movil-design.md` (aprobado 17/10:
   barra con hasta 4 destinos según el perfil + "Menú", cajón con el menú completo, cabecera oscura con el logo
   oficial; etiquetas siempre, no solo íconos) y plan `docs/superpowers/plans/2026-10-17-navegacion-movil.md`
   (5 tareas). **HECHO 17/10** (`4c570b0..b98dc96b`, en dev): menú en `lib/navegacion/menu.ts` (guardia: una sola
   definición), contadores en `useNavCounts`, `MobileNav` (barra por perfil + cajón sobre `Dialog`), `AccountActions` y
   `useSignOut` compartidos con la barra lateral, cabecera oscura con el logo oficial. Revisión opus: 3 Important + 1
   re-graduado, arreglados con test. Diferidos: `aria-current` en el botón Menú; Atrás de Android con el cajón abierto.
   **Siguiente (próxima sesión):** 1) decidir el modo tarjetas de `DataTable` para teléfono (maqueta primero, sirve a
   todas las tablas); 2) los temas diferidos (descarga de viajes para conciliar,
   SearchInput común).

**Decisiones de arquitectura:**
- Un solo modelo de filtro por pantalla; recuadros, embudos y chips son puertas al mismo filtro; cifras facetadas.
- Secciones del Reporte que son tablas dinámicas con subtotales (Resumen, Asignados, No trabajaron) se quedan como tales;
  las listas van a la tabla del kit (decisión del usuario 16/10).
- Estado + tipo de motivo (decisión del usuario 16/10, estándar de utilización): Estado = Asignado / No asignado / Por
  regularizar; Tipo de motivo (solo no asignados, del grupo del catálogo) = Sin motivo / Trabajó sin asignación / No
  trabajó. "No asignados" es todo lo no asignado, igual en recuadro, resumen y Reporte. Recuadros en dos grupos que se
  reemplazan (kit `ShortcutTiles` con `groups`, cifra = lo que se vería al tocarlo).
- La zona del destino vive en `services/destination_zone.py` (movida desde routers/trips.py): Monitor, Reporte, Flota,
  Viajes y Pendientes la leen de ahí; las palabras de zona en `DESTINATION_ZONE_LABEL` (lib/states.ts).
- Un tipo `ClosureScope` en `lib/types.ts`; la regla de alcance en `lib/cierre/scope.ts` (`inScope`, `scopeGap`).
- Enrique Campos (16/10): entra con Microsoft; lo frena la verificación en dos pasos de Administración (factor sin
  verificar, 0 intentos). No es la contraseña.

### PARA LA PRÓXIMA SESIÓN (actualizado 14/10, sesión de decisiones hecha)

**Plan aprobado 14/10:** `docs/superpowers/plans/2026-10-14-cerrar-directorio-y-certificacion.md`.
Alcance: **A = D2 + Cert 2a, B = Cert 3 + D3, C = D4 + Cert 2b + Cert 4 + D5, las tres completas.**
**Método nuevo (el usuario: "los subagentes son los que hacen que se demore demasiado" y "muchísimos tests"):** ejecución
inline, sin subagentes; un documento por entrega (HU + criterios + contratos + tareas, sin código); **un test por criterio
de aceptación**, sin mutación, guardas ni renders; suite completa una vez por entrega y solo si se tocó base compartida; un
despliegue por entrega; una revisión por entrega; tangentes a una lista. Contra los bugs torpes: **humo E2E** (6-8 recorridos,
Playwright, copia local `.superpowers/local-sim/`) antes de cada despliegue, y **tsc + vitest como barrera en
`deploy-frontend.yml`** (hoy CI no corre ningún test). xdist descartado.

**Decisiones 14/10 (todas las preguntas abiertas de A, B y C):**
- D2: el historial parte el día del despliegue (P7); la transferencia retroactiva se permite, nunca sobre un día firmado;
  la baja de empresa muestra vista previa del impacto (P4).
- Sin clasificar: "Confirmar N" para lo seguro (≥ 0,90); la renovación anticipada reemplaza al vigente (el anterior queda en
  el historial); dedupe por SHA-256 con "N duplicados omitidos" y enlace al original; descartar = borrado lógico con
  restauración; el menú se filtra por `documents.review` (Operaciones no lo ve, P19); sin OCR.
- D3: **la empresa que informa el TMS ("WebCarga SpA") se ignora; la empresa sale del Directorio a partir del conductor y la
  patente** (P11); RUT/patente los corrige Certificación con permiso y motivo, y una patente nueva conserva el mismo equipo
  con la vieja como alias (P12).
- Cert 3: "Pedir a Certificación" mínimo; Pablo lo valida en dev durante B.
- D4: la ficha de conductor/equipo lleva una tarjeta "Actividad" (último viaje, viajes de los últimos 30 días) y el enlace
  "Ver viajes en el Monitor" filtrado; no repite el Monitor (P18). Listas propias de conductores y equipos: sí (P17).

**Verificado 14/10 contra la base real (solo lectura) y el frontend → dos recortes decididos por el usuario:**
- **Sin clasificar casi no se usa** (152 ítems en total, 0 pendientes, el último de la semana del 28/09; ~330 documentos
  entraron por otros caminos en 5 semanas) → **Cert 2a en versión mínima**: menú por permiso, descarte lógico sin borrar
  el archivo, H1, dedupe por hash, renovación que reemplaza solo si vence después, "Enviar a Sin clasificar" con su tipo.
  Los grupos, "Confirmar N" y el lote por pares quedan diferidos hasta que haya volumen.
- **El Cierre se firma a diario** (29 días firmados, el último el 13/10) → **sin selector de fecha**: transferir y quitar
  son de hoy; la API acepta `effective_date` y rechaza los días firmados (409 `CLOSED_DAY`).
- Otros datos: 0 asignaciones con `end_date`; `start_date` desde el 15/07 (la migración) y 13 conductores + 14 equipos
  con inicio posterior al 03/09, por eso la siembra del historial usa `-infinity`; falta `btree_gist`; el historial de
  documentos vive en `audit_log` (`document_replace`); ninguna función de la base escribe asignaciones.

**Entrega 0, en curso (sin comitear):**
- `monitor-app/frontend/scripts/smoke/smoke.spec.ts`: matriz por rol (Supervisor de Certificación, Supervisor de
  Operaciones, Operador) que visita cada enlace del menú y exige que no haya errores de página, ni 5xx o 403 de la API, ni
  pantallas que se quedan "Cargando". Más la ficha de empresa del Directorio. Primera corrida: los 2 supervisores en verde
  (6,8 min). El Propietario queda fuera porque exige MFA y la copia local no tiene TOTP. Falta volver a correrla con el
  Operador.
- `.superpowers/local-sim/start.sh` (fuera de git): levanta la base (OrbStack), la API :8100 y la web :3100.
- **La barrera de vitest en CI no se puso todavía:** corrida sola, la suite da **20 fallos de 1.969, todos por el corte
  de 5 s** (8 min). Como barrera bloquearía despliegues por ruido. Antes hay que subir `testTimeout` y revisar esos 20.
  tsc está limpio (7 s).

**Avance 14/10 tarde (el usuario dijo "procede"):**
- vitest: `testTimeout: 20000` (`vitest.config.ts`) + `asyncUtilTimeout: 5000` (`vitest.setup.ts`): los 16 archivos que
  fallaban por tiempo pasan (305 tests, 83 s). Suite completa: **1.969/1.969 en verde, 200 archivos, 6,5 min**.
- `deploy-frontend.yml`: job `verify` (npm ci + tsc + vitest) y `build-and-deploy` con `needs: verify`. Sin comitear.
- Migración `20261017090000_fleet_assignment_periods.sql` escrita: `app.fleet_assignment_periods` (EXCLUDE con
  btree_gist), trigger `app.track_assignment_period()` en las 3 tablas, guarda `app.assert_day_not_closed` (lee
  `app.closure_periods.status = 'CLOSED'`, porque un día puede reabrirse), siembra `(-inf, inf)` y `app.carrier_of(tipo, id,
  fecha)` (la de 2 argumentos delega en ella). Probada en la copia local: A→B→A con `carrier_of` correcto por fecha, guarda
  y EXCLUDE. Ensayada con ROLLBACK en la base real: 273 períodos (92 + 133 + 48), 0 diferencias contra las asignaciones
  ACTIVE, ~2 s. **NO APLICADA: el clasificador de permisos bloqueó la escritura en producción; espera la autorización
  del usuario.**

**14/10 tarde — la migración del historial se aplicó a la base real (18:58 UTC, con autorización del usuario):**
273 períodos (92 + 133 + 48), triggers en las 3 tablas. Después el usuario pidió **trabajar en local** ("el MCP está
conectado a otro proyecto, te aviso cuando esté conectado al de webcarga"): desde ahí todo corre contra la copia local
(`TEST_DB_LOCAL_PORT=55322`, ver `tests/conftest.py`). **Incidente mío:** una corrida de línea base desde un worktree de HEAD
(conftest viejo + `.env` copiado) llevó 83 tests a la base real por 7 min; todos con ROLLBACK y con la guarda de huella, nada
escrito, pero contra la instrucción. El worktree se borró.

**Entrega A — HECHA EN LOCAL, sin comitear ni desplegar** (doc `docs/superpowers/plans/2026-10-14-entrega-a-d2-sin-clasificar.md`):
- Migraciones nuevas, aplicadas SOLO en la copia local: `20261017100000_trip_fleet_resolution_by_day.sql` (la vista del
  Monitor juzga conductor y tracto con la empresa del día del viaje) y `20261017110000_ingest_items_soft_discard.sql`.
  (`20261017090000_fleet_assignment_periods.sql` ya está en la base real.)
- Backend: `services/fleet_assignments.py` (asignar/transferir/terminar/reincorporar con fecha, clientes con vigencia,
  impacto de la baja, reactivar eligiendo flota; 409 `CLOSED_DAY`); `carriers.py` sin `_transferir` ni la protección por
  fila (Mage ya no escribe); endpoints `/shippers` POST/DELETE, `/deactivation-impact`, `/reactivate`. El pre-cierre ya no
  escribe el directorio (P11 y P10: se borró `aplicar_correcciones`). El Cierre usa el roster del día
  (`tractoreo_roster_cte(día)`, `tractoreo_roster_by_day_cte` para el reporte, `carrier_of(…, día)`); `in_scope_sql` sobre
  `app.active_fleet` (M4); topes de la guarda de D1 bajados a 0 en el Cierre. Sin clasificar: dedupe por SHA-256 (una
  consulta por lote, también dentro de la tanda), H1 (`carrier_of` del titular sugerido), tipo declarado por id o por
  código+entidad, descarte lógico + `/restore` + `?status=discarded`, renovación solo si vence después (`vencido_predicate`).
  Orden del Directorio con desempate por id.
- Frontend: vista previa de la baja (`BajaReasonModal` con prop `impact`), `ReactivateCarrierModal`, `CarrierClientsModal`
  ("Editar clientes" en la ficha), Sin clasificar solo con `documents.review` (menú y conteo), aviso de duplicados,
  `DiscardedItems` con Restaurar, "Enviar a Sin clasificar" en el grupo Sin asignar del lote de Pendientes, M5 con
  `hoyEnChile()`.
- Tests: A1-A11 y S1-S6 escritos y en verde en la copia local; fixtures de asignación con `start_date` 2020 (con historial,
  una asignación creada hoy no existía el 10/06). Suite completa del backend en la copia local: 1.665 verdes, 83 rojos que
  **también fallan con el código de HEAD** en la misma copia (faltan catálogos: motivos de anulación, estados del TMS,
  motivos de no asignación, firmas). Frontend: tsc limpio (fuera de `.next/`), vitest del área en verde.
- Copia local al día: `align_ids.sql` (id de TRACTOREO igual al de producción) y las migraciones del 12/10 aplicadas.

**14/10 noche — el MCP de Supabase quedó conectado a webcarga (`viclzoftiudkepqnhekv`, confirmado con list_projects):**
- Ensayadas con ROLLBACK y APLICADAS (MCP `apply_migration`): `trip_fleet_resolution_by_day` (en 3.498 viajes, 0 cambios de
  MISMATCH de conductor y 0 de tracto; la vista tarda 7 ms) e `ingest_items_soft_discard`.
- **Hallazgo contra la base real:** la guarda de día cerrado rechaza (bien) una asignación ACTIVE con `start_date` anterior a
  un día cerrado. Los fixtures de tests que "retrocedían" asignaciones fallaban en la base real (no en la copia local, que no
  tiene días cerrados). Se resolvió con `asignacion_previa` / `insertar_asignacion` en `tests/conftest.py` (crea hoy y
  extiende el período hacia atrás, igual que la siembra) en 17 archivos de tests.
- **Revisión propia:** si se firma HOY, un cambio sin fecha quedaba bloqueado sin salida (la pantalla no pide fecha). El
  servicio ahora usa el primer día abierto (hoy, o mañana si hoy ya se firmó). Test A2b.
- Humo E2E en la copia local: 6/6 en verde.

**Siguiente paso exacto:**
1. ~~Suite completa del backend contra la base real~~ **HECHO: 1.751 verdes, 1 rojo** (`test_a_las_2230…`: fijaba hoy en un
   día ya cerrado y creaba una ACTIVE; ahora usa INACTIVE para probar el default). 52 min. Commit y push a `dev` (14/10,
   autorizado por el usuario).
2. Recorrido en dev con sesión (Directorio: transferir, clientes, baja con vista previa, reactivar; Sin clasificar:
   descartar/restaurar; Pendientes: Enviar a Sin clasificar), AGENTLOG, y documento de la Entrega B.

**14/10 noche — Entrega A DESPLEGADA en dev** (`af2f5016`; los 4 workflows en verde, incluida la barrera tsc + vitest).
- GitGuardian alertó por la contraseña de los usuarios ficticios de la copia local en el humo y en este
  AGENTLOG: 0 usuarios @sim.local en la base real. `1738b5cc` la saca del repo (`.superpowers/local-sim/sim.env`, fuera de
  git). Sigue en commits viejos: reescribir la historia solo si el usuario lo pide.
- **Tipo de operación de Sodimac (pregunta del usuario):** el tipo sale del tracto; el portal de Sodimac nunca manda patente
  (0/56 en 30 días), así que 38 viajes quedan sin tipo. Propuesta: tipo por defecto declarado por cliente como respaldo. Pero
  hay 7 tractos que cruzan clientes (Equipo Completo haciendo Walmart, Tractoreo haciendo Iansa), y la definición de negocio
  (A arreglo del tracto / B servicio del cliente / C quién pone la rampla) no está clara → **Google Sheet para el equipo**:
  https://docs.google.com/spreadsheets/d/1DV6WDXKwW-bheQI_a5zkKnsiKZ74vXvdAsgrFNL6gZQ/edit (sin compartir; lo comparte el
  usuario). No se construye nada hasta tener la respuesta.
- Siguiente: documento de la Entrega B (Cert 3 + D3).

**14/10 noche — Entrega B EJECUTADA** (doc `docs/superpowers/plans/2026-10-14-entrega-b-panel-documentos-d3.md`, aprobado:
sin override por campo, pedidos = Operador y Supervisor de Operaciones, RUT/patente = Supervisor de Certificación).
- Base: `20261018090000_requests_and_plate_aliases.sql` APLICADA (certification_requests, asset_plate_aliases,
  resolve_trip_fleet con alias de patente y empresa del día del viaje).
- Backend: panel `…/documents` + `entity_documents.py`; `entity_summary` sobre `document_state_sql`; pedidos
  (`/certification-requests`); corrección de RUT/patente (`/drivers|assets/{id}/identity`, motivo, auditoría, alias);
  RUT de empresa con duplicado canónico; tipo de operación que se puede quitar.
- Frontend: "Pedir a Certificación" en las fichas y en la vista rápida del Cierre, bloque "Pedidos de Operaciones" arriba de
  Pendientes + contador en el menú, corregir RUT/patente en las fichas, chip único de tipo en Certificación.
- Tests: P1-P7 y D1-D6 en verde; backend del área 424 en la copia local; vitest 1.976/1.976; humo 7/7 (incluye pedir y
  resolver). Suite del backend contra la base real: corriendo.
- **El Google Sheet del tipo de operación se rehízo como formulario** (mismo enlace; 8 preguntas, celdas amarillas).
- **DESPLEGADA en dev** (`2533415b`): suite contra la base real 1.761/1.761 (47 min); Deploy Monitor API y Deploy
  Frontend en verde.
- **Recorrido en dev con sesión (14/10 noche, Propietario, solo lectura, sin guardar nada):** ficha de empresa (clientes
  Colun/Walmart + "Editar clientes"; baja con vista previa: 1 conductor, 2 equipos, 0 viajes hoy, 10 días abiertos;
  cancelado), ficha de conductor (13 documentos, "Corregir RUT" abre y se cancela), ficha de equipo ("Corregir patente",
  tipo con "Sin clasificar"), Certificación (un solo chip "Equipo Completo"), Pendientes (sin pedidos), Cierre (vista
  rápida con "Ver documentos": 13 filas, "Pedir a Certificación", sin subir) y Monitor. 0 errores de página o de API.
- **Bug hallado y corregido** (`d622834a`, desplegado): "Descartados (85)" listaba los descartes viejos, sin archivo;
  ahora solo los lógicos → "Descartados (0)" en dev.
- Siguiente: documento de la Entrega C (D4 + Cert 2b + Cert 4 + D5).
- Esperando: respuestas del equipo en el Google Sheet (tipo de operación); Pablo valida "Pedir a Certificación";
  dato del tracto GPRZ30.
- Tangentes anotadas: purga de blobs descartados (> 30 días); quitar de la UI del pre-cierre el grupo
  `EMPRESA_NO_RECONOCIDA` (ya siempre vacío) y la rama `PATENTE_EMPRESA` de "resueltas"; duplicados contra registros
  cargados por otros caminos (no guardan hash).

**14/10–15/10 — Entrega C CERRADA** (ejecución, pestañas de la ficha propia `535316c2` y alta única del popover
`34b3fac9`; detalle archivado en `AGENTLOG_ARCHIVE.md`). Nada de A, B, C ni D está en `main`.

**15/10 — Entrega D EJECUTADA** (doc `docs/superpowers/plans/2026-10-15-entrega-d-por-asignar.md`, maqueta
`docs/superpowers/mockups/2026-10-15-sin-clasificar-bandeja.html`; el usuario aprobó el diseño y el nombre "Por asignar").
- Por qué: Sin clasificar era una tercera forma de subir, con su propio modelo. Estándar (Ramp, Dext, Vanta): una forma
  de subir con el contexto que haya + bandeja solo de excepciones agrupada por qué falta.
- **Reconocedor único** (corrección del usuario a mitad de camino: "¿eso no es un parche?"): `match_document` con el
  contexto como acotación (`declared_requirement`, universo por empresa); se retiraron `match_owner`, `PendingOwner`,
  `OwnerCandidate`, `classify_owner_match` y `_dedup_candidates`. Servicio `services/upload_match.py`; `/pending/match`
  con `requirement_id` y `carrier_id` opcionales. Ronda de mutación acotada al reconocedor: 8/8 (dos tests agregados).
- **Una revisión de lote** (`BulkUploadReview` + `useBulkUpload`, prop de contexto y de disparador) en Pendientes, la
  ficha de empresa y Por asignar; lo no resuelto va a Por asignar al guardar (lotes de 50; respeta los errores por
  archivo de la subida). `PanelLateral` ganó `ancho="amplio"`.
- **Por asignar** = el banco de trabajo sin su carga: grupos Listos / Falta el titular / Falta el tipo / Sin pista,
  propuesta ya elegida, empresa en el detalle, Asignar/Descartar, Enter. Retirados `TriageDropzone`,
  `useEmpresaDeTrabajo`, `PuenteALaBandeja`. Test de nombres: "Sin clasificar" como módulo queda prohibido.
- Verificación: backend real 1.753/1.753; vitest 1.806/1.806; tsc limpio; humo 13/13. El humo encontró un bug real (la
  subida respondía 201 con el archivo en `errors` y la pantalla decía "En Por asignar"); corregido con test.
- **Copia local:** se le sumó el contenedor de almacenamiento (`supabase start -x studio,imgproxy,edge-runtime,
  logflare,vector,inbucket,realtime,postgres-meta,supavisor` desde `.superpowers/local-sim`); antes no tenía y ningún
  humo subía archivos.
- **DESPLEGADA en dev** (`9f24a0cd`, los dos workflows en verde). Recorrido en dev (solo lectura): Por asignar dice
  "Todo asignado" con "Subir documentos"; la ficha de Huemul › Documentos tiene "Subir documentos" junto a "Exportar
  todo"; sin errores de API. No se subió nada en dev.
- **Siguiente paso exacto:**
  1. **Fichas + navegación + kit — ENTREGA 1 DESPLEGADA en dev (15/10, `3c049997..cc5607b9`).** Plan
     `docs/superpowers/plans/2026-10-15-entrega-1-fichas-y-navegacion.md`, ejecutado inline (9 tareas + revisión final).
     - **Qué quedó:** kit en `components/ui` (`tabla/Table`, `ComplianceCounts` único con las pastillas de Pendientes,
       `ActionsMenu`, `CABECERA` sin mayúsculas); vista rápida con proveedor único en el layout y `EntityCell` como `<a
       href>` (clic = vista rápida, Ctrl/Cmd = pestaña nueva, siempre `stopPropagation`); fichas livianas
       (`components/directory/ProfileHeader`, `DetailsBlock`, formularios movidos de los paneles): conductor/equipo y
       empresa con encabezado + razón de lo que bloquea + ⋯; Documentos de conductor/equipo = `EntityDocuments` (Pendientes
       en chico, filas compartidas `SubjectDocumentRows` con `pendingRowStatus`); el modal sobre la ficha de empresa ES
       `FleetProfile variant="dialog"` (se borraron `DriverDetailPanel`/`VehicleDetailPanel`); nombres enlazados en
       Pendientes, Pedidos, detalle del viaje, Seguros (tabla), Por asignar (encabezado del detalle) y Documentos de la
       empresa; las listas pasan `?next=` con sus filtros.
     - **Backend:** `ComplianceSummary.blocking {own, fleet}` (de la misma columna `blocks` que `can_operate`);
       `/pending?entity_id` sin `carrier_id` ya no exige empresa (LEFT JOIN; la cola global sigue con ACTIVE) y trae
       `open_request_id`. Sin migraciones.
     - **Rulings del ejecutor (decididos sin preguntar):** segundo chip de conductor/equipo = `summaryStyle` (regla D-R8 de
       toda la app), no "Habilitado" como decía la spec; Documentos de la empresa conserva su partición (Vencido o falta ·
       Por vencer · Al día) con el control del kit; la subida en lote de la ficha de una persona usa el contexto de su
       empresa; reasignar exige `documents.review` (el panel lo mostraba con `documents.upload` y respondía 403); en
       Seguros solo la tabla enlaza (la tarjeta del teléfono es un botón); en Por asignar solo la empresa del encabezado;
       "volver" a la lista de empresas dice "Volver al Directorio" (glosario).
     - **Lo que encontró la verificación y se corrigió:** el humo halló que "Pedir a Certificación" de Operaciones se había
       perdido al migrar Documentos (→ `RequestToCertification`); la revisión final (opus) halló 5 importantes, todos
       corregidos con test RED→GREEN: la vista rápida no se cerraba al navegar; Escape/Tab entre capas (pila
       `lib/ui/layers`); la razón salía de `…/compliance-records` (sin invalidar, firma URL) → ahora de las mismas filas de
       `/pending` que Documentos, y F2 real (lo que bloquea en `/pending` = `blocking.own`, verificado en base real);
       nombre del sujeto en Documentos de la empresa; Activar/Reactivar fallaban en silencio. La captura final halló
       "Subir documentos" duplicado en Documentos.
     - **Verificación:** vitest 1.819/1.819 (202 archivos); tsc y build OK; humo 20/20 (copia local, 4 recorridos nuevos);
       backend del área 183 en copia local y 181 + F2/F3/RF1/open_request contra la base real (revertidos); trinquetes
       bajados (color crudo 1.216, `<h1>` 8, bajo 11 px 172); Deploy Frontend y Deploy Monitor API en verde; recorrido
       en dev (Propietario, solo lectura): ficha de conductor con razón y Documentos, Pendientes → vista rápida → ficha
       (el panel se cierra) → Volver, ficha de empresa; 0 errores de consola, todo 200.
     - **Menores diferidos:** nombre de conductor vacío se puede guardar (heredado); "Ver documentos" junto a "La empresa
       no está activa"; Documentos sin columna "Actualizado" ni ⋯ por fila; `BulkUploadReview` con `carrier_name` nulo;
       `ActionsMenu` sin flechas ni foco al abrir; ícono de subir en "Pedir a Certificación"; el chip de un renglón se corre
       cuando tiene "Agregar vencimiento".
     - **ENTREGA 2 HECHA (15/10, `7e80fd66`)**, plan `docs/superpowers/plans/2026-10-15-entrega-2-empresas-y-por-asignar.md`,
       inline, solo pantalla. Empresas: "Agrupar por" = `SegmentedControl` (Conductor/Vehículo quedan como enlaces al
       Directorio FUERA del control), encabezados de columna en el embudo (`COL` comparte anchos entre encabezado y fila;
       en teléfono los anchos no rigen y la barra se oculta, porque si no el nombre desaparecía), "Nueva empresa" botón
       lleno en `EncabezadoDePagina` junto a "Actualizar por planilla" (visibles en las dos agrupaciones). Por asignar:
       `CABECERA`, nombre de archivo en `text-dato` sin mono, sugerencia en una línea truncada (requisito · `EntityCell`
       del titular · % gris; ancho escalonado `w-36 sm:w-56 xl:w-72`, "Subido" oculto en teléfono), avisos con ícono
       `text-warning` dentro de la celda del archivo (sin franja `bg-espera`), título sin total. Tests E2-1..E2-7 (uno por
       criterio) + 2 tests viejos de "N viajes · 30 días" ajustados. Área 271/271, tsc OK, humo 20/20 (2 fallaron por
       contención con vitest en paralelo y pasaron solos), trinquetes 1.194 / h1 7 / bajo 11 px 167. Capturas escritorio
       y teléfono en `.playwright-mcp/e2-*.png`. **Desplegada** (Deploy Frontend verde) y recorrida en dev (Propietario,
       solo lectura): Empresas con columnas y las 36 activas, Por asignar con encabezado y "Todo asignado" (la cola de dev
       está vacía, así que la tabla nueva solo se vio en la copia local); 0 errores de consola.
     - **Listas del Directorio con el kit (15/10, `69c4f888`)**, a pedido del usuario ("me aparece una mezcla de modal
       antiguo/nuevo"; eligió "las 2"): en Directorio › Empresas el clic en la fila abría `TransporterSlideOver`, un
       tercer resumen de la empresa con diseño viejo (anillo, checklist, mayúsculas), que la Entrega 1 no retiró. Ahora la
       fila y la tarjeta abren la ficha con `?next=` y el modal se borró. Ciclo de vida y habilitación con
       `SegmentedControl` (las tarjetas de cifras `AlertStatTiles` salen de esta pantalla; siguen en Seguros), `CABECERA`,
       "Nueva empresa" en el encabezado, `Estado` para cargando/vacío/error, sin conteos "0" en vuelo. Conductores y
       Equipos: cabecera del kit y la fila entera abre la ficha. `ViewToggle` sobre `SegmentedControl` (también el
       Monitor). Tests L1-L6 + ViewToggle (L6 y L1 de FleetList verificados con mutación). Área 1.419 (10 fallaron por
       tiempo con la máquina cargada y pasaron solos, 330/330), tsc OK, humo 20/20 (2 logins lentos, pasaron solos),
       trinquetes 1.142 / bajo 11 px 163. Desplegado (Deploy Frontend verde) y recorrido en dev (Propietario, solo
       lectura): la fila de Hasa Spa abre su ficha con `?next=`, atrás vuelve a la lista; sin modal, 0 errores de dev.
     - **Forma a ancho real + Directorio/Certificación parejos (15/10, `9fa50274`)**. El usuario: "¿por qué quedan tantos
       huecos vacíos?" y "revisa todo lo asociado a directorio y certificaciones". Auditoría de 19 pantallas a 1440 px.
       Maqueta en el companion (`.superpowers/brainstorm/56411-1792100703/content/ficha-ancho-real-2.html`), aprobada con
       una corrección: "todos los elementos completamente alineados" → las pestañas van arriba de la grilla.
       - `components/directory/ProfileLayout` (+ `AsidePanel`): sección al centro y panel fijo de 340 px (Detalles,
         Actividad, Contactos). Conductor y equipo SIN pestañas; empresa con Documentos · Conductores · Equipos ·
         Seguros (Resumen y Contactos dejan de ser pestañas; `?tab=resumen|contactos` abre Documentos).
       - `FleetRosterTable`: la flota de la empresa como tabla (borra DriverRosterCard/VehicleRosterCard).
       - Seguros y Certificación › Requisito con el kit; buscador "Nombre o RUT".
       - Errores: rol de contacto crudo ("LEGAL_REP" → `contactRoleLabel`); pestañas con "0" en vuelo; chip de estado en
         zigzag (las acciones de la fila en un bloque `ROW_ACTIONS_WIDTH` que las cabeceras reservan: título "Estado" y
         chips medidos en la misma x); "Vehículos" → "Equipos".
       - Ruling: la ficha de conductor/equipo tiene "Subir documentos" arriba (`BulkUploadReview trigger="button"`) además
         de la franja de Documentos, como en la maqueta aprobada. En Pendientes, un rol sin acciones ve la columna de
         acciones vacía (es lo que alinea la cabecera).
       - Verificación: vitest completo 1.825/1.825, tsc OK, humo 20/20 (3 recorridos ajustados a la forma nueva), trinquetes
         1.084 / bajo 11 px 158, capturas locales a 1440 y 390. Desplegado (Deploy Frontend verde) y recorrido en dev
         (Propietario, solo lectura): empresa, su pestaña Conductores, conductor, equipo, Seguros y Requisito; 0 errores de
         consola; "Estado" y los chips medidos en la misma x (486 px).
     - **Monitor (15/10, `c7057639` + `bce90d88`, desplegado):** "Origen · Carga" ordenable (`sort_by=origin` usa la
       definición única `services/origen_del_viaje.py` vía `_SORT_EXPRESSIONS`; la guarda
       `test_origen_del_viaje_una_definicion` sigue verde) y columnas Estado · Fecha · TMS · ID Viaje · Patente ·
       Conductor · Origen · Destinos · Temp · EETT. Verificado en dev: 200 asc/desc, orden alfabético, 0 errores.
       El primer deploy falló por el trinquete de color crudo (copié `hover:bg-gray-50`); corregido con token.
       ~~8 tests de integración fallando en la copia local~~ **RESUELTO 15/10 (`d6c21abd`):** la copia local tenía
       catálogos ficticios mínimos; ahora lleva los reales (`.superpowers/local-sim/seed_catalogs.sql` + cleanup) y
       los tests que elegían datos de producción crean su sujeto. Suite del backend en local: 0 fallos.
     - **Seguros (auditoría, spec, E1 y E2): CERRADO y en dev (15/10, `4b89eeb0..245684d5`), archivado.** Las dos
       migraciones de E2 aplicadas en la real con autorización (20261021 solo agrega; 20261022 contracción con copia en
       audit_log: 33 pólizas y 294 cuotas copiadas, 60 pagadas intactas). Recorrido en dev con sesión: Pólizas, ficha,
       Cuotas y empresa › Seguros, 0 errores de API. Pendientes que no son de código: (a) Mage
       `bronze_to_silver_insurance_sync` (manual) escribe las columnas borradas: falla si alguien lo corre; decidir si se
       retira; (b) validar con Pablo renovar vs extender; (c) dato raro: una póliza vigente hasta 23/03/2076 (Chubb, tipeo
       probable); (d) 4 de las 6 empresas "vencida y vigente" no tienen candidata de renovación a ±30 días: siguen
       Vencida hasta que alguien enlace. Local: usuario `seg@sim.local` (Supervisor de Seguros) para el humo.
     - **Configuración, Parte 1 DESPLEGADA en dev (16/10, `9a5dd9a2..c990e267`).** Spec
       `docs/superpowers/specs/2026-10-16-configuracion-en-tres-partes-design.md`; plan
       `docs/superpowers/plans/2026-10-16-configuracion-parte-1.md`. Índice único a la izquierda (SettingsIndex) y rutas
       `/settings/[area]/[section]` (redirige `?section=`/`?estado=` viejos); un solo patrón lista + panel (SettingsList +
       settings-sources: estados, 7 vocabularios, umbrales por área, rangos, reglas del Monitor); área nueva Seguros ›
       Alertas de vencimiento (`insurance.configure`, `poliza_por_vencer`); Personas y Roles con el kit y legibles solo con
       `users.manage`; claves de permiso `area/section`; el color sale del significado (`boardColumnStyle` por columna del
       tablero, también el Monitor, GroupBuilder y los grupos por defecto; TMS, RM/Z0 y subtipo neutros). Migraciones
       aplicadas en la real con autorización: `20261024080000` (default de color) y `20261024090000` (95 colores a
       audit_log, vistas `asset_compliance_status`/`carrier_asset_roster` recreadas, columnas borradas). Transitorio
       aprobado: Condiciones, Orígenes y Clientes del TMS siguen en el índice con su pantalla vieja. Verificación: vitest
       1805, backend 1796, humo 23/23 (nuevo P1.9), build; dev recorrido (Configuración y Monitor, 0 errores de API).
       Revisión opus: 1 crítico (caché compartida de umbrales) + 2 importantes + 6 menores corregidos con test; diferidos:
       #4 (frontend viejo vs API nueva entre deploys) y #8 (`settings.manage` sin sección = página en blanco). La copia
       local lleva catálogos reales (memoria `reference_copia_local_catalogos_reales`).
     - **Configuración, Parte 3 DESPLEGADA en dev (16/10, `6f6b27b9..4d79ffe0`).** Plan
       `docs/superpowers/plans/2026-10-17-configuracion-parte-3.md`, inline, 8 tareas + revisión final. Directorio ›
       Clientes (lista con Nombres del TMS, Lugares · orígenes, Empresas, Viajes 30 días; filtros Activos/Inactivos/Sin
       vincular; alta; tarjetas en teléfono) y ficha de cliente (pestañas Lugares = `LocationsBrowser` del Tarifario con
       Origen, Empresas = `CarriersTable`; aside Detalles + "Cómo lo llaman los TMS"; ⋯ renombrar/desactivar/reactivar;
       "Ver en el Monitor" por id). Orígenes y Clientes del TMS salen de Configuración (las URLs viejas redirigen);
       el Tarifario ganó filtro Orígenes y columna Cliente. Piezas comunes: `LocationsBrowser`, `useClients` (una caché),
       `ProfileBreadcrumb`, ciclo de vida de clientes/lugares en el glosario, zonas del catálogo. Usuario local
       `com@sim.local` (Supervisor Comercial) para el humo.
       - Revisión opus: 0 críticos, 3 importantes + 8 menores corregidos con test. El más serio (anterior a la entrega):
         el trigger de lugares buscaba al cliente por nombre → renombrar cortaba el alta de lugares en silencio. Migración
         `20261025090000_trip_stop_location_by_shipper_id.sql` (resuelve por `t.shipper_id`; medido 0/1.012 diferencias)
         **APLICADA en la real (16/10, con autorización)**: ensayo con ROLLBACK, aplicada, verificada en vivo.
       - Verificación: vitest 1.852, tsc y build OK, backend del área 134, humo P3.8, trinquetes 819→797 y 110→105.
         Deploy Frontend y Deploy Monitor API en verde. Recorrido en dev (Propietario, solo lectura): Clientes (13
         activos), ficha de Iansa (178 lugares · 7 orígenes, 4 empresas, 54 viajes), Tarifario › Todos los locales con
         Cliente y Orígenes; todas las API 200, 0 errores de consola.
       - Menores diferidos: la ficha mezcla `commercial.read` y `directory.read`; carrera vincular vs desactivar
         (anterior); Monitor con `?client=` sin chip si el cliente no tiene viajes en la vista; zonas aún en código en
         `_OPERATION_TYPE_META` y `RouteEditor`; "Sin clasificar" mientras llega `/trips/meta` y "Por revisar 0" mientras
         carga; pestaña Empresas sin paginar (100); la ficha de Empresa con su propio rastro de navegación.
     - **Configuración, Parte 2 DESPLEGADA en dev (16/10, `638117b7..eafb02fe`).** Plan
       `docs/superpowers/plans/2026-10-17-configuracion-parte-2.md`, inline, 7 tareas + revisión final opus.
       Certificación › Documentos exigidos: lista (`/dashboard/compliance/requirements`: filtros Entidad y Estado con
       conteos, columnas Documento · Se exige a · Vence · Aviso · Cumplen · Revisión, tarjetas en el teléfono) y ficha
       (`…/[id]`: cinco preguntas, cada "Editar" abre `CondicionPanel` con `section`; historial de la regla; "Quiénes
       no cumplen" → Pendientes con `?doc=`). Condiciones sale de Configuración vía `MUDADAS` (también `?doc=CODIGO`
       y el buscador). API: `GET /compliance-requirements/{id}` y `cumplen`/`exigidos` en la lista.
       - **Decisiones del usuario (16/10):** lote retirado de la UI y de la API (en 60 días nadie editó más de 2
         documentos a la vez); "Sin vigencia" = `!is_active`, un solo filtro (77, 75 del catálogo apagado del 09/10).
       - **Revisión opus:** 0 críticos, 3 importantes corregidos con test: (1) "cumplen n de m" mezclaba dos
         poblaciones; ahora `exigidos` sale de los mismos registros y predicados que Pendientes (`exigible_sql` +
         `in_scope_sql`), verificado en dev: la ficha de Mantención Cámara de Frío dice 37 no cumplen y Pendientes
         "Faltan 37"; en la real 0 casos cumplen > exigidos, 18-46 ms; (2) Mensuales = período de 1 mes; (3) si fallan
         las revisiones no se inventa "Sin revisar".
       - Verificación: vitest completo 1.815/1.815, tsc, build, backend del área 97+ en la copia local, humo 25/25
         (nuevo P2.7), trinquetes 797→787 y 105→102, capturas a 1440/390. Deploy Frontend y Deploy Monitor API en
         verde; recorrido en dev (Propietario, solo lectura): lista con 114 documentos, ficha, Pendientes; todo 200.
       - **Menores de la Parte 2 HECHOS (16/10, `9099356a`):** `CeldaAlias` dice el error al agregar (fuera `quitar` y
         `removeAlias`, sin uso; el DELETE del backend sigue); clave `clavesCertificacion.requisito(id)`; `CondicionPanel`
         y `NuevoDocumentoPanel` con tokens (trinquetes 787→769 y 102→97); comentario de `EncabezadoOrdenable`.
         **Quedan, por decisión:** un `SearchInput` compartido (12 copias en Monitor, Cierre, Directorio y Seguros: es un
         refactor entre módulos, preguntar antes); en el teléfono la ficha pone el costado antes de las preguntas
         (`ProfileLayout` compartido por todas las fichas).
     - **Índice de Configuración legible (16/10, `32ff265b`, desplegado y visto en dev).** El usuario: "se ve muy tosca…
       no se entiende realmente lo que hace". Mismo `SettingsIndex` con prop `variante`: en escritorio se titula
       "Configuración", explica el número ("lo que falta revisar", y el enlace lo nombra para lectores de pantalla) y
       muestra el propósito de cada ajuste al pasar el mouse; en la portada del teléfono, el propósito va bajo el
       nombre. Títulos de área legibles. "Subtipos de vehículo" → "Subtipos de equipo".
     - **Entrega 2 de fichas: revisada 16/10, sin pendientes de código.** Cabos sueltos: la tabla de Por asignar nunca
       se vio con datos en dev (la sube Pablo/Carla) y los menores diferidos de la Entrega 1 (lista de arriba).
     **Siguiente:** con la Parte 2, la spec de Configuración y la de fichas y navegación quedan cerradas (fuera: Cmd+K).
       No hay paso siguiente de código decidido; elegir entre los menores diferidos o lo que pida el usuario.
  2. ~~Alta del Cierre ante un RUT existente~~ **HECHO 15/10** (`2bd6dadf`, desplegado): el 409 en el Cierre ofrece
     "Ya está registrado: actualizar el cierre" (relee el cierre; el pendiente busca el RUT igual que el alta, así que
     el 409 solo ocurre con la pantalla vieja). La salida del 409 en `AltaDeFlota` pasó a ser del anfitrión
     (`yaExiste: { accion, usar }`). Test con mutación probada. No probado en dev (exige escribir).
  3. **Nada pasa a `main` (decisión del usuario, 15/10):** A, B, C, D y las Entregas 1 y 2 de fichas se quedan solo en `dev`;
     no volver a ofrecer el paso a producción hasta que el usuario lo pida. Pendiente de probar con datos reales: una tanda mezclada subida sin
     contexto (Pablo/Carla). Siguen esperando: el Google Sheet del tipo de operación, la validación de Pablo de "Pedir a
     Certificación" y el dato del tracto GPRZ30.
- Tangentes **resueltas 15/10 (`d6c21abd`):** "Asignar a 1 viajes" → "Asignar a este viaje"; el alta de equipo solo
  ofrece subtipo (carrocería) a lo que no es tracto. **Aplicadas en la real con autorización (15/10):**
  `20261023090000_fleet_service_type_without_power_unit.sql` (10 tractos sin el subtipo "Tractocamión", fila
  desactivada) y `20261023090100_drivers_strip_null_marker.sql` (2 conductores con "\N" al final del nombre).
  10 y 2 filas, con copia en audit_log; verificado: 0 tractos con ese subtipo, 0 nombres con el marcador.

1. ~~Mirar M2 en dev~~ **HECHO 12/10 noche:** chip gris "Dada de baja" y "La empresa no está activa", sin "se puede asignar".
   Ojo: abrir un viaje con divergencia TMS deja una nota "sistema" a nombre de quien lo abre (`_log_tms_divergence_once`,
   comportamiento de julio, una vez por valor): un recorrido "de solo lectura" no es 100 % de solo lectura en el Monitor.
2. **Certificación 2a — Sin clasificar, opción B** (elegida 12/10): brainstorming → spec. Quedan sus preguntas §6.
3. **D2 "Asignaciones con vigencia"** (hoja de ruta del informe del Directorio §5): conductor–empresa, equipo–empresa y
   **empresa–cliente** (P10: se declaran, los viajes proponen; editar clientes F-30 pasó a D2), reactivar eligiendo la flota
   (P3), `carrier_of` con fecha, Cierre juzga con la empresa del día, `daily_closures.py` adopta `carrier_of`, atribución "al
   término" de equipos (F19), `in_scope_sql` sobre `app.active_fleet` (M4).
4. **Deuda anotada de D1** (ledger SDD, triage de la revisión final): fechas del navegador en UTC en `vigenciaDeLaFila` y
   `expiryRelative` (M5; `/pending` no trae `days_to_expiry`); PATCH guarda patentes crudas (M6, D3); chip "Tractoreo" doble
   en la ficha de Certificación (D4); encabezados ESTADO/FECHA superpuestos en la tabla del Monitor (anterior a D1);
   "sin actualizar hace N días" para documentos que faltan (redacción); orden del Directorio sin desempate por id.
5. **Validar con Pablo:** D7 "Pedir a Certificación". (P14 resuelta: solo aviso.) Dato de Operaciones: tracto GPRZ30 sin
   tipo ni empresa (28 viajes fuera del Cierre).

### 2026-10-12 (noche) — Bitácora: "Divergencia TMS" pasa a ser una nota automática del sistema — DESPLEGADO en dev

Pedido del usuario: la nota la genera el sistema, no se le atribuye a nadie, y no debe escribirse al abrir un viaje.
Commits `b3d9e7c7..9a3e9d19`; migraciones `20261016090000_tms_divergence_system_note.sql` y
`20261016100000_tms_divergence_normalized.sql` APLICADAS.
- `app.trip_notes.author_id` admite NULL solo para notas `sistema` (CHECK `trip_notes_author_required_unless_system`).
- La detección vive en `app.log_tms_divergence(uuid[])`, llamada desde `app.resolve_trip_fleet()` (corre en cada carga del TMS;
  el trigger de dbt en Mage no se tocó). Solo vínculos manuales; compara normalizado (`public.name_tokens`,
  `public.canonical_plate`); una nota por valor; si falla, la carga sigue (WARNING en el log).
- `GET /trips/{id}` ya no escribe nada (se retiró `_log_tms_divergence_once`). La bitácora muestra "Sistema" (ícono Bot) cuando
  la nota no tiene autor.
- Datos: las 98 notas de divergencia que estaban atribuidas a quien abrió el viaje quedaron sin autor (copia previa en
  `audit_log`, entity_type `TRIP_NOTE`). Las demás notas `sistema` conservan su autor (ahí la persona hizo la acción).
- Medido: con texto exacto se habrían escrito 219 notas pendientes; normalizado, 52 divergencias reales. Con vínculos automáticos
  habría 2.788 "divergencias", 2.680 solo de formato (el TMS contra sí mismo): por eso solo manuales.
- Verificado con el usuario: los 19 viajes resueltos "por RUT" (`tms_rut`) están bien; en 7 el TMS manda el nombre abreviado
  (todas sus palabras están en el nombre completo del Directorio) y el RUT es el correcto. No hay nada que cuadrar.
- Suite backend completa 1.746 en verde; revisión (opus) aprobada.

### 2026-10-12 — Directorio D1 "Una sola respuesta": EJECUTADO (subagent-driven, dos carriles) y DESPLEGADO en dev

Spec `docs/superpowers/specs/2026-10-12-directory-d1-one-answer-design.md` · plan
`docs/superpowers/plans/2026-10-12-directory-d1-one-answer.md` (16 tareas) · auditoría de estados
`docs/superpowers/plans/2026-10-12-states-audit.md`. Commits `dbe856fa..8754a13b` en `dev`. Nada a `main`, Mage sin tocar.

**Qué quedó (tres capas de estado + glosario único):**
- Base (migración `20261013090000_directory_one_answer.sql`, APLICADA 16:41 CL): `app.active_fleet` (única definición de
  flota activa), `app.carrier_of`, `carrier_management_types` sobre tractos activos, CHECK y NOT NULL en `operational_status`.
  Migración `20261015090000_retire_per_document_alert_thresholds.sql` (APLICADA 19:27 CL): 9 filas de umbral por documento
  copiadas al `audit_log` y borradas; queda solo el aviso global (30/0).
- Backend: `services/fleet_compliance.py` (base de Pendientes mudada sin cambios + resumen por entidad/empresa, `can_operate`,
  aviso `critical`/`warning`), `schemas/states.py`, guarda 409 de asignación (`services/assignment_guard.py`; ONBOARDING →
  `CARRIER_NOT_ACTIVE`; No habilitada → aviso `CARRIER_NOT_ENABLED`), identidad canónica de RUT y patente
  (`utils/identity.py`), filtro `enablement` en el Directorio, campos viejos retirados (`compliance_health`, `urgencia`,
  `funnel_group`, `expired_count`, `*_pending_docs_critical` del viaje, meta de umbrales). Guardas con trinquete
  (`tests/test_d1_single_definition_guards.py`).
- Frontend: `lib/states.ts` (glosario: Activa · En onboarding · Dada de baja; Al día · Por vencer · Vencido · Falta · Aún no se
  exige; Habilitada · No habilitada), los componentes solo pintan; trinquete de etiquetas en 0; "Sin clasificar" y "Directorio"
  en todos los textos; aviso "Crítico" en el checklist; Configuración › Alertas con aviso y crítico globales.

**Medido en dev:** 36 activas = 0 habilitadas (decisión del usuario: se muestra tal cual), 214 dadas de baja, 1 en onboarding;
78 conductores; embudo 2.226 por empresa = 2.226 por requisito = Pendientes; cifras iguales en Directorio, Pendientes y
Certificación para 2 empresas revisadas con sesión. Tiempos: Directorio ~100 ms, embudo ~150 ms, habilitación del Monitor
~110 ms; `/trips` igual que antes de D1 (1,9 s, logs de Cloud Run). Suites finales: backend 1.737, frontend 1.965, tsc y build OK.

**Decisiones del usuario (12/10, en el informe §7):** Sin clasificar = B; P13 (empresa + flota activa, por vencer cuenta como
al día); P8 (el tipo sale del tracto; medido: equivale a clasificar por empresa); P10; P3; P14 (solo aviso); P16/P20 (nombres);
"crítico" = aviso calculado; reactivar = recalificar; onboarding: se le piden documentos, no recibe viajes.

**Decisiones de arquitectura:** hechos de flota en la base, regla documental en un módulo de la API (materializar solo si la
escala lo pide); el embudo atribuye con LEFT JOIN (Postgres no expande `carrier_of`, 270 vs 150 ms) con excepción declarada en
la guarda; `daily_closures.py` y la atribución "al término" de equipos quedan para D2.

**Siguiente paso exacto:**
- [x] M2 mirado en dev con sesión (12/10 noche).
- [ ] Certificación 2a (Sin clasificar B): brainstorming → spec.
- [ ] D2: brainstorming → spec (asignaciones y clientes con vigencia).

### 2026-10-12 — Auditoría del Directorio y su sincronía con Certificación, Cierre y Monitor (solo lectura)

Pedido del usuario: "hay muchas inconsistencias; mismo ejercicio que Certificación; tiene que estar sincronizado con el
cierre y el monitor". Plan `docs/superpowers/plans/2026-10-12-directory-audit.md`; lentes A (UX medido en copia local,
`.playwright-mcp/directorio-*.png`), B (datos, base real, solo SELECT, 11/10 21:47-21:52), C (código); síntesis
`2026-10-12-directory-audit-findings.md`: **36 hallazgos (8 bloquean, 17 confunden, 11 costo interno), 8 causas raíz.**

- Cuatro superficies responden distinto a activo / empresa de / puede operar / está en el Cierre (p. ej. 215 empresas no
  activas en rojo; 84 vs 78 conductores; "Al día" con 7 faltantes).
- Asignaciones sin vigencia: 0 de 326 con fecha de término, fecha del traslado en UTC → transferir reescribe días pasados.
- 28 líneas del Cierre invisibles en la tabla bloquean la firma de 4 días.
- Sin invalidación entre módulos; `app.carrier_driver_roster` (vista materializada) sin trigger en `drivers`.
- Faltan trabajos: reincorporar flota quitada, corregir RUT/patente, editar clientes (pedido 02/10 y 09/10).
- El recálculo del Cierre renombra conductores / reasigna tractos sin override por campo; Operaciones ve botones que la API rechaza.

**Recomendación: alternativa B (dominio "directorio")**: funciones canónicas en la base + ficha única + asignaciones con
vigencia vía historial por trigger (cubre a Mage sin tocarlo) + override por campo + invalidación por dominio.

**Siguiente paso exacto:**
- [x] **12/10: el usuario elige B.** Mage ya no escribe empresas/conductores/equipos/asignaciones (todo migrado y gestionado
  desde la app): F-27 sale y Mage deja de ser escritor en el mapa (§7 del informe).
- [x] 12/10: P1 y P9 resueltas por decisiones previas; P6 = sí (vigencia por día); P5 = trazabilidad, nada se borra
  (§7 del informe). Quedan P2-P4, P7-P8, P10-P21 (varias con Pablo).
- [x] 12/10: P2 = C (Operaciones, operador incluido, da de baja conductores/equipos con permiso nuevo
  `directory.fleet_status`; la empresa, solo Certificación); solicitud de baja de empresa → bloque 3.
- [x] **Spec del bloque 0 aprobada:** `docs/superpowers/specs/2026-10-12-directory-block-0-design.md`
  (dos despliegues: 1 = Cierre un solo universo, fecha Chile, roster en vivo, pre-cierre no renombra; 2 = permisos,
  refresco entre módulos, frescura del Cierre, red mínima, flota de empresa de baja, Sin clasificar H2/H4).
  Spec aprobada (admin sin cambios). Plan `docs/superpowers/plans/2026-10-12-directory-block-0.md` (13 tareas, rulings
  R1-R16 + decisiones del usuario: Cierre habilitado desde el primer día firmado; activar ONBOARDING con directory.edit).
- [x] **Despliegue 1 en dev (12/10 ~03:25 UTC), commits `975f52d0..b2c80d98`:** Cierre con un solo universo desde el
  primer día firmado (03/09), migración `assignment_start_date_in_chile` APLICADA (4 tablas con default `hoy_chile()`),
  roster de conductores en vivo, el pre-cierre ya no renombra. Suites: backend 240, frontend 459, tsc y build OK; workflows
  verdes. Medido en dev: solo el 04/09 tiene líneas fuera del roster (2, ambas bloquean; son de una empresa de prueba) y
  se ven en el grupo "Ya no están en el roster" (`.playwright-mcp/directorio-b0-cierre-dev.png`).
- [x] **Despliegue 2 en dev (12/10 ~05:35 UTC), commits `c22fbfe2..1990490f`:** permiso `directory.fleet_status`
  (Operador/Supervisor de Operaciones y Supervisor de Certificación; verificado en `app.role_permissions`), baja de empresa
  solo con `directory.delete` salvo ONBOARDING→ACTIVE (lectura con FOR UPDATE), botones alineados con su permiso,
  `invalidateDirectory` único (lib/queries/directorio.ts) con test de cobertura, frescura del Cierre en `cierre-viajes`,
  confirmación de "Quitar del roster", un diccionario de estados, "Empresa dada de baja" en tarjetas/vista rápida/búsqueda
  del Monitor, Sin clasificar H2/H4. Suites: backend 259, frontend 1588/1589 (un timeout por carga, pasa solo), tsc y
  build OK. Revisión final de la rama: 1 importante (Monitor autocompletaba empresas ONBOARDING) arreglado. Recorrido en
  copia local: sin ningún 403 con Certificación, Supervisor de Operaciones y Operador (`.playwright-mcp/directorio-b0-*.png`).
  Rulings y menores diferidos: `docs/superpowers/plans/2026-10-12-directory-block-0-rulings.md`.
- [ ] Mirar dev con sesión iniciada (empresa dada de baja con flota, Cierre de hoy, Sin clasificar) sin guardar nada.
- [ ] Deuda anotada para D1: guarda en la API contra asignar viajes a una empresa no activa (hoy solo en el frontend);
  "Conductor habitual" ofrece conductores dados de baja; badge de Sin clasificar sin señal cuando falla el conteo;
  barra inferior móvil con etiquetas superpuestas (layout).
- [x] **12/10 tarde: brainstorming de D1 hecho.** Auditoría de estados (`docs/superpowers/plans/2026-10-12-states-audit.md`):
  Configuración no define estados de documento, solo reglas; `document_state` es el canon y 7 piezas lo reimplementan.
  Decisiones del usuario en el informe §7: P8 (ya resuelto por tracto, medido), P10, P13, P16/P20, P3 → D2, "crítico" = aviso
  calculado, reactivar = recalificar, clientes con vigencia pasan a D2. Spec escrita:
  `docs/superpowers/specs/2026-10-12-directory-d1-one-answer-design.md` (tres capas de estado + glosario único, `app.active_fleet`,
  `app.carrier_of`, `fleet_compliance.py` sobre la base de Pendientes, guarda 409, identidad RUT/patente, 3 despliegues).
- [x] Spec de D1 aprobada; **plan escrito** `docs/superpowers/plans/2026-10-12-directory-d1-one-answer.md` (`98b377f9`):
  16 tareas, 3 despliegues (T1-T10 base+API, T11-T15 frontend, T16 contraer). Decisiones del ensamblado: ONBOARDING se le
  piden documentos pero no recibe viajes (409); Monitor con `*_has_critical_alert` por entidad (conserva el rojo de licencia y
  cédula); `worst_state` solo de obligatorios; `daily_closures.py` a D2; las 36 activas saldrán "No habilitada" (se muestra
  tal cual). Código de T1-T4 ya corrió en copia contra la base real (32 verdes).
- [x] **D1 ejecutado y desplegado en dev (12/10 noche)** — ver la entrada de D1 arriba.
### 2026-10-11 — Auditoría UX de "Sin clasificar" (insumo del bloque 2; solo lectura)

Informe: `docs/superpowers/plans/2026-10-11-sin-clasificar-ux-audit.md`. Las capturas son `.playwright-mcp/sinclasificar-*.png`.
El recorrido se hizo en la copia local, con un lote ficticio que quedó en el volumen `webcarga-sim`. No se tocó
código de la app.

- **Hay 18 hallazgos.** Los 2 bloqueantes:
  - H1: la sugerencia AUTO es decorativa. El ítem no recibe `carrier_id` y el formulario no la lee.
  - H2: un error de la cola se muestra como "0 sin clasificar".
- **Altos:**
  - H3: callejón sin salida al elegir empresa.
  - H4: mientras carga, dice "no tiene pendientes".
  - H5: no hay lote real (`classify-batch` acepta 1 archivo).
  - H6: la empresa elegida queda pegada a las subidas siguientes.
- **Recomendación: Opción B**, cola de excepciones con revisión agrupada (modelo Ramp/Dext). La revisión es la
  misma que `BulkUploadReview`. "Enviar a Sin clasificar" se cablea junto con B y lleva el tipo ya conocido.
- **"Denso" no está registrado en ningún documento.** Lo más cercano es Pablo, 02/10, en Granola: "navegar
  dentro de aquí es enredado".

**Siguiente paso exacto:**
- [ ] El usuario decide entre A, B y C, y responde las preguntas de la §6, algunas con Pablo.
- [x] H2 y H4 corregidos y desplegados en dev (bloque 0 del Directorio, 12/10).

### 2026-10-11/12 — Certificación bloque 1 "Pendientes": EJECUTADO (subagent-driven) y DESPLEGADO en dev (`2f036cf2..094ee266`)

Spec `docs/superpowers/specs/2026-10-11-pending-documents-design.md` · plan `docs/superpowers/plans/2026-10-11-pending-documents.md`.
Workflows `Deploy Monitor API` y `Deploy Frontend` en verde (12/10 ~00:38 UTC). Ruta `/dashboard/compliance/pending`,
ítem "Pendientes" en Certificación. Nada a `main`, Mage sin tocar.

**Qué quedó:**
- Backend: `document_state_sql` + `in_scope_sql` (única definición, `vencimientos.py`), con rama ON_ENTITY_END (decisión del
  usuario 11/10: el finiquito entra si la empresa de la ÚLTIMA asignación está activa) y `ultima_empresa_sql` compartida con
  `resolved_carrier_id`. `/pending?state=` (alcance solo con `state`; sin `state` todo igual), `document_state`, `due_on`,
  `missing_validity_data`, `entered_on`. `GET /pending/summary?group_by=requirement|carrier`. `POST /pending/match` (no
  escribe; `match_owner` puro; RUT/patente gana al nombre; colisión: gana el estrictamente más fuerte, empate → todos "Por elegir").
- Frontend: lista y detalle por documento/empresa, URL `?by&doc&carrier&state`, "Todos" = lo pendiente, seis estados, teléfono,
  carga en fila (re-sube para "Completar") y en lote (de a 3, reintento sin repetir, `beforeunload`). `SegmentedControl` en
  `components/ui`, `periodoQueSeExige` y `hoyEnChile()` compartidos.
- Rulings: R1-R4 del plan + P1-P24 en el ledger de la ejecución (`docs/superpowers/plans/2026-10-11-pending-documents-rulings.md`).

**Verificación:** backend del área 286 + 158 verdes; frontend 1452 (área) + 638 tras los últimos arreglos; tsc y build OK.
Rendimiento (lectura, base real, 5.704 registros / 36 reglas activas): resumen 43 ms plan + ~210 ms ejecución en el servidor
(< 300 ms); ~350 ms con la red. Recorrido completo en la copia local (`.playwright-mcp/pendientes-*.png`), con 4 hallazgos ya
arreglados. Revisión final de toda la rama: 2 importantes arreglados (panel que se remontaba, doble "última asignación").

**Pendiente / deuda anotada:**
- [ ] **Mirar en dev con datos reales, escritorio y 390 px, sin subir nada** (falta sesión iniciada en el navegador de Playwright).
  Confirmar que la portada de Certificación, la ficha de empresa y el cajón siguen iguales, y que "Guardar" del lote no queda
  tapado por la barra inferior (arreglo `pb-24` solo verificado por clase).
- [ ] `periodoSugerido` (gesto de carga individual) ignora `period_offset_months`: hoy inocuo (F30_1 offset 1), pero la fila y el
  lote podrían proponer meses distintos. Migrar a `periodoQueSeExige`.
- [ ] La barra inferior móvil probablemente tapa el final de otras pantallas: arreglarlo una vez en `app/dashboard/layout.tsx`.
- [ ] Menores: subtítulos de empresa de la maqueta ("Tractoreo · 2 conductores"), chips "con error/por resolver", etiqueta
  "Ver por"; patentes en Bandeja (`match_document`) siguen sin aceptar guion; cada archivo guardado refresca toda Certificación
  (vigilar Disk IO); "Completar" requiere volver a subir el archivo.
- Sigue abierto del bloque: validar con Pablo D7 ("Pedir a Certificación", bloque 3) y responderle que el seguro de
  Certificación (SEGURO_*) no habla con Seguros (`insurance_policies`) a propósito. Bloques restantes: 2 Certificación como
  tareas (+ Sin clasificar), 3 panel de consulta único + "Pedir a Certificación", 4 Configuración › Certificación (L7).
  La spec/decisiones D1-D8 completas quedaron archivadas en `AGENTLOG_ARCHIVE.md`.
- "Enviar a Sin clasificar" desde el lote: **NO se hace** hasta rediseñar Sin clasificar (decisión del usuario 11/10).

**Siguiente paso exacto:** el usuario elige la opción (A/B/C) de la auditoría de Sin clasificar (entrada de arriba) y responde
sus preguntas abiertas; luego brainstorming → spec del bloque 2 con Sin clasificar como cola de excepciones conectada a Pendientes.

### 2026-10-11 — Auditoría de Certificación: simulación en copia local + bugs L1-L5 cerrados

Plan y hallazgos en `docs/superpowers/plans/2026-10-11-certification-audit.md` (secciones 4 y 5).

**La copia local** vive en `.superpowers/local-sim/` (fuera de git):
- Supabase local con el esquema de producción, solo estructura, en los puertos 5532x.
- Datos 100 % ficticios. La API corre en :8100 y la web en :3100.
- Usuarios: `cert@sim.local` / `ops@sim.local` / `owner@sim.local`; la contraseña está en `.superpowers/local-sim/sim.env` (fuera del repo).
- Para levantarla: `supabase start` en esa carpeta. Después la API con `api.env` (llave service_role en formato JWT) y `next dev -p 3100` con las variables `NEXT_PUBLIC_*` y `FASTAPI_URL` locales.

**Hecho:**
- L1 `b5375bd8`: la portada de Configuración leía `profiles.role`, que ya no existe.
- L2 y L4 (backend) en `21b20217`:
  - L2: `/pending` ya no cae si la empresa no tiene RUT.
  - L4: el alta crea los documentos con `requires_file = true`.
- L3, L4 (frontend) y L5 en `9f947b8f`:
  - L3: el cajón de Certificación muestra el error con "Reintentar" en vez de "No le falta ningún documento".
  - L4: el checklist del Directorio carga con archivo por defecto.
  - L5: en el Directorio, subir y reasignar exigen `documents.upload` y `documents.review`.
- Tests: backend 124 y frontend del área 951, todos en verde; tsc OK. Comprobado en la copia local: el supervisor de Operaciones solo ve "Ver".

**L6 NO se tocó (ruling):** a las entidades inactivas se les siembran pendientes a propósito, porque la siembra de una
entidad solo corre al crearla y reactivar a alguien la dejaría sin pendientes. El defecto es de lectura:
- el alcance del catálogo, la vista previa del efecto y las listas por conductor y por vehículo no filtran a los
  activos;
- la portada sí los filtra.

Arreglarlo consulta por consulta sería un parche. Va en el primer bloque del rediseño: **una sola definición de
alcance y de estado.**

**Decisiones del usuario (11/10):**
- **Operaciones ve los documentos y puede "Pedir a Certificación".** Esa acción funciona como notificación o
  disparador hacia el equipo de Certificación: crea una solicitud en su cola, con el contexto del viaje o del Cierre.
  No sube documentos.
- **El rediseño de Configuración y de Certificación (documentos) va junto**, alineado con las primitivas y el layout
  del detalle del viaje y la vista rápida. Se hace por brainstorming → maqueta → spec → plan, sin código antes de
  aprobar.

**Siguiente paso exacto:**
- [x] Brainstorming del rediseño de Certificación (bloque 1, Pendientes): spec escrita, ver entrada de arriba. Resto de bloques pendiente:
  - un panel único de documentos por entidad;
  - un solo estado y un solo alcance (incluye L6);
  - el "cubo" por documento;
  - "Pedir a Certificación";
  - un solo flujo para activar;
  - L7 (taxonomía vacía → lista vacía).
- [ ] Rediseño del detalle del viaje, opción (b) (ver la entrada de abajo).

### 2026-10-11 — Cierre de bugs pendientes (B1-B5) + diagnóstico para la próxima sesión

Pedido del usuario: "solo los bugs; el resto lo abordamos en otra sesión". Inventario hecho con tres
investigaciones de solo lectura (bugs, sincronización del detalle del viaje, Configuración).

- **Hecho:**
  - B1 `test_cargar_catalogo_webcarga`: el test no era hermético (el catálogo ya se cargó en la base el 08/10).
    Ahora aparta los ya cargados dentro de la transacción revertida; test nuevo: aplicar dos veces no crea nada
    la segunda. 15/15.
  - B2 `test_get_del_cierre_no_escribe_integracion[<lambda>2]`: pasa 3/3; el rojo fue un corte durante la
    ingesta. Cerrado como no reproducible; vigilar en la próxima corrida completa.
  - B3 `PanelLateral`: solo el modal (`dim`) atrapa el Tab; un clic en una barra de desplazamiento (de la
    página o de una lista) ya no cierra la vista rápida. 3 tests nuevos, vistos en rojo.
  - B4 `EntityQuickView`: un conductor o equipo sin empresa no ofrece "Abrir ficha completa" (llevaba a un
    callejón); dice "Sin empresa asignada: no tiene ficha propia." Test nuevo, visto en rojo.
  - B5 `test_padron_conductor.py`: los 7 tests que leen el padrón completo llevan `@pytest.mark.padron_completo`
    y solo corren con `--padron-completo` (hook en `tests/conftest.py`); la salida dice cuántos se saltearon.
    No se achicó el padrón dentro del test: exigiría un lock exclusivo sobre una vista que la app lee.
  - Dato para Operaciones (sin código): Sodimac 878052 tiene la rampla JF8307 como tracto.

**Para la próxima sesión (decisión del usuario 11/10: rediseño = opción (b), datos + organización de la pantalla):**
- **Detalle del viaje** (proyecto de arquitectura: preguntas → spec → plan). Hallazgos, con evidencia:
  1. Nada de lo que se edita en el detalle invalida `['cierre-viajes']`, `['daily-closure']`,
     `['equipment-closures']`; solo anular lo hace (`hooks/useAnularViajes.ts:11`). Al revés tampoco: bulkClose/
     bulkReopen del Cierre y las ediciones del Directorio no refrescan el viaje ni `['entity-summary']`.
  2. Viajes armados a mano tras mutar: `GestionPanel` (desvincular, revertir estado) e `IndicatorSwitches`
     (revertir Asignado deja `is_assigned` viejo).
  3. `tms_dropped` solo lo pone `list_trips`: tras editar, el aviso "Ya no está en el TMS" desaparece del Monitor.
  4. "Asignado" con cuatro definiciones; empresa sin conductor = "vinculado" en el detalle e "incompleto" en el
     Cierre, sin forma de completarlo desde el detalle. `daily_closures.py:87,178` lee `fl.driver_id` crudo.
  5. Documentos pendientes: el detalle cuenta con `pendiente_predicate` (solo obligatorios) y la vista rápida con
     `vencimientos` (todos los niveles).
  6. Las notas de sistema (vincular, desvincular, estado manual) no aparecen: no se invalida `['trip-notes']`.
  7. Abrir un viaje: ~6 idas a la base en serie y 5-6 pedidos HTTP; el GET puede escribir una nota
     (`trips.py:2443`); URL firmada por adjunto (`trips.py:3143`).
- **Configuración** (después, su propio ciclo): clave de caché `'taxonomies'` vs `'taxonomias'`
  (`estados-tabs.tsx:70` vs `condiciones-tabla.tsx:56,64`, `AltaDeFlota.tsx:90,96`, `VehicleDetailPanel.tsx:74`);
  `useConfigList` y cargas a mano sin caché; `UsersTable` copia la lista sin resincronizar (cuentas desfasadas);
  `FormularioDeRol` sin `key`; la lógica de tabla editable escrita tres veces; `CondicionPanel` 506 líneas.

### 2026-10-11 — Pasada visual del detalle del viaje — DESPLEGADA y verificada en dev (`9c447b1d`, `4f98e28e`)

Maqueta aprobada por el usuario ("si estoy ok"): `.superpowers/brainstorm/84727-1791741985/content/detalle-viaje-v3.html`.
Mismo contenido, mismas acciones; solo estilo, con las primitivas y tokens de la spec 2026-08-16.

- **Hecho:**
  - `AccordionSection`: título en minúscula gris con botón "Ocultar"/"Mostrar" (antes una flecha suelta junto a
    MAYÚSCULAS de 10 px). `StopTimeInput` nuevo reemplaza las cuatro copias del input de fecha de la tabla.
  - `TripDetailView`: encabezado blanco, estado y avisos en `StatusChip`, tabla de paradas con encabezado claro;
    columna Local de 220 px para que chip, nombre y tipo vayan en línea.
  - `GestionPanel`: `Section` + `KeyValueList`; avisos con un `Notice` local (tono como prop: urgent/warning);
    "Ocultar Gestión" / "Mostrar Gestión" con nombre accesible. `IndicatorSwitches` en fila rótulo/switch/"Lo define el TMS".
  - `TripNotesFeed`: sin texto de 9-10 px; tipo de nota, filtro y Feed/Documentos con un `SegmentedControl`
    local; chips con `StatusChip`; "Agregar nota" de tamaño normal a la derecha; el pin se ve también con foco.
  - `StopTimeline` a tokens. Textos de la maqueta: "Planificación", "Tipo de carga", "Cumplimiento",
    "Sin coincidencias: dar de alta empresa, conductor o equipo".
  - Trinquetes bajados: color crudo 1.672 → 1.406; tamaños bajo 11 px 260 → 214.
  - Tests: `components/dashboard` + `lib/ui` + `lib/copy` 721/721; tsc OK. Sin build (no hay rutas nuevas ni
    código compartido fuera del detalle).
- **Verificado en dev (Playwright, viaje 2070220):** 1440 px lado a lado con la maqueta y 390 px. Capturas
  `.playwright-mcp/detalle-real-v3-1440.png` y `-390.png`.
- **Fuera de alcance a propósito:** `FleetAssignSection` (lo comparten `TripAssignDialog` y `FleetCenterDialog`;
  todavía con `text-[10px]` y grises crudos) — pasada propia. Las fechas siguen con segundos (`fmtDT` de toda la app).

**Siguiente paso exacto (actualizado tras el cierre de bugs):**
- [ ] Próxima sesión: rediseño del detalle del viaje, opción (b) — brainstorming de arquitectura sobre los
      hallazgos de la entrada de arriba; después Configuración (incluye su pasada visual), su propio ciclo.
- [ ] Pasada de `FleetAssignSection` con las mismas primitivas (entra en el rediseño del detalle).
- [ ] Minuta: P4 ítem 20 (requisito → titulares + subir), P5 ítem 23 (clientes de una empresa), P7 respuestas a Pablo.
- [x] Deuda `test_padron_conductor.py`: cerrada con `--padron-completo` (B5).

### 2026-10-11 — Ítem 21: vista rápida de empresa, conductor y equipo desde el Cierre — DESPLEGADO y verificado en dev

HU `monitor-app/docs/user-stories/20261011/01-hu-entity-quick-view.md` (fuera de git a propósito) y maqueta
`monitor-app/docs/mockups/2026-10-quick-view/entity-quick-view.html`, aprobadas por el usuario (panel lateral,
teléfono como enlace para llamar). Plan `docs/superpowers/plans/2026-10-11-entity-quick-view.md`.

- **Hecho (`dedb957c`..`1cf3cdf7`):**
  - API: `GET /drivers|assets|carriers/{id}/summary` (`services/entity_summary.py`: una consulta, sin URLs
    firmadas, estado de cada documento con los predicados de `vencimientos.py`; suma "faltan").
  - API: las filas de `cierre-viajes` traen `carrier_id`, `driver_id` y `tractor_asset_id`.
  - UI: primitivas `Section`, `KeyValueList`, `StatusChip`, `DocumentStatusBar`, token `--warning`, `PanelLateral`
    con `overlay="none"`; `EntityQuickView` (variante por prop) y `useQuickView` (pila con "Volver");
    `EntityCell` en Flota y Viajes; rutas canónicas `/dashboard/drivers/[id]` y `/dashboard/assets/[id]`
    (`EntityRedirect`); "Volver al Cierre" en la ficha de empresa (`returnLink`).
  - Tests: backend 10 nuevos; vitest 1.745/1.745; tsc y build OK.
- **Verificado en dev (Playwright, Cierre 08/10):** conductor (Vidal Gallardo) con fila marcada; empresa dentro del
  panel y "Volver"; "Abrir ficha completa" → ficha de Hueraman con el panel del conductor y "Volver al Cierre";
  teléfono a 390 px a pantalla completa (sin "Esc para cerrar"). Capturas en `.playwright-mcp/qv-real-*.png`.
- **Decisiones:** panel lateral (no vista completa ni modal); endpoints de resumen en vez de reutilizar
  `GET /carriers/{id}` (firma una URL por documento); direcciones canónicas por id; reglas de estilo de la spec
  2026-08-16. El RUT queda sin puntos, igual que el resto de la app (formatearlo es una mejora para toda la app).

**Incidente del 11/10 (resuelto): Supabase estrangulado por Disk IO.**
- El proyecto estaba en **Nano** (`t4g.nano`) aunque la org es Pro (Supabase no sube el cómputo solo). Disk IO al
  100 %, memoria 80 %, CPU 50 %; checkpoints de 120-200 s y `ECHECKOUTTIMEOUT` del pooler.
- **El usuario pasó el proyecto a Micro** (~19:02 UTC); `SELECT 1` volvió a 0,7 s.
- `pg_stat_statements` (desde el 08/10): el mayor lector es **`public.sync_habitual_drivers()` desde
  `tests/test_padron_conductor.py`** (~6 GB leídos, ~21 s por llamada) más 5 consultas de ese archivo sobre
  `silver.int_habitual_driver_by_tractor`; el mayor escritor es la ingesta (normal).

**Siguiente paso exacto:**
- [x] Revisión final de la rama y su pasada de correcciones (`cc54f2e6`).
- [x] Pasada visual del detalle del viaje (ver entrada de arriba). Configuración sigue pendiente.
- [ ] Deuda: `test_padron_conductor.py` no debe correr por defecto contra el padrón completo (marca propia o
      padrón chico armado en el test). Si el Disk IO vuelve a 100 % en Micro, evaluar Small.

### 2026-10-11 — Cierre › Viajes: grupo "Asignación incompleta" (minuta 09/10 §2.4) — DESPLEGADO en dev

- **Decisiones del usuario (11/10):** entran los del día (activos o cerrados) y los activos de antes; bloquea la
  firma solo si es del día.
- **Hecho (`778bdeaa`, `ab764895` y la bajada):**
  - Backend: grupo `incomplete_assignment` en `SQL_GRUPOS_CIERRE`, definido una vez (`INCOMPLETE_ASSIGNMENT`):
    asignado y sin tracto o conductor resueltos (`v_trip_fleet_resolution`). Va antes que "Espera cierre del
    TMS" (un Sodimac con solo la rampla primero se completa, §2.3). Cada fila trae `missing_fleet`. `bloquean`
    suma los incompletos del día.
  - Frontend: `bloqueaLaFirma` pasó a función `(viaje, fecha)`; cada grupo declara su `action`
    (`declare`/`complete`/`none`); la fila muestra "Falta conductor/tracto" y "Completar asignación" (al detalle
    del viaje, con vuelta al Cierre, prop `tripHref`), sin motivo ni casilla. Columna "Resolver".
  - Tests: 6 de integración nuevos + 3 mutaciones; los sintéticos "asignados" de `test_cierre_viajes.py` llevan
    flota completa (antes no tenían y ahora serían incompletos); vitest 1.706; build OK.
- **Verificado en dev:** 08/10 muestra "Asignación incompleta 2" (2070220 sin conductor del directorio;
  IA161103 de Iansa "POR CONFIRMAR"), con "Bloquea la firma" y "Completar asignación".
- **Pendientes menores del ítem 5, resueltos:** test de que la copia escribe en `trips_manual`; guarda AST de
  ningún `pool.` dentro de `conn.transaction()` en las rutas de viajes; la guarda de INSERT ve `ON CONFLICT` y
  `RETURNING`. **Queda a propósito:** `app.resolving_fleet` vale toda la transacción; apagarlo reactivaría la
  resolución de flota en cada UPDATE posterior de la misma transacción (más Disk IO en cada corrida de dbt) y hoy
  no tiene efecto.

**Siguiente paso exacto:**
- [ ] P3, ítem 21: enlaces desde el Cierre (Flota y Viajes) a la empresa / `?driver=` / `?asset=`.
- [ ] P4 (ítem 20), P5 (ítem 23), P6 (menores) y P7 (respuestas para Pablo): ver la auditoría, abajo.

### 2026-10-11 — Ítem 5 de la minuta 09/10: activo y asignado del viaje en la base — DESPLEGADO (dev + base + Mage)

Spec `docs/superpowers/specs/2026-10-11-trip-assignment-in-the-database-design.md` y plan del mismo nombre, ejecutado
native con revisión final (opus). Ledger: `.superpowers/sdd/2026-10-11-trip-assignment-in-the-database/progress.md`.

- **Problema:** un viaje manual nacía "activo, no asignado" (la API escribía true/false fijos), y cualquier cambio de
  flota hecho en la app (manual o vínculo sobre un viaje del TMS) tardaba hasta 15 min, hasta la corrida de dbt. En
  ese lapso Cierre › Viajes lo ponía en Por resolver y bloqueaba la firma, mientras Flota ya lo mostraba asignado.
- **Decisión del usuario (11/10): opción B**, una sola definición en la base y varios llamadores. Se descartó
  disparar dbt por demanda desde la API (integración de 6 pasos, choque con la corrida de 15 min, Disk IO).
- **Hecho:**
  - Migración `20261012090000_trip_assignment_in_the_database` (aplicada): `app.is_trip_open`,
    `app.is_trip_assigned` y los triggers `trg_sync_trip_assignment_ins/_upd/_del` sobre `app.trip_fleet_links`
    (solo escriben si el valor cambia y respetan el override).
  - API: el alta manual llama a las funciones; las 4 rutas de edición (PATCH, vincular, desvincular, restaurar
    campo) escriben en una transacción, bloquean el viaje antes que el vínculo (mismo orden que dbt: sin deadlock) y
    la copia a `trips_manual` ya no se traga errores. Restaurar el override de Asignado recalcula en el acto.
  - Mage: `macros/viaje_activo_y_asignado.sql` llama a las funciones (subido con OK del usuario, 16:34 UTC); el SQL
    compilado las usa en las 3 ramas; paridad en vivo: 1 diferencia en 3.389 (`add6d7dc`, huérfano conocido).
- **Verificado en dev:** viaje A (manual, CERRADO con flota) nació inactivo y asignado y no apareció en Por
  resolver; viaje B (sin flota) apareció en Por resolver y salió al instante al vincularle conductor desde el
  detalle. Los dos anulados con "Cargado por error".
- **Para cambiar la regla de activo/asignado:** se edita la función con una migración, no la macro.
- **Minors diferidos (revisión final):** `app.resolving_fleet` vale toda la transacción; ningún test lee la copia en
  `trips_manual`; los tests mockeados no distinguen `pool` de `conn`; la regex de la guarda de INSERT no ve un
  INSERT con `ON CONFLICT` antes de las comillas.

**Siguiente paso exacto:**
- [x] P2: grupo `incomplete_assignment` (ver la entrada de arriba).
- [ ] P3 (ítem 21), P4 (ítem 20), P5 (ítem 23), P6 (menores), P7 (respuestas para Pablo): ver la entrada de la
      auditoría de la minuta, abajo.

### 2026-10-11 — Auditoría de la minuta 09/10 contra código, Mage y despliegues + cuenta al pie del sidebar

Plan: `~/.claude/plans/necesito-que-revises-completamente-synchronous-fog.md`. Cada ítem se verificó en código, en el
mirror de Mage y en git, no solo aquí.

- **Corrección al AGENTLOG:** la minuta 2.3 (Publicada de Sodimac fuera del Cierre) NO estaba hecha. c73d7127 solo
  saca las ofertas *retiradas*. **Decisión del usuario (D1): la Publicada viva queda en Por resolver**, a propósito.
- **Todo está solo en `dev`.** `main` sigue en el 01/08 (789 commits detrás); los dos stacks comparten la base.
  **D4: el Go Live del 15/10 corre sobre dev.** El merge a main queda como deuda (RBAC, scheduler y env vars de prod).
- **D2:** el grupo "Asignación incompleta" (solo patente o solo conductor) va en Por resolver, sin motivo.
- **D3:** anular sigue como está: el operador anula lo suyo, el admin todo.
- **Respuestas para Pablo (sin código):** 2.5, el historial de documentos SÍ existe (archivo nuevo por carga +
  `audit_log document_replace`), pero solo se ve desde Directorio; 3.4, la póliza de Certificación y la de Seguros
  son a propósito distintas (corrección del usuario 11/10: la de Certificación es documentación de la empresa; Seguros
  gestiona la póliza), así que no "hablan" entre sí por diseño; 3.2, los ajustes posteriores no ven una asignación tardía de flota sobre un
  viaje ya firmado.
- **Hecho (P0b, pedido del usuario): cuenta al pie del sidebar** (`159421bc`). `SidebarAccount` reúne avatar, nombre,
  rol, Cambiar contraseña y Cerrar sesión; `getDisplayName` en `lib/authz/acceso.ts`; la `Topbar` queda solo en el
  teléfono (`md:hidden`). Tests del área 45/45 con mutación verificada; tsc limpio; sin build local (regla del
  usuario: build solo si se toca código compartido o integraciones).
- **Hecho (pedido del usuario): la cuenta es un solo botón con menú** (`65365175`). Abre Configuración (solo con
  `puedeVerConfiguracion`), Cambiar contraseña y Cerrar sesión, con el nombre y el correo arriba. Configuración ya no es
  una sección del menú lateral (en el teléfono sigue "Admin" en la barra inferior). Menú WAI-ARIA: foco en el primer
  ítem, flechas, Home/End, Escape, clic afuera y cambio de ruta. `SETTINGS_HREF` es la única ruta de Configuración en
  la barra. Tests del área 38/38 con mutación; verificado en dev con Playwright (expandida, contraída y teléfono
  a 390 px; capturas en `.playwright-mcp/cuenta-*.png`).
- **Regla del usuario (11/10):** `npm run build` local solo si se toca código compartido o integraciones (memoria).
- **Estándar exigido por el usuario (11/10):** todo nombre nuevo en inglés estándar (componentes, funciones,
  archivos, ids, claves); UI en español; rigor de legibilidad, robustez y patrón de la app. Guardado en la memoria.

**Siguiente paso exacto:**
- [x] P0b verificado en dev (expandida, contraída y teléfono).
- [x] P1, ítem 5: hecho (ver la entrada de arriba). Que editar un manual actualice `status_reported_at` no era un
      bug: en un viaje gestionado a mano la edición es su "reporte".
- [x] P2: grupo `incomplete_assignment` (ver la entrada de arriba).
- [ ] P3, ítem 21: enlaces del Cierre (Flota y Viajes) a la empresa / `?driver=` / `?asset=`.
- [ ] P4, ítem 20: abrir la fila de requisito (`listPending({requirementCode, estado})`, sin llamadores hoy).
- [ ] P5, ítem 23: editar los clientes de una empresa (`PUT /carriers/{id}/shippers`).
- [ ] P6: tests rojos conocidos, overflow del reporte en el teléfono, issue #13, historial en la ficha de Certificación.
- [ ] Deuda menor: `initials` duplicada en `UsersTable.tsx` e `InsurancePolicyModal.tsx` (usar `getInitials`);
      el manejo de cerrar con Escape/clic afuera está copiado en `AccionesDeSujeto` y `SidebarAccount` (candidato a
      un hook `useDismissable` compartido cuando aparezca un tercer menú).

### 2026-10-11 — Monitor: "En curso" por días sin movimiento (reemplaza la regla de 15 días) — en dev

**Decisión del usuario:** la regla de 15 días no aplica (el Cierre ya muestra Pendientes / Por resolver). En el
Monitor, un viaje activo sale de "En curso" tras **3 días sin movimiento**, configurable. Se descartaron, con datos
del 11/10: la antigüedad del viaje (un viaje a regiones dura días), el último reporte del TMS (Sodimac/Wingsuite lo
renuevan aunque esté cerrado: "duraciones" de 23-41 días) y un umbral dinámico por promedio histórico (QAnalytics
0,3 días ocultaría los RETORNANDO; Sodimac y manuales no tienen horas en sus paradas).
**Hecho:**
- Migración `20261011190000_ventana_de_en_curso_del_monitor.sql` (aplicada): `app.monitor_alert_rules.in_progress_idle_days`
  integer NOT NULL DEFAULT 3 CHECK > 0. Distinto de `stale_trip_days` (cuándo sale del Cierre un entregado sin cierre).
- `services/ventana_en_curso.py`: `ultimo_movimiento(t)` = fecha (Chile) del último evento real en sus paradas (TMS,
  GPS o manual; no las programadas) o, si nunca tuvo, `planning_date`; `dentro_de_la_ventana(t)`.
- `list_trips`: con `view="en_curso"` aplica la ventana y devuelve `outside_window_count` (mismos filtros, ventana
  negada). El Historial no tiene ventana.
- `services/reglas_del_monitor.py`: `SQL_REGLAS_DEL_MONITOR`, la lista de columnas que antes estaba copiada en
  `config.py` y en `/trips/meta`.
- Front: campo "Días sin movimiento para salir de En curso" en Configuración › Alertas del Monitor;
  `AvisoFueraDeEnCurso` al pie ("N viajes activos llevan más de 3 días sin movimiento… · Ver en Historial");
  acción `verActivosEnHistorial` (Historial + señal Activo, sin fechas).
- Tests: integración `test_ventana_en_curso_integracion.py` (6), `test_config_monitor` (+3), vitest (+6). 3 tests de
  `test_cierre_viajes` llamaban a la lista sin vista y esperaban el Historial: ahora lo dicen. Backend del área 199 ok;
  vitest 1694; tsc y build limpios.
- Ojo: la API toma `view="en_curso"` por defecto; quien quiera el Historial debe decirlo (el front siempre lo dice).

### 2026-10-11 — Cierre de sesión: lo que queda de la minuta 09/10 (Pablo) — se retoma el 12/10

Sin decisiones pendientes del usuario. **Siguiente paso exacto (12/10): empezar por el ítem 5**, el más acotado.

- [ ] Que Pablo revise en dev todo lo de hoy (Monitor, Cierre › Flota/Viajes/Reporte, Configuración › Clientes del TMS).
- [ ] Ítem 5: un viaje manual nuevo queda "activo, no asignado" hasta la próxima corrida de Mage (≤15 min).
- [ ] Ítem 20 (resto): abrir una fila de requisito en Certificación para ver quién lo tiene vencido y subirlo ahí.
- [ ] Ítem 21: enlaces a la ficha del conductor y del equipo (no existen esas fichas).
- [ ] Ítem 23: editar los clientes de una empresa (hoy solo lectura).
- [ ] Menores: otras tablas del reporte con overflow en teléfono; dato Sodimac 878052 con una rampla como tracto
      (lo corrige Operaciones).

### 2026-10-11 — Monitor: el filtro de cliente sale de la vista, con su cuenta — en dev (3ec20441)

**Causa:** las opciones salían de `/trips/meta`, de todo el histórico. HBC aparecía por 1 viaje manual cerrado del
23/09, y "Sin cliente vinculado" por los 2 viajes huérfanos viejos del TMS. Esto ya pasaba antes del cambio a ID.
**Hecho:** `GET /trips` devuelve `clients: [{id, name, count}]` (faceta disyuntiva: la vista sin el propio filtro
de cliente; el filtro de cliente va último en `list_trips`). `/meta` ya no expone `clients`. En el front,
`lib/monitor/clientesDelFiltro.ts` (un cliente elegido que queda sin viajes en la vista sigue, en cero). Los chips
muestran la cuenta. Tests: integración `test_los_clientes_del_filtro_son_los_de_la_vista_con_su_cuenta` +
3 de vitest; área backend 138 ok; vitest 1687 ok; tsc limpio.

**Consultas del usuario respondidas (sin cambios de código):**
- "Cierre y Reporte solo muestran Walmart": es el dato. El 10/10 los 35 tractos asignados son de Walmart; el único
  Sodimac del 10/10 está "Publicada" (oferta, sin camión). El Monitor "En curso" muestra Sodimac de varios días
  (25/09 a 12/10, casi todos sin camión). El 08/10 y el 09/10 hay Iansa y Sodimac. Un Sodimac de Equipo Completo
  del 08/10 y el 09/10 (tracto 5e58bdb6) quedó "No asignado" en días firmados: es el caso del 10/10 (ítem 4),
  que por decisión del usuario queda como está.
- "Muestra los dos generadores": sale solo en filas SIN viaje (o en la fila fusionada conductor+tracto, cuando
  los dos están sin carga). Muestra las operaciones habilitadas de la empresa (`carrier_shipper_names`). Una fila
  con viaje muestra el cliente de ese viaje (`today_trip_client`).
- **Decisión del usuario (11/10): A — "el cliente es del viaje; estás mezclando cosas".** Aplicada:
  - Cierre › Flota: la columna Cliente solo se llena con el viaje; sin viaje, "—". `carrier_shipper_names` sale
    de `daily_closures` y `equipment_closures` (y su LATERAL, que en `_REPORT_SQL` estaba muerto).
  - Reporte: `_clientes_de_la_fila` = solo el cliente del viaje; lo sin carga, los conductores que no trabajaron
    y el faltante de dotación no son de ningún cliente (se ven con "Todos los clientes"). Con un cliente elegido,
    "No trabajaron" y "Dotación" dicen "Lo que no tuvo viaje no es de ningún cliente…". Sale
    `_SQL_CLIENTES_POR_EMPRESA`.
  - NO tocado: Centro de Flota (`/trips/fleet-daily-overview`) sigue filtrando por empresa habilitada, porque su
    pregunta es "a quién se le puede ofrecer este camión", no qué pasó.

**Pendiente aparte:** la falla de la suite `test_get_del_cierre_no_escribe_integracion::…[<lambda>2]` no está
investigada (corrió con código previo a los arreglos de la revisión final).

### 2026-10-11 — El cliente del viaje por ID — en dev

- **Qué se hizo:** spec `docs/superpowers/specs/2026-10-11-cliente-del-viaje-por-id-design.md` y plan del mismo nombre, ejecutado inline con revisión final (opus).
  - **Migración `20261011120000_cliente_del_viaje_por_id`** (aplicada):
    - índice único `shippers_name_ci_key (lower(btrim(name)))`;
    - `app.tms_client_shippers` sembrada con 4 (walmart, iansa, sodimac, colun);
    - `app.trips_manual.shipper_id` (12 rellenados; 1 de prueba anulado sin cliente).
  - **dbt (Mage, `trips.sql`):**
    - `shipper_id` en las dos ramas;
    - escotilla OR 7, que reprocesa cuando cambia la correspondencia;
    - índice `idx_trips_shipper`.

    Subido con OK del usuario; la corrida natural dejó 3.361 viajes del TMS con cliente y 0 discrepancias.
  - **Backend:**
    - `services/cliente_del_viaje.py` es la única definición: `join_cliente(solo_vinculados=)`, `nombre_del_cliente`, `resolver_cliente`, `texto_del_cliente_en_el_tms`.
    - Ningún cruce por texto ni copias del nombre: dos tests de grep lo fijan.
    - Alta manual y CSV con `_preparar_cliente`; el CSV marca todas las filas con cliente fuera del directorio.
    - El id de un viaje manual de un TMS usa el texto del TMS (de la correspondencia), así renombrar un cliente no lo cambia.
    - Filtros por `?shipper_id=` (con `unlinked`).
    - API `GET/PUT /api/v1/tms-clients`; re-vincular queda en `audit_log` (`TMS_CLIENT`/`link_tms_client`).
  - **Frontend:**
    - `ClientPicker` devuelve `{id, name}` y queda fijo con "Cambiar"; el alta exige cliente.
    - Monitor y Reporte filtran por id; la tarjeta ya no tiene `capitalize`.
    - Configuración › Operaciones › Clientes del TMS (`?section=tms-clients`), con confirmación al re-vincular.
  - **Tests:** un solo helper `cliente_de_prueba(conn)` en `conftest`.
- **Verificado en dev:**
  - el Monitor muestra "Walmart" del directorio, con chips por id y la opción "Sin cliente vinculado";
  - el filtro Iansa funciona;
  - Clientes del TMS muestra los 4 bien vinculados.
- **Hallazgo:** 2 viajes del TMS huérfanos que el pipeline ya no produce (add6d7dc Sodimac 01/07; c79be64d Walmart sin fecha) quedan "sin vincular". No se parchean a mano.
- **Pendientes menores de la revisión: resueltos (11/10)**
  - Un id mal formado responde 422: `leer_filtro_de_cliente` y tipos UUID.
  - `unlinked` funciona en el Centro de Flota.
  - Los selectores ya no ofrecen clientes inactivos, y avisan si lo escrito es uno.
  - Configuración espera la lista del directorio antes de mostrar los selectores.
  - El aviso en Configuración es más preciso.
  - El botón "Cambiar" tiene `aria-label`.
  - Hay tests de 403, 404 y 422.
  - `source_client` queda normalizado igual en la migración y en el PUT.
- **Deuda:** el `?fecha=` de la API del backend.
- **Siguiente paso exacto:**
  - [ ] Que Pablo revise en dev (Monitor, Cierre, Reporte, Configuración › Clientes del TMS).
  - Reporte por período: excluido por el usuario (11/10).
  - [ ] Ítem 5, decisión A (15 días), ítems 21 y 23, y lo que falta del 20.
  - Rediseño del detalle del viaje: excluido por el usuario (11/10).

### 2026-10-11 — Cierre › Viajes en tres pestañas, filtro de cliente coherente y URL en inglés — en dev

- **Qué se hizo:** spec `docs/superpowers/specs/2026-10-11-cierre-viajes-por-estado-y-filtro-de-cliente-design.md` y plan del mismo nombre, ejecutado inline con revisión final (opus).
  - **Viajes:** de 7 secciones a 3 pestañas: Por resolver · En seguimiento · Resueltos.
    - Cómo se presenta cada grupo lo define un solo archivo, `lib/cierre/gruposDeViajes.ts`: un grupo nuevo sin clasificar no compila.
    - Columna "Por qué está aquí"; chips por camino; "hace N días"; "N viajes" en una patente repetida; orden fijo.
    - Los abandonados por el TMS ahora se declaran con motivo.
    - La pestaña inicial se congela con los primeros datos.
    - El lote solo actúa sobre lo que sigue por resolver.
    - Todo es de solo lectura mientras no se sabe si el día está firmado.
  - **URL del Cierre en inglés:** `?date=…&tab=fleet|trips|pending|report&trips=to_resolve|tracking|resolved`, en un solo módulo, `lib/navegacion/cierre.ts`. Los enlaces viejos (`?fecha=`, `?tab=viajes`) se leen y se reescriben.
  - **Filtro de cliente del reporte:**
    - Las opciones son solo los clientes del día, con la cantidad del tipo a la vista (la misma de las tarjetas). Antes sumaba los dos tipos: Walmart 10/10 = 31 + 4 = 35, y la tarjeta decía 31.
    - Una sola regla de pertenencia en el backend, `_clientes_de_la_fila`: con carga, el cliente del viaje; sin carga, los clientes de su empresa en `carrier_shippers`. Aplica a equipos, conductores y faltante de dotación.
    - La API devuelve `clients` (con `by_operation_type`) y `fleet_driver_gap` ya filtrado; Dotación, PDF y Excel leen ese.
    - Mientras carga ya no se muestra el reporte del filtro anterior.
- **Verificado en dev:**
  - 10/10 › Viajes: 1 por resolver, 8 en seguimiento; PYST91 "2 viajes"; 878052 "hace 11 días"; el enlace viejo se reescribe.
  - 07/10 › Reporte: opciones Walmart (32) · Iansa (2) · Sodimac (1); con Iansa, Equipo Completo baja a 3 equipos.
  - 10/10: el filtro y la tarjeta dicen lo mismo.
- **Pendientes menores** (revisión final):
  - `_clientes_del_dia` agrupa por texto exacto (nombres crudos del TMS fuera del directorio).
  - `PESTANA_VIEJA` acepta claves del prototipo (`?tab=constructor`): usar `Object.hasOwn`.
  - `CLAVES_VIEJAS` incluye `viajes`, que nunca existió.
  - Las pestañas no tienen `aria-controls` ni navegación con flechas (igual que la barra de la página): falta una primitiva de pestañas compartida.
  - `text-[10px]` en el contador de pestañas.
- **Deuda anotada:** los `?fecha=` de la API del backend (8 endpoints) siguen en español; cambiarlos exige coordinar backend y frontend.
- **Siguiente paso exacto:**
  - [ ] Que Pablo revise en dev Viajes (3 pestañas) y el filtro de cliente.
  - Reporte por período: excluido por el usuario (11/10).
  - [ ] Ítem 5, decisión A (15 días), ítems 21 y 23, y lo que falta del 20.
  - Rediseño del detalle del viaje: excluido por el usuario (11/10).

### 2026-10-11 — Reporte de estatus por tipo (minuta 09/10, ítems 8 y 14) — en dev

- **Qué se hizo:** spec `docs/superpowers/specs/2026-10-11-reporte-de-estatus-por-tipo-design.md` y plan `docs/superpowers/plans/2026-10-11-reporte-de-estatus-por-tipo.md`, ejecutado inline (commits `3f6c2345` a los fixes del cierre).
  - **API:** `GET /status-report` devuelve `by_operation_type.{tractoreo,equipo_completo}`, cada uno con `summary`, `assigned`, `worked_without_assignment`, `second_legs`, `not_working` y `carriers`. Las claves `section*` se retiraron. Sin migraciones; `_TODAY_TRIPS_SQL` trae `driver_name`.
  - **Pantalla:**
    - Selector Tractoreo | Equipo Completo y seis pestañas: Resumen, Asignados, Segundas vueltas, No trabajaron, Empresas, Dotación.
    - Asignados es un árbol Cliente → Origen → Empresa (`lib/reporte/arbolDeAsignados.ts`).
    - Estados: vacío, "Actualizando el reporte…" y error con "Reintentar".
  - **Excel:** una hoja por sección y tipo, más Dotación.
  - **Copiar estatus:** copia lo que se ve, sin botones.
  - **PDF:** los dos tipos lado a lado.
- **Verificado en dev (07/10):**
  - Tractoreo da 32 asignados (16 RM, 12 Z0, 0 Región, 4 sin clasificar), idéntico al CSV de Pablo.
  - Equipo Completo da 3 (Iansa 2, Sodimac 1), igual a la base. La tabla de Equipo Completo del CSV era un ejemplo de formato armado con filas copiadas de Tractoreo.
  - 7 segundas vueltas, con conductor.
  - En el teléfono no hay desborde.
- **Ajustes pedidos el 11/10, en dev:**
  - Viajes de varios días: vuelven, por tipo (`summary.multi_day`), en el Resumen, el PDF y el Excel.
  - El cliente se muestra con el nombre del directorio (`public.shippers`): "Walmart", no "walmart".
  - Asignados se abre hasta el conductor: Cliente → Origen → Empresa → "Conductor · patente". Cada fila de `assigned.rows` trae sus `vehicles`. El Excel queda al nivel de empresa, como el CSV.
  - "No trabajaron" es una sola tabla: cada fila Origen › Empresa se despliega en sus conductores (o equipos), con un 1 bajo su motivo. El faltante de dotación va como línea propia, "Faltante de dotación".
  - El docstring de `status_report.py` está al día.
  - Verificado en dev el 07/10: Charlotte en CD Lo Aguirre muestra sus 4 conductores; Inversiones Casilla muestra un faltante de dotación de 3.
- **Hallazgo de datos:** el 07/10 los 35 equipos de Equipo Completo que no trabajaron aparecen "Sin motivo" y "Sin origen". Nadie captura motivo ni origen habitual para Equipo Completo. Es un dato pendiente, no un error del reporte.
- **Decisiones:**
  - Las claves nuevas de la API van en inglés.
  - "Sin motivo" es la última columna.
  - `summary.not_working` cuenta equipos; en Tractoreo, la pestaña "No trabajaron" cuenta conductores.
  - `sumar` vive en `lib/reporte/sumar.ts`.
  - Los mensajes vacíos no dicen "Hoy", porque el cierre se mira del día anterior.
  - La suite completa del backend no se corrió: `status_report.py` solo lo importa `main.py`. Regla nueva en la memoria.
- **Siguiente paso exacto:**
  - [ ] Que Pablo revise el reporte nuevo en dev; definir si Equipo Completo debe llevar motivo y origen habitual.
  - [ ] Ítem 5: viajes manuales nuevos quedan "no asignado" hasta la corrida de Mage.
  - [ ] Decisión A (15 días).
  - [ ] Ítems 21, 23 y lo que falta del 20.
  - Rediseño del detalle del viaje: excluido por el usuario (11/10).

### 2026-10-11 — Minuta 09/10: ítems rápidos (24, 22, 9, 15 y copiar estatus) — en dev

- **Ítem 24:** "Venta de camión" se creó desde Configuración › Motivos de conductor (DRIVER_REASON, grupo no_trabajando). Sin código.
- **Ítem 22:** buscador en la pestaña Viajes del Cierre. Filtra todos los grupos por Nº de viaje, cliente, patente, conductor, empresa, origen o destino, y muestra "x de y" en cada grupo (`c16a7a2a`).
- **Ítems 9 y 15, y copiar:** `86bf3d47`.
  - Totales al pie en las tablas de Asignado y Sin trabajar.
  - "Descargar Excel" baja un .xlsx real, con una hoja por sección (`write-excel-file`, cargado al hacer clic), en vez de CSV.
  - "Copiar estatus" copia la sección a la vista en html y en texto.
  - La exportación vive en `lib/reporte/exportarReporte.ts`, con `sumar` compartido entre la pantalla y el Excel.
- **Ítem 20 (revisado):** ya existen "Agrupar por Requisito", "Actualizar por planilla" y la Bandeja. Falta abrir una fila de requisito para ver quiénes lo tienen vencido y subirlo ahí mismo.
- **Ítem 6 — HECHO (`feat(cierre): asignados pendientes de cierre del TMS`, en dev):**
  - El catálogo tiene un grupo nuevo, "Pendiente de cierre TMS". Se agregó en VALID_GROUP_IDS, en `schemas/status_taxonomy`, en `GROUP_OPTIONS` y como columna del tablero (token `espera`).
  - "Control de salida" se movió a ese grupo desde Configuración, el 11/10.
  - En el Cierre › Viajes hay una sección final "Asignados, pendientes de cierre del TMS": sin casilla ni motivo y no bloquea la firma. En dev muestra 5 viajes Sodimac.
  - El 860859 no aparece porque tiene declarado "No tenemos proveedor" (16/09) aunque tiene patente y conductor; si fue un error, se deshace.
  - La 2.ª vuelta se verificó en la base: se cuenta por patente (el 07/10 hay 6 casos, todos camiones distintos). El CSV de Pablo era la exportación vieja, sin la columna patente.
- **Siguiente paso exacto:**
  - [x] Reporte según el CSV anotado por Pablo, ítems 8 y 14 (ver la entrada de arriba).
  - [ ] Ítem 5: viajes manuales nuevos quedan "no asignado" hasta la corrida de Mage.
  - [ ] Decisión A (15 días).
  - [ ] Ítems 8 y 14 (reporte), 21, 23 y lo que falta del 20.
  - Rediseño del detalle del viaje: excluido por el usuario (11/10).

### 2026-10-11 — Pendientes menores de las dos revisiones finales: resueltos (commits 8e6a8443, 85f4d358)

- **Backend:**
  - Anular toma FOR SHARE sobre los períodos que mira (su día y los 45 siguientes); `cerrar` los toma FOR UPDATE, así que se esperan.
  - Un viaje anulado no se edita (409 en PATCH del viaje, paradas, vínculo de flota, restaurar campo, bulk-close, bulk-reopen y assign-driver). Las notas siguen abiertas.
  - `can_void` exige trips.void, como la ruta; el rol admin trae trips.void junto con trips.void_any.
  - Un anulado que el TMS reportó después (dejó de ser manual) se puede deshacer, y su regla de días firmados se sigue calculando.
  - El comentario tiene un máximo de 500 caracteres.
  - La firma copia y cuenta los viajes desde una sola lectura.
  - conteo-activos no cuenta anulados.
  - La auditoría de anular y revertir va en una sola sentencia (`auditar_en_lote` con actor).
  - Tests nuevos: lote mixto con día firmado; revertir con firma real; ya no se cuentan datos reales del 23/09.
- **Frontend:**
  - `CamposDeMotivo` es un solo componente para la barra y el detalle: muestra "(obligatorio)", tiene maxLength 500 y avisa cuando no hay motivos activos.
  - La barra no se puede editar ni cancelar mientras corre.
  - TaxonomyTab invalida `['taxonomies', dominio]`.
  - El detalle de un anulado es de solo lectura (`fieldset disabled`).
  - La pestaña Viajes tiene aria-label con los ajustes; HistorialDeFirmas usa fmtDT.
- **Decisión:** las notas de un viaje anulado quedan abiertas en la API (no cambian datos del viaje), pero la UI del detalle queda toda en solo lectura.
- **Siguiente paso exacto:**
  - [ ] Push a dev y verificar los dos despliegues.
  - [ ] Probar en vivo la barra del Monitor con motivo (requiere un viaje de prueba autorizado).
  - [ ] Contract de closure_periods y de las tablas viejas, con respaldo; issue #13.
  - [ ] Test preexistente rojo de catálogo.
  - [ ] Decisión A.

### 2026-10-11 — Motivos de anulación de catálogo, ajustes sin ruido y vuelta visible: DESPLEGADO en dev

- **Hecho:**
  - Spec `docs/superpowers/specs/2026-10-10-cierre-motivos-de-anulacion-y-ajustes-design.md` y su plan, en commits fd382b11..95b4c0e3, desplegados 00:43 UTC.
  - **Motivo de anulación de catálogo:**
    - dominio `TRIP_VOID_REASON` en `status_taxonomies`, con los valores Duplicado, Cargado por error, Datos incorrectos y Otro; Otro exige comentario, regla por `code`;
    - columnas `void_reason_id` y `void_note`; el texto libre `void_reason` quedó retirado;
    - sección Configuración › Operaciones › Motivos de anulación;
    - los 6 del 23/09 quedaron con DUPLICADO.
  - **Ajustes en el Cierre:** se fue el bloque fijo de arriba. Queda un indicador "N ajustes posteriores al cierre" en el pie del día cerrado, que abre Viajes y desplaza hasta la sección. La pestaña Viajes muestra N y la sección "Después de la firma".
  - **Vuelta visible:** "← Volver al Cierre" o "← Volver al Monitor" en el detalle del viaje (`etiquetaDeVuelta`).
  - **Producción:** las migraciones `motivos_de_anulacion` (expand) y `motivos_de_anulacion_contract` están aplicadas. Mage corrió bien con el modelo nuevo en las dos fases (23:38 y 00:53 UTC).
  - **Verificación:** Playwright en dev, todo verificado. La suite de backend dio 1385/1386; la única roja es la preexistente de catálogo. Frontend 1605/1605.
- **Decisiones:**
  - Expand → deploy → contract, para no romper el listado del Monitor con la API vieja desplegada.
  - En cada ventana, el orden que no borra columnas: en el expand, primero Mage; en el contract, `IF EXISTS`.
  - Un dominio aparte de los motivos de no asignación: anular corrige un registro, no es un resultado de negocio.
  - Los ajustes van como indicador más sección, no como banner, siguiendo el estándar de cierre de período.
- **Diferidos (revisión final):**
  - la lista de motivos queda en caché 5 min tras editar Configuración, y no tiene estado vacío;
  - el número de la pestaña no tiene aria-label;
  - void_note no tiene largo máximo;
  - un test cuenta datos reales del 23/09;
  - la barra sigue editable mientras anula.
  - Más los 9 menores de la ronda anterior (anular↔firmar, totals en dos sentencias, admin puro, anulado editable, conteo-activos, fmtDT).
- **Siguiente paso exacto:**
  - [ ] Probar en vivo la barra del Monitor con motivo, con un viaje manual de prueba autorizado por el usuario.
  - [ ] Ronda de minors diferidos (si el usuario la pide).
  - [ ] Contract de closure_periods (columnas de firma + CHECK) y de las 4 tablas viejas, con respaldo; issue #13.
  - [ ] Test preexistente rojo: test_cargar_catalogo_webcarga (dato real CERTIFICADO_DE_VIGENCIA_DE_LA_SOCIEDAD).
  - [ ] Decisión A del usuario (regla de 15 días).

### 2026-10-10 — Anulación con motivo y firma versionada del Cierre: DESPLEGADO en dev

- **Hecho** (plan `docs/superpowers/plans/2026-10-10-cierre-anulacion-y-firma-versionada.md`, commits c82c936f..68f4b2bd, deploy 23:19 UTC verde):
  - Producción:
    - migración `anulacion_de_viajes`: columnas voided_* en trips_manual/trips y `trips_del_dia` sin anulados;
    - migración `firma_versionada_del_cierre`: closure_signatures/_lines/_trips inmutables, con la versión 1 de 25 días (3.060 líneas, 917 viajes, 25/25 cuadrados);
    - modelo dbt `trips` en Mage, con la rama manual y merge_exclude (corrida de 21:53 OK).
  - Los 6 triggers `trg_enqueue_closure_recompute_*` verificados; queda cerrado el pendiente del rename.
  - API: `anular_viajes.py` reemplaza el borrado físico. Rutas `POST /trips/void` y `/trips/void/revert`, `GET /closures/{fecha}/signatures` y `cierre.ajustes`. Permisos trips.void y trips.void_any.
  - Front: diálogo Anular con motivo, Deshacer y aviso "Anulado"; lista de ajustes posteriores al cierre e historial de firmas.
  - Revisión final (opus): 3 Important corregidos o descartados con evidencia; 9 minors diferidos (ver ledger `.superpowers/sdd/...`).
- **Decisiones:**
  - Los viajes del día de la firma son `planning_date = D` sin anular (25/25 exactos).
  - Anular pide closures.sign si el viaje toca un día firmado: su planning_date, o cualquier día CLOSED donde cuenta (trips_del_dia, ±45 días).
  - `cerrar` sigue escribiendo closed_by/closed_at/frozen_totals en closure_periods (lo exige el CHECK closure_periods_cerrado_tiene_firma). Los lectores leen la firma.
- **Siguiente paso exacto:**
  - [x] 6 duplicados del 23/09 anulados desde la app (con confirmación del usuario, sesión de Felipe, 23:21 UTC), motivo "Duplicado". Verificado:
    - el 23/09 sigue CLOSED, con el mismo firmante, 1 firma, 123 líneas (55 asignadas), cola vacía y 6 auditorías `void`;
    - el Cierre muestra 12 ajustes: los 6 anulados más 6 viajes de Walmart que llegaron después de la firma. La resta vieja daba 0 (44 − 6 = 38 = firmados) y los escondía.
  - [ ] Probar en dev la barra de selección del Monitor (motivo e ícono). El detalle ya quedó probado con estas 6 anulaciones.
  - [ ] Minors diferidos (en una ronda aparte):
    - carrera anular↔firmar;
    - totals vs closure_signature_trips en dos sentencias;
    - admin puro: can_void vs 403;
    - un viaje anulado sigue editable;
    - conteo-activos cuenta anulados;
    - detalles de BarraDeSeleccion;
    - fmtDT en ajustes e historial;
    - tests: lote mezclado y revertir con firma.
  - [ ] Contract, aparte y con respaldo: retirar las columnas de firma de closure_periods + su CHECK, y las 4 tablas viejas. Issue #13: restaurar una firma anterior.
  - [ ] Test preexistente rojo: test_cargar_catalogo_webcarga::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar (dato real CERTIFICADO_DE_VIGENCIA_DE_LA_SOCIEDAD).
  - Pendiente del usuario: decisión A (regla de 15 días).

### 2026-10-10 — Minuta 09/10, B y C

- **B (decisión del usuario): la tabla "Asignado" va por el ORIGEN REAL del viaje** (`292c89ac`, desplegado). Los
  que no cargaron, en su origen habitual; la Sección 7 sigue midiendo asistencia por el declarado. 2-5 de ~30
  asignados por día salen de otro CD.
- **C (duplicados de Carlos Pérez): NO resuelto, y una lección.** Recomendé reabrir el 23/09 con el flujo de la
  app; el usuario autorizó hacerlo con su sesión y lo frenó tras la reapertura (*"es como mezclar peras con
  manzanas"*): reabrir recalculó el día con datos y reglas de hoy (78 líneas reescritas, 123→127, 2 pendientes).
  **Restaurado** (MCP, transacción ensayada con ROLLBACK): líneas desde la copia firmada de
  driver_day_status/equipment_day_status (40/83, 55 asignadas, 0 pendientes, computed_at de la firma), origen
  habitual inferido de los días firmados vecinos (3 líneas), período CLOSED con la firma original (Cristian
  Castillo, 23/09 22:51 CL), cola vacía; auditado como `cierre_restaurado` (la reapertura sigue en audit_log).
  Los 8 viajes siguen intactos. Memoria: feedback_no_reabrir_dia_firmado_para_corregir.
- **Estándar acordado para corregir lo firmado:** ajuste/anulación posterior al cierre, sin reabrir (patrón
  existente "N viajes posteriores al cierre"). Hoy `eliminar_viajes` bloquea días firmados y empuja a reabrir:
  hay que cambiar esa regla por "anular con motivo como ajuste posterior".
- **Permiso de borrar:** recomendación entregada (mantener operador = los suyos / admin = cualquiera; el control
  lo da el cierre); pendiente que el usuario decida y si se diseña "anular con motivo".
- **OJO contract:** las 4 tablas viejas del cierre fueron el único respaldo de lo firmado; NO retirarlas sin un
  respaldo equivalente (p. ej. congelar las líneas al firmar).

### 2026-10-10 — Bugs del reporte de la minuta 09/10: DESPLEGADOS en dev

Pedido del usuario: robusto, según la arquitectura de la app, sin parches ni objetos nuevos en la base. Diseño
corregido dos veces en el chat (primero proponía arreglos puntuales y luego una vista nueva: los dos eran parches).

- `6154660b` **Origen del viaje = su primera parada ORIGIN, una sola definición** (`services/origen_del_viaje.py`,
  patrón de `TRACTOREO_ROSTER_CTE`). Cinco consultas elegían una cualquiera (17 viajes multiorigen de Sodimac);
  guarda `test_origen_del_viaje_una_definicion.py`. La vista de vueltas conserva su versión (comentario cruzado).
- `427b0281` **Vuelta por patente** (ítem 7): migración `20261010200000` (aplicada) sobre la única definición,
  `v_driver_daily_trip_legs` (también la usa el filtro 2ª vuelta del Monitor). 30 días: 0 cambios de cifra.
  Reporte y CSV con columna Patente.
- `5aead9dc` **"Se retira sin carga"** (ítem 12): columnas por motivo del grupo trabajando_sin_asignacion en la
  Sección 2, desde el catálogo, leyendo `category` de cierre_lineas; total = asignados. Verificado: 26/09 → 5.
- `a82910e9` tablas de Asignado y Vueltas con scroll horizontal en teléfono (antes cortaban columnas).
- Suite backend 1345 verdes (+ catálogo ajeno; un error de la guarda de compliance_records fue un alta real de
  conductor a las 19:49, no fuga). Frontend 1569/1569, tsc y build limpios. Verificado en dev con Playwright.

- `7677100d` **Ítem 13, "Sin conductor"**: el usuario corrigió el planteamiento ("no es el habitual"); la
  transcripción aclara que es el FALTANTE DE DOTACIÓN ("todos los que te faltan conductor en los sin trabajar";
  "Casilla" era Inversiones Casilla Spa). La Sección 4 suma `compute_fleet_driver_gap` (la definición de la
  pestaña Dotación) en "Sin conductor", por código SIN_CONDUCTOR, en "Sin origen". Real: Casilla 3, Mendieta 1,
  Doris Mercedes 1 = Dotación. No hizo falta mover la fusión al backend (se descartó esa spec).
- `87dc7e7c` **"Ver viaje" desde el Cierre volvía al Monitor**: el Cierre abre el detalle con `?next=` (URL con
  fecha y pestaña; la pestaña pasa a `?tab=`) y el detalle vuelve ahí (`lib/navegacion/viaje.ts`, reutiliza
  `destinoSeguro`). Verificado en dev: Ver viaje → Cerrar detalle → `/closures?fecha=2026-10-09&tab=flota`.
- Suites: backend 1347 verdes (+ catálogo ajeno); frontend 1579/1579, build limpio. Desplegado en dev.

**Siguiente paso exacto:**
- [ ] Decisiones del usuario: A) regla de 15 días; B) origen real vs habitual en Asignado; C) duplicados en días firmados.
- [ ] Otras tablas del reporte siguen con overflow-hidden en teléfono (preexistente).

### 2026-10-10 — Minuta 09/10: estado verificado de cada ítem (código, base y app en dev)

Fuente: `monitor-app/bugs/20261009/Minuta_Revision_01_02_08_09oct2026_para_Felipe.docx`. Verificado en código,
en la base (solo lectura) y en la app desplegada (Playwright).

- **Resueltos:** 3 (acceso solo por invitación, 09/10), 4 y 11 (Sodimac y manuales en el cierre y el reporte,
  09-10/10), 17 (el "206585" es el 2065805, CERRADO e inactivo), viaje del 21/09 de Alianza (ya no activo),
  Fortaleza (INACTIVE, 0 líneas en el cierre de hoy). 1 y 2 ya estaban hechos.
- **16 (borrar duplicados):** la función existe (Monitor en curso/historial y detalle) pero 0 borrados desde el
  01/10: los 8 manuales duplicados de "Carlos Perez" (8 de 12 manuales) están en días firmados 23-24/09 y el
  servicio bloquea borrar en día firmado. Permiso: operador borra los suyos; admin/owner cualquiera (la minuta
  pidió solo súper admin).
- **Bugs:** 12 ("se retira sin carga" no aparece en el reporte), 13 (conductores sin tracto solo si su empresa
  tiene tractoreo; tractos sin conductor habitual nunca), 5 (manual nuevo queda "activo, no asignado" hasta la
  corrida de dbt; editar reinicia sus días; espejo con `except: pass`), 7 (vueltas ya por tracto pero la tabla no
  muestra la patente; borde con conductor compartido), origen real sin `ORDER BY stop_order` (status_report).
- **Decisiones del usuario pendientes:** A) regla de 15 días (hoy no existe; 7 días solo QAnalytics/Wingsuite;
  `stale_trip_days` vacío); B) origen real vs habitual en la tabla de asignados (habitual a propósito por HU-28);
  C) cómo borrar los duplicados en días firmados y quién puede borrar.
- **Funciones nuevas:** 6, 8, 9 (sin fila de totales), 14, 15 (CSV, no xlsx), copiar/pegar, 20, 21 (sin enlaces a
  fichas; no hay ficha de conductor ni equipo), 22 (sin buscador en Viajes), 23 (clientes de empresa solo
  lectura), 24 ("Venta de camión" no existe; se crea en Configuración sin código), 25 (hecho para TMS).

### 2026-10-10 — Demoras del Cierre y del Monitor: spec "el recálculo sale de la lectura" (en revisión)

Pedido: *"por qué hay delays al desplegar la vista del cierre y a veces el monitor"*. Medido (logs de Cloud Run de
7 días + perfil en transacción revertida): Cierre con mediana de 5,5 s y Monitor de 3,8 s (máx. 199 s). Causa del
Cierre: cada GET ejecuta `recalcular` completo (139 consultas, 124 del pre-cierre fila por fila), tres veces por
sesión, y retiene conexiones del pool (5 por instancia); el 08/10 a las 17:26 CL cayó todo con 504. Monitor: caché
fría en Supabase free (0,4 s en caliente, 2,2 s en frío) y 391 KB por 100 viajes. Arranques en frío: 167 de la
API y 137 del frontend en 7 días. Código muerto: proyección a 4 tablas sin lectores y pre-cierre duplicado en
`equipment-closures`.

**Decisiones del usuario (10/10):** estándar de la industria, sin código muerto ni frankenstein; opción 2
(trigger que marca el día, en el `post_hook` de dbt en Mage, autorizado); ejecutor Cloud Scheduler → endpoint
interno; diseño aprobado por secciones. Correcciones hechas en la revisión: la marca va en una cola propia
(`app.closure_recompute_queue`) y no en `closure_periods` (evita bloquear la ingesta y un ciclo de bloqueos); el GET
no escribe nunca; reglas contra el auto-reencolado (sentencia sin filas, `SET LOCAL app.origen_escritura`).

**Spec:** `docs/superpowers/specs/2026-10-10-cierre-recalculo-fuera-de-la-lectura-design.md` (`33839636`, actualizada).
**Plan:** `docs/superpowers/plans/2026-10-10-cierre-recalculo-fuera-de-la-lectura.md`; ejecución native (ledger en
`.superpowers/sdd/2026-10-10-cierre-recalculo-fuera-de-la-lectura/progress.md`, con todos los `Ruling:`).

**Hecho y DESPLEGADO en dev (10/10, `3d74d8f5`):**
- Migraciones en producción: `20261010120000` (cola, función de marca, 24 triggers en las tablas de la API) y
  `20261010150000` (la cola pasa a **solo inserciones**: el upsert por día hacía esperar a toda transacción que
  marcaba y provocó un deadlock en la suite). Triggers de `app.trips`/`app.trip_stops` en el `post_hook` de dbt
  (Mage, verificados 14:39 UTC).
- Pre-cierre por conjuntos (equivalencia exacta con el código viejo en 14/14 días); `cierre_lineas` con
  `recalcular(marcas, saltar_si_ocupado)`, firma atómica, reabrir encola, sin proyección a las 4 tablas viejas;
  ejecutor `services/cola_del_cierre.py`; endpoint `POST /api/v1/internal/closures/recompute` (OIDC de Cloud
  Scheduler, solo dev); los tres GET escriben 0 filas; aviso "Actualizando…" en pantalla.
- GCP (con confirmación del usuario): API de Cloud Scheduler, SA `cierre-scheduler`, job `cierre-recalculo-dev` cada 1 min.
- Medido: Scheduler 200 desde 17:14 UTC; en caliente, servidor: daily-closures 1,16 s y equipment-closures 0,69 s
  (antes, medianas de 5,5 s). La meta de 0,5 s no se alcanzó en daily-closures: el resto es su consulta de detalle
  preexistente, no el recálculo.
- Hallazgo ajeno: `trg_refresh_compliance_on_carriers_update` toma un ExclusiveLock sobre
  `app.carrier_compliance_status`: dos ediciones de empresas cualquiera se serializan (diagnosticado con pg_blocking_pids).

**Revisión final (revisor fresco, opus) y correcciones, DESPLEGADAS en dev (`57574606`, revisión 00193):** 0 críticos;
5 importantes corregidos con test que falló primero: no reescribir líneas que no cambian (el ejecutor corre 24/7);
la marca ya no exceptúa al recálculo (migración `20261010180000`, aplicada; converge solo); el pre-cierre audita lo
que escribió (RETURNING) y un override ya no deja un tracto sin empresa; estado "Este día no tiene cierre
calculado"; comentarios desactualizados (incluye Mage). 8 menores diferidos en el ledger.
- Suite tras las correcciones: 1334 verdes, 4 rojos + 1 error. Además del catálogo (ajeno), 3 por statement
  timeout / conexión cortada mientras corría la ingesta; aislados, 37/37.
- Ejecutor en vivo antes de la corrección: 10-22 s por corrida, dos corridas por ingesta (dbt confirma trips y
  trip_stops por separado). Medir después de la corrección.

**Siguiente paso exacto:**
- [ ] Medir el ejecutor en la primera ingesta posterior a las 18:45 UTC (debería bajar mucho al no reescribir).
- [ ] 11/10: medianas de un día completo en logs de Cloud Run; luego contract (`20261011120000`: retirar las 4 tablas viejas).
- [ ] Optimizar `_DETAIL_SQL` de daily-closures si se quiere llegar a 0,5 s (cambio aparte).
- [ ] Después de este trabajo, la minuta del 09/10 (`monitor-app/bugs/20261009/`).
- [ ] Fuera de la spec, cada uno por su lado: peso de la respuesta del Monitor, instancias mínimas (costo), plan de Supabase (WebCarga).

### 2026-10-10 — Bug: Sodimac de Equipo Completo fuera de "Asignados" en el Cierre (ítem 4 de la minuta 09/10)

Pedido: los casos corregidos ayer salieron de Rezago pero no aparecían en la sección de asignados para cerrarlos.
Plan: `~/.claude/plans/snoopy-riding-giraffe.md`. Fuentes: minuta `monitor-app/bugs/20261009/` y Granola
"Webcarga 2.0" (09/10).

**Causa raíz (medida en producción, solo lectura):** diez consultas del día (`cierre_lineas` ×2, `daily_closures` ×2,
`equipment_closures`, `status_report`, `trips.py` ×4) excluían `source_system = 'sodimac'`, una regla de julio
(*"no resuelve flota por la misma cadena"*). Hoy `v_trip_fleet_resolution` lee solo `trip_fleet_links` y los 29
vínculos de Sodimac son de Operaciones, así que el viaje quedaba asignado (dbt, 09/10) y su tracto de Equipo
Completo (PYST91, GBVC90, YN2499) seguía "No asignado" en Flota del día, el reporte y los disponibles.
Los manuales Iansa/HBC no eran parte del problema: sus días ya decían ASSIGNED.

**Decisiones del usuario (10/10):**
- *"No hagas queries, crud, endpoints, tablas ni columnas parches… sigue el patrón de la arquitectura"*: el arreglo
  es SOLO borrar la exclusión; Sodimac pasa por la misma cadena que los demás TMS.
- Días firmados (02/10, 06/10–09/10) quedan como están. Se mantiene `trips_del_dia` (ocupa el día de la
  asignación y los días con reporte o marca real).

**Hecho:** exclusión borrada en los 10 lugares + comentarios obsoletos. Tests que fijaban el defecto corregidos
(`test_cierre_lineas`, `test_config_monitor` ×3, `test_daily_closures`, docstring de `test_pre_cierre`). Guarda
`tests/test_viajes_del_dia_sin_exclusion_por_tms.py` e integración `tests/test_cierre_sodimac_integracion.py`
(línea ASSIGNED + "Ver viaje"); mutación verificada: con la exclusión reinsertada fallan los dos.

**Pendiente:**
- [x] Desplegado en dev (`84214441`, Deploy Monitor API verde, revisión 00191). Verificado con Playwright que el
      Cierre carga y recalcula los días abiertos. **No hay un día ABIERTO con un Sodimac de Equipo Completo**: los 19
      días afectados (03/09–09/10) están firmados y, por decisión del usuario, quedan así. Corrección: DZYH10 del
      03/10 era Tractoreo con un viaje de QAnalytics (línea desactualizada), no efecto de este arreglo.
- [ ] Ver en pantalla el primer día abierto con un Sodimac asignado (ej. 889434, Aceptada, planificado 12/10): su
      tracto de Equipo Completo debe salir en "Asignados". Mientras tanto, lo cubre el test de integración.
- [ ] Dato para Operaciones: el viaje Sodimac 878052 tiene vinculada la RAMPLA JF8307 como tracto; corregir el
      vínculo desde la app (no se agregó filtro: el roster solo toma tractocamiones).
- [ ] Minuta 2.2 / ítem 6 "asignados, pendientes de cierre TMS" (Sodimac en Control de salida, para Facturación):
      otra HU, por la ruta de spec, partiendo de `trip_statuses.group_id` (Fabián: tratar Control de salida como
      "retornando" de Walmart), sin columnas nuevas.

### 2026-10-09 — Roles y permisos (RBAC NIST): plan completo (Tasks 1-13) en dev

> **Cierre de sesión 2026-10-10 (~00:00 CL).** Todo comiteado y desplegado en dev (último `feat(marca)` de la barra
> contraída). Nada en vuelo, ningún job ni deploy corriendo.
>
> **Siguiente paso exacto (en este orden):**
> 1. Para WebCarga, sin código: asignar a cada persona su área real, nombrar un segundo Propietario de WebCarga y
>    pasar la cuenta de Sumadots a Soporte técnico (Configuración › Personas y accesos › Editar roles).
> 2. Probar invitación por correo y recuperación de contraseña con f.soto.santibanez@gmail.com (pendiente del 09/10).
> 3. Pedir a WebCarga el logo en SVG o PNG grande (el del sitio es 279×60; se reemplaza en `public/brand/`).
> 4. Pendientes por decisión del usuario: menores 8 (caché 60 s) y 9 (lectura por área).
> 5. El stack de `main` sigue roto a propósito (lee `profiles.role`, ya borrada): resolver al desplegar `main`.
>
> **Decisiones de arquitectura de esta sesión:** permisos en código / roles y asignaciones en base (NIST RBAC);
> el permiso que edita cada sección de Configuración vive en `secciones.ts` y `REVISABLES` con test de sincronía;
> candado único `LLAVE_PROPIETARIOS` para todo lo que toca Propietarios; rutas siempre en inglés
> (`lib/rutas.test.ts`); marca en un solo componente `LogoWebCarga` (forma como prop); estáticos fuera del proxy.

Pedido del usuario: modelo de roles y permisos de estándar de industria, *"sin parche, respetando el diseño del
backend, mantenible, robusto y escalable"*. Spec: `docs/superpowers/specs/2026-10-09-roles-y-permisos-design.md`
(`3db8062d`). Proceso: superpowers:brainstorming, ruta arquitectónica (spec → plan → ejecución).

**Decisiones del usuario:** áreas Operaciones, Certificación, Seguros, Comercial (+ Directorio); Operador y
Supervisor por área; Lectura, Administración, **Propietario/Super admin = WebCarga** (mín. 2, nunca 0),
**Soporte técnico = Sumadots** (lectura; el acceso técnico va por GCP/Supabase/GitHub, no por la app); firma del
cierre en Operador y Supervisor (como hoy con writer); estándar NIST: permisos en código, roles y asignación como
datos (roles de sistema por migración + roles personalizados), `require(Permission.X)` reemplaza a
require_writer/editor/admin sin alias; permisos por campo dentro del modelo; `GET /me` + `can()` en el frontend con
códigos generados; expand/contract con compuerta por la API de `main` (lee `profiles.role`).

**Siguiente paso exacto:**
- [x] Spec aprobada (09/10): el Supervisor configura su área (única ganancia de la migración). Ajustes al
      mapear rutas: `trips.delete` también en el Operador (hoy writer elimina viajes manuales) y `reference.read`.
- [x] Plan: `docs/superpowers/plans/2026-10-09-roles-y-permisos.md` (`7d9de7c2`, spec `c5f1254e`), 13 tasks:
      catálogo → migración expand + sync al arrancar → permisos efectivos/require() → permisos por campo → rutas
      por área (5-8, guarda + matriz) → administración de acceso → frontend /me + usePermiso → borrar escalera y
      desplegar → pantallas (maquetas primero) → contract con compuerta (API de `main`).
- [x] Ejecución nativa (aprobada "si"). Ledger: `.superpowers/sdd/2026-10-09-roles-y-permisos/progress.md`
      (todas las decisiones tomadas en el camino están ahí como `Ruling:`).
- [x] Tasks 1-9 (backend): catálogo `app/authz/permissions.py`, migración expand aplicada en producción,
      `sync_catalog` al arrancar, `load_access` (caché 60 s), `require()`/`require_fields()`, toda ruta declara
      permiso (guarda `test_toda_ruta_declara_permiso.py` + `test_matriz_roles.py`), administración de acceso
      (`/me`, `/permissions`, `/roles`, `PUT /users/{id}/roles`, regla anti-escalada y "al menos un Propietario").
      Fuera de plan: CacheMiddleware servía `/trips/meta` y `/roles` sin sesión → corregido y desplegado.
- [x] Task 10 (`195e45f3`): frontend con `PermisosProvider`/`usePermiso` desde `GET /me`; códigos generados
      (`scripts/generar_permisos_ts.py` → `lib/authz/permisos.generated.ts`, test de sincronía); fuera
      useRolMinimo/useCanEdit/useCanAdmin/hasRole/canManage. Alta de usuarios ofrece solo roles otorgables.
- [x] Task 11 (`4c7d89f0`, push a dev, ambos deploys verdes): fuera require_writer/editor/admin y la clave `role`.
      Verificado: 401 sin token; las 12 personas con exactamente los roles de LEGACY_ROLE_MAP; Playwright como
      Propietario (Monitor, Personas y accesos, Cierre).
- [x] Fuera de plan (pedido 09/10): las 3 cuentas Lectura recibieron Operador de Operaciones → 12/12 firman el cierre.
- [x] Task 12 (`c90bc78b`, `b6dfd265`, `4aee2157`, desplegada en dev): maqueta aprobada
      (HU `monitor-app/docs/user-stories/20261009/01-hu-personas-y-roles.md`, artifact MVuS9YJgf673jLyR86jYcu).
      Personas con chips + panel "Editar roles" (nivel por área, motivo de lo no otorgable, qué gana/pierde),
      pestaña Roles (sistema solo lectura, personalizados crear/editar/eliminar), invitación multi-rol.
      "Personas y accesos" se esconde sin users.manage. Verificado en dev escritorio y teléfono (solo lectura).
- [x] Prueba con escritura en producción (autorizada): rol "Prueba RBAC" creado, asignado a demo, 409 al borrarlo
      asignado, desasignado y borrado desde la pantalla. Base sin restos; auditoría completa. El 409 de "último
      Propietario" queda cubierto por el test de integración (hay 2 Propietarios: probarlo en vivo lo quitaría).
- [x] Revisión final (Opus fresco): sin vías de escalada. 4 Important corregidos y desplegados en dev:
      caída de la API ya no cierra sesión (`7d70b10b`); candado del último Propietario (`e73fe88c`); cada
      sección de Configuración edita con el permiso de su API, alertas de vencimiento → certification.configure
      (`29e5266a`); extender la vigencia de un documento aprobado exige revisar (`5e8582d8`).
- [x] Spec §9 con los ajustes del 09/10 (`c0a69b1d`).
- [x] Task 13 contract (`23fef6ee` + migración `rbac_contract` aplicada): sin `profiles.role` ni
      `admin_whitelist.role`; respaldo en `app.rbac_legacy_roles` (24 filas); `is_admin()` sobre users.manage.
      Decisión del usuario: *"solo aplica dev de momento, no tomes en cuenta main"* — el stack de `main`
      (api/frontend prod, sin uso en 30 días, misma base) queda roto hasta desplegar `main`.
- [x] Menores 1-7 de la revisión final (pedido del usuario), desplegados en dev:
      "Confirmar cierre" solo con closures.sign (`54f33a74`); inventario de Configuración con reference.read y
      conteo de personas solo con users.manage (`eb84865a`); activar/desactivar muestra el motivo (`bf25c191`);
      PUT de roles exige uno, 422/404 en vez de 500 y valida solo lo que se agrega (`1991be5e`); roles
      personalizados `custom_*` y sync que no los adopta (`9336f084`).
- [x] Ruta en español corregida (feedback del usuario, "de nuevo estás usando rutas en español"):
      `/auth/no-disponible` → `/auth/unavailable` (`3da942c3`) + `lib/rutas.test.ts`, que obliga a declarar cada
      segmento de ruta en inglés (solo quedan las dos redirecciones viejas `configuracion` y `usuarios`).
- [x] Marca (`fd0e2d8a`, en dev): logo e ícono oficiales tomados de app.webcarga.com con Playwright
      (`public/brand/`, PNG 279×60 y 64×64). `LogoWebCarga forma="completo|isotipo"`: blanco en barra lateral
      y login, cubo azul en encabezado móvil y contraseñas; `app/icon.png` reemplaza el favicon de Next; el
      proxy deja pasar archivos estáticos (`proxy.matcher.test.ts`). Pendiente: pedir a WebCarga el logo en
      SVG o PNG grande (el del sitio es de baja resolución).
- [x] Barra lateral: logo centrado en su franja (`block`, 20 px) y, contraída, el cubo de WebCarga como botón
      "Expandir barra lateral".
- [ ] Pendientes por decisión del usuario (10/10, "dejemos pendiente 8 y 9"): ventana de hasta 60 s de permisos viejos en caché tras
      cambiar roles; lecturas no separadas por área (solo importa con roles personalizados restringidos).
- [ ] Para WebCarga (sin código): asignar a cada persona su área real, nombrar un segundo Propietario de
      WebCarga y pasar la cuenta de Sumadots a Soporte técnico.
- [ ] Pendiente previo, independiente: probar invitación por correo y recuperación con f.soto.santibanez@gmail.com.

### 2026-10-09 — Seguridad de acceso: solo por invitación, mínimo privilegio, MFA para admin

Pedido de Pablo (Granola "Webcarga 2.0", 09/10): *"Hoy día cualquier persona puede entrar a la plataforma y ver
todo... el administrador o alguien crea la cuenta... el que nosotros le damos acceso, se acabó."*
Plan: `~/.claude/plans/viajes-de-sodimac-asignados-sunny-nebula.md`. Decisiones del usuario: invitadas entran con
Google, Microsoft o email+clave; una sola entrega; rutas en inglés (`/auth/access-denied`, `/auth/mfa/*`).

**Auditoría (09/10, código + base en solo lectura):**
- C1 `frontend/lib/actions/users.ts` (createUser/deleteUser) usaba la clave de servicio sin verificar al que llama
  (server action = POST público): cualquiera podía crearse un owner. Clave configurada en Cloud Run.
- C2 `public.compliance_requirement_rules` sin RLS y con todos los permisos para `anon` (53 reglas).
- C3 `authenticated` podía hacer UPDATE de `profiles.role` sobre su propia fila (`self_update`) → owner.
- A1 registro abierto: `handle_new_user` daba `viewer`; backend "sin perfil" = viewer; pestaña Registrarse.
- A3 9 rutas sin sesión (`/config/*`, `/config/taxonomies`, `/roles`, `/trips/meta`).
- A4 PostgREST: 24 tablas de `public` con permisos, escritura abierta en locations/location_rates, 26 funciones
  ejecutables por RPC. PostgREST expone public, graphql_public, silver, gold, app (app/silver sin grants).
- M1 sin MFA (0 factores), contraseña mínima 6, `auth.audit_log_entries` vacía (historial en logs de Supabase).

**Aplicado en producción:** `20261009160000_cierra_escalada_de_rol_y_reglas_publicas.sql` (C2+C3, `2029f3d8`),
ensayada con ROLLBACK y verificada con la clave pública: "permission denied" en ambas tablas; app funcionando.

**Desplegado (09/10):** `57f7f748` en `dev` (Deploy Monitor API y Frontend en verde) + migración
`20261009170000_invitation_only_access.sql` aplicada (el primer intento cortó por ECONNRESET y no aplicó nada;
reintento OK). Contenido:
- API: `POST /users` y `DELETE /users/{id}` (require_admin, invitación antes de crear en Auth, `invited_by`);
  `GET /users` con último ingreso, métodos y MFA; sin perfil → 403; `require_admin` exige aal2
  (`MFA_REQUERIDO`); toda ruta exige sesión (router-level en config/config_reviews/status_taxonomies/roles y
  `/trips/meta`), guarda `test_toda_ruta_exige_sesion.py` (excluye `/health` y `/__test__/`).
- Frontend: sin `lib/actions/users.ts` ni `RegisterForm`; login sin "Registrarse"; `/auth/access-denied`
  (cierra sesión), `/auth/mfa/setup`, `/auth/mfa/verify`; layout con perfil/MFA; clave mínima 12; tabla de
  usuarios con "Último ingreso" + método + MFA. `deploy-frontend.yml` sin la clave de servicio.

**Verificado:** suites backend 1.238 (+2 rojos: catálogo, ajeno; y la guarda, corregida) y frontend 1.479, build;
sin sesión las 7 rutas → 401 y `/health` 200; Cloud Run del frontend sin `SUPABASE_SERVICE_ROLE_KEY`; PostgREST con
clave pública → "permission denied" (carriers, drivers, insurance_policies, locations, profiles, reglas);
`authenticated` lee 1 tabla, `anon` 0; hook → 403 a no invitada; Playwright: la cuenta owner va a
`/auth/mfa/setup` y se genera el QR (TOTP habilitado). No se completó la inscripción (requiere el teléfono).

**Después del despliegue (09/10, tarde):**
- Hook activado y "Allow new users to sign up" OFF por el usuario; probado: cuenta Google no invitada →
  "Tu cuenta no tiene acceso", 0 filas nuevas en auth.users (11 cuentas). `disable_signup: true` verificado.
- `0e7aa162` invitación por correo (`invite_user_by_email`, cae a `create_user` si el correo falla;
  `invitation_sent`) + mensaje para copiar en el alta + `/auth/confirm` (token_hash, patrón SSR).
- `d3c435e7`/`c3aea6a2` plantillas `templates/invite.html` y `templates/recovery.html` (look del login, bajada
  "Plataforma logística", botón y título centrados); `config.toml` las referencia (local).
- `1016ac5e` MFA: Fabián (admin) no podía activar: 0 filas en `auth.mfa_challenges` → el navegador bloqueaba el
  envío (`maxLength=6` + `pattern`, el código de Microsoft Authenticator trae espacio). `lib/auth/codigo.ts`
  se queda con los dígitos. Bajada "Plataforma logística" en login/título/menú.
- `da60eb7e` recuperar/cambiar contraseña: `/auth/confirm?type=recovery&next=` (`lib/auth/destino.ts`, solo rutas
  internas), `/auth/reset-password` con sesión/code/enlace, 12 caracteres, aal2 → verify y vuelve; "Cambiar
  contraseña" en el pie del menú. `b46a15a5` MFA sin sesión → /login.
- Abierto: Fabián recargó 16:41 (factor nuevo) y aún 0 intentos; confirmar con él. No pude probar el verify de
  punta a punta: la sesión del navegador de pruebas expiró.

**Siguiente paso exacto:**
- [ ] Usuario: inscribir su MFA al entrar (owner); avisar a los otros 2 admin y al otro owner que se les pedirá.
- [ ] **Usuario, en el panel de Supabase** (producción):
      1. Authentication › Hooks › Before User Created → Postgres → `public.before_user_created_hook` → Enable.
      2. Probar con una cuenta de Google NO invitada → debe ver "Tu cuenta no tiene acceso".
      3. Authentication › Sign In / Providers → "Allow new users to sign up" OFF (después de probar que una cuenta
         invitada entra con Google).
      4. Authentication › Multi-Factor → TOTP habilitado (enroll y verify) — confirmado: genera el QR.
      5. Email provider → contraseña mínima 12 y "Confirm email" ON.
      6. Emails › Invite user y Reset password: pegar `templates/invite.html` y `templates/recovery.html`
         (asuntos en config.toml); Site URL = frontend dev.
- [ ] WebCarga revisa las 11 cuentas (3 @gmail.com) en Configuración › Personas y accesos.
- [ ] Fuera de este plan (misma llamada): estado "Asignado, no cerrado por el TMS" al final del Cierre; acceso de
      Pablo a Google Cloud y GitHub.

### 2026-10-09 — Bug: viajes asignados/cerrados en el grupo equivocado del Cierre (Sodimac, manuales, 2065805) — DESPLEGADO

Plan: `~/.claude/plans/viajes-de-sodimac-asignados-sunny-nebula.md`. Diagnóstico medido en producción (solo lectura).

**Causa común:** `is_active`/`is_assigned` se guardan en `app.trips` y los escribían varios caminos sin regla común.
- **Sodimac 887928/884386/881496** (Control de salida) en Hoy/Rezago: `stg_sodimac_trips` deja tracto y
  conductor en NULL (la única PATENTE es la rampla → `trailer_plate`), la regla de dbt miraba solo tracto/
  conductor y forzaba "no asignado" en Creada/Aceptada/Control de salida (traen patente 286/286). El tracto y
  conductor de Operaciones viven en `trip_fleet_links`, que dbt no leía. Los 19 asignados eran toggles.
- **10 manuales Iansa/HBC** (CERRADO con flota) en Rezago: el alta fija `true/false` y la rama manual de dbt
  los copiaba sin derivar.
- **QAnalytics 2065805** (CERRADO FINALIZADO por SAP) en En curso: 03/10 17:36 CL alguien encendió Activo/
  Trabajando en el detalle del Monitor; `protect_manual_overrides` borra la marca de un viaje cerrado pero
  conserva el valor; dbt no lo reseleccionaba (`edited_at`, `xmin` de una sola fila, notas del viaje).

**Decisiones del usuario (09/10):**
- "Si tiene patente y/o conductor califica como asignado", del TMS o del vínculo en la app.
- *"No hagas parches y sigue el patrón de la arquitectura de la app"*: **la regla vive solo en dbt**; la API no
  la calcula (se descartó una versión con funciones en la base llamadas por dbt y la API).
- En un viaje del TMS, Activo/Trabajando **los define el TMS**; Asignado sigue editable.
- Estados "no cuenta como carga" (Cancelado/Declinada/Removida) con patente: **revisar después**; sin cambio.
  Publicada nunca es asignada (07/10).

**Hecho y desplegado (09/10):**
- dbt (Mage, mirror NO en git): `macros/viaje_activo_y_asignado.sql` (`viaje_abierto_por_estado`,
  `viaje_activo_tms`, `viaje_asignado`), fuente `app.trip_fleet_links` en `models/sources.yml`, y
  `models/app/trips.sql` con las macros en las dos ramas (la manual respeta `manually_edited_fields`), sin la
  lista de estados, y **escotilla OR 6** (guardado ≠ derivado y sin marca manual → reentra; se apaga sola).
  Subido con `sync_local_to_remote` a las 13:54 CL (3 archivos, 0 conflictos), entre corridas.
- `af287530` en `dev` (Deploy Monitor API y Frontend en verde): `patch_trip` responde 422 a `is_active`/
  `is_working` en un viaje no manual; `IndicatorSwitches` los deshabilita con "Lo define el TMS".
- Tests: backend 1.224/1.225 (el rojo es ajeno, ver abajo); frontend 1.478 + el corregido de
  `TripDetailView.test.tsx`, tsc y build limpios.

**Verificado en producción tras la corrida de las 14:00 (MERGE 14:08):**
- 2065805 `is_active=f`; 881496/884386 asignados y activos; 887928 ya CERRADO FINALIZADO por el TMS; manuales
  0 activos / 12 asignados; réplica de OR 6: 0 pendientes (salvo 803070, fuera del `start_date` del modelo
  por zona horaria: dbt no lo procesa, no reentra, no afecta el Cierre).
- Cierre del 09/10 (consulta del código y Playwright en dev): Hoy 0, Rezago 0, En curso 7 (881496, 884386 y
  3 Sodimac que ya estaban asignados a mano + 2 QAnalytics vivos). Detalle QAnalytics: switches como se pidió.

**Pendiente:**
- [ ] Revisar con el usuario: estados "no cuenta como carga" (Cancelado/Declinada/Removida) con patente → ¿asignado?
- [ ] Deuda ajena: `test_cargar_catalogo_webcarga.py::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar` falla
      desde la carga del catálogo del 09/10 (choca con `CERTIFICADO_DE_VIGENCIA_DE_LA_SOCIEDAD` real): el test
      depende de datos de producción; tiene que crear su propio sujeto.
- [ ] Los 19 Sodimac con `is_assigned` marcado a mano ya coinciden con la regla; la marca puede quedar o
      revertirse a automático desde el detalle (no se tocó).
- [ ] Avisar a Operaciones: Activo/Trabajando ya no se cambian a mano en viajes del TMS.

### 2026-10-08 — HU-C1 vencimientos: entregas 2, 2b y 2c (tabla editable) desplegadas en dev

**Fuente:** `monitor-app/bugs/20261006/Tabla_Resumen_General_IANSA.xlsx` (96 tipos). Diseño y estados de pantalla:
la HU `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md`, secciones "Diseño de interfaz"
de HU-C1 (2b: panel; 2c: tabla). Spec 2b: `docs/superpowers/specs/2026-10-08-c1-entrega-2b-configuracion-exigibilidad-carga-design.md`.

**Decisiones del usuario (07-08/10):**
- La planilla es el **estándar WebCarga**; se cargan **los 96**; la exigibilidad ("cuándo se carga") entra.
- Un archivo por empresa y período, con el corte de cada cliente; la ficha muestra el peor estado.
- *"Nada de parches, sigue el patrón de la app."* La API de `main` no se usa (se ignora).
- Aviso y gracia **rigen de inmediato** para todas las versiones; los parámetros de "cuándo vence" se versionan.
- **Tabla editable en lugar del panel** ("tiene muchos clics"): borrador → Ver efecto → Publicar, y **Publicar
  guarda Y aplica** (siembra), solo después de ver el efecto del borrador tal como está.
- Las rutas fuera de estándar quedan como deuda (`TECH_DEBT.md`); las 2 nuevas de esta entrega se corrigieron.

**Commits:**
- Entrega 2 (F0-F2): `c81e86af..bdcba04a`, desplegada; 5 migraciones en prod (`20261008100000..140000`).
- Entrega 2b (F3 siembra/solicitar, F4 carga con emisión/período, F5 editor, F6 script del catálogo):
  `d98391f9..6e653623` + revisión final `633b3b38`. Migraciones `20261009100000` (mensual exige aviso) y
  `20261009110000` (siembra respeta `exigible_on`) aplicadas. **Desplegada en dev** (API y Frontend en verde).
- Entrega 2c: `08213a7f` (backend: `POST /compliance-requirements/batch-preview` y `/batch-update`; PATCH, recálculo
  y lote escriben con `services/edicion_catalogo.py`) y `8f51343f` (frontend: tabla editable, `borrador.ts`,
  `BarraDelBorrador`, `celdas-del-borrador.tsx`; se retiraron `CeldaVigencia`, `CeldaNivel`, `AplicarEnLaFila`;
  color crudo 1.685 → 1.672). Ajustes vistos en dev: `9d9d19c0` (**`RequirementOption` no declaraba `aliases`
  y FastAPI los descartaba: "Se reconoce como" mostraba "—" desde siempre**; test que pasa cada fila por el
  modelo), `91b4fa3e`, `2f087e2c`, `f698f8d0`, `55acef4b` (la tabla cabe: 943 de 943 px a 1.440 con un mensual
  abierto). **Desplegada en dev.**

**Verificado:**
- 2b: suite backend completa 1.213/1.213; frontend 1.449/1.449; dev desplegado; en el navegador se vio el editor
  "¿Cuándo vence?" (encontró el defecto de la vista previa con regla incompleta, ya corregido en 2c).
- 2c: tests afectados del backend 119/119 (incluye `test_catalogo_en_lote.py`, con mutación verificada);
  frontend 1.473/1.473, tsc y build limpios (mutación de "Publicar exige ver el efecto" verificada).
  Suite completa del backend de 2c: 1.219/1.219 (la primera corrida se colgó en una conexión muerta tras un
  corte de red: 0 % CPU y sin consulta en `pg_stat_activity`; se relanzó con un monitor de estancamiento).
  En dev con Playwright, sin publicar: editar celdas, mensual con "Falta el día tope.", Ver efecto (ensayo
  revertido; la base quedó intacta), Descartar, barra fija al desplazarse, selección.

**Decisiones de arquitectura (2c):**
- El lote es todo o nada, con un savepoint por documento para que el 422 nombre cuál falló.
- Solo se recalcula la siembra de los documentos cuyo cambio la afecta (`is_active`, `applies_to_*`,
  `exigible_on`); renombrar o cambiar el aviso no siembra.
- La diferencia se calcula dentro de la transacción que siembra (`diferencias_en`), así ve lo recién activado.
- Lo que cambia el estado de alguien va al borrador; nombre y alias se guardan al instante (son etiqueta).
- `faltaDeVigencia` (lib/vigencia.ts) es la única regla de "qué le falta" en la pantalla; espeja el trigger.

**Hecho al cerrar (09/10):**
- 2c desplegada y revisada en dev: tabla editable en borrador, Ver efecto, Publicar en lote. Cabe en 943 de 943 px
  con los 113 documentos (`d5080d3e`, `6e46e560`, `1f655ec5`). El primer Deploy Frontend de `1f655ec5` falló bajando
  Fira Code de Google Fonts (red del runner); `gh run rerun --failed` lo resolvió.
- Catálogo de la planilla cargado con visto bueno: 75 tipos nuevos **apagados** (113 en total), 0 sembrados, todos
  con alias.
- De los 19 que ya existían, 7 coincidían y se publicó **solo F30-1** (mensual, día 18, mes anterior, aviso 5;
  0 documentos cargados, 0 efecto).
- `has_expiration` retirada (`20261009120000`, `0a1591eb`), con 0 lectores verificados antes y la app en 200 después.

**PENDIENTE — de WebCarga** (en Configuración › Certificación de dev):
- [ ] **Cargar la fecha de emisión** de los ~100 documentos aprobados de estos 11 tipos. Sin esa fecha, pasarlos a
      la regla de la planilla los deja "vencidos, falta el dato" (ensayo del 09/10: vencidos 21 → 121, al día
      112 → 11). Los tipos y la regla que les toca:
      - → anual desde la emisión: Certificado Mutual, Reglamento Interno, PTS Contratista, Entrega EPP, PTS
        Conductor, Hoja de Vida, DAS ODI, Capacitación EPP, Plan de Emergencia;
      - → anual + "solo cuando se solicita": Política de Seguridad (quita 238 pendientes de empresas que no la
        subieron; las 13 que la tienen la conservan);
      - → fecha del documento: Contrato de Trabajo.
      Con las fechas cargadas: elegir la regla en la tabla, "Ver efecto" (los vencidos deberían quedar cerca de
      21) y "Publicar". El borrador del lote está en el scratchpad de la sesión (`lote19.json`), no en git: se
      rehace con las funciones `_vigencia` / `_exigible` de `scripts/cargar_catalogo_webcarga.py`.
- [ ] **Responder las 11 dudas** de la planilla:
      1. ¿"Contrato asociado al servicio" = "Contrato Webcarga"? (coincidencia dudosa, no se tocó)
      2. ¿F30 de la planilla = "F30 Multas"? (coincidencia dudosa, no se tocó)
      3-5. "Al término del trabajador" que parece "al ingreso": Registro de entrega de EPP, Capacitación Matriz
           IPER, Curso OS10. Los dos últimos se cargaron literal (apagados); a Entrega EPP NO se le cambiará el
           "cuándo se exige" sin la respuesta (literal, le quitaría el pendiente a todos los conductores).
      6-7. "No aplica" con "Vigencia: Sí": Resolución jornada excepcional, Inspección de equipos eléctricos
           (cargados con fecha del documento).
      8-9. "Anual" con "Vigencia: No": Capacitación PTS trabajo en caliente, Entrega EPP específicos (cargados anuales).
      10. Liquidación: "10 de cada es" (se leyó día 10).
      11. Cronograma de trabajos: mensual sin día tope (cargado al último día del mes en curso).
- [ ] **Activar** los 75 nuevos por grupos, mirando "Ver efecto" (activar siembra un pendiente por empresa o
      conductor; no activarlos todos juntos por el Disk IO del plan free).
- [ ] Probar la tabla en dev y decir si algo molesta.

**PENDIENTE — de desarrollo:**
- [ ] Guardar las 11 dudas como nota del documento y mostrar la marca "Duda" en la tabla (diferido de 2c).
- [ ] Volver a medir la velocidad de `/status`, `/pending` y la cola con reglas activas (la última medición fue
      con 0 reglas: 0,26 / 0,18 / 0,25 s).
- [ ] Menores diferidos de la revisión 2b: M1 versión redundante el mismo día; M2 500 con solicitud huérfana; M3 la
      carga acepta datos que el tipo no pide; M4 bulk-file sin emisión/período; M6 `vigenciaDeLaFila` usa hoy UTC;
      M8 solicitados como "bloqueados" en recalc-preview; M10 nombres fijos de grupos de radio; M11 log de vigencia
      sin cambio.
- [ ] Deuda registrada en `TECH_DEBT.md` (08/10): rutas de la API fuera del estándar de nombres (plan aparte, con
      ruta vieja y nueva conviviendo) y Configuración en teléfono, que no pliega el menú de secciones.
- [ ] Si Deploy Frontend vuelve a fallar seguido bajando Google Fonts: servir la fuente local (`next/font/local`).

<details><summary>Detalle de la entrega 2 (F0-F2), 08/10</summary>


**Fuente:** `monitor-app/bugs/20261006/Tabla_Resumen_General_IANSA.xlsx`, con 96 tipos de documento. Es la "HU de
vencimientos actualizada".

**Decisiones del usuario (07-08/10):**
- La planilla es el **estándar WebCarga**.
- Se cargan **los 96**.
- **"Cuándo se carga" (exigibilidad) entra**.
- **Un archivo por empresa y período**, con el corte de cada cliente; la ficha muestra el peor estado.
- *"Nada de parches, sigue el patrón de la app."*
- Se aceptan los 11 registros NONE con fecha manual, que dejan de verse vencidos.
- Se pidió optimizar antes de publicar.

**Planes:**
- alto nivel: `~/.claude/plans/swift-floating-pancake.md` (F0-F6);
- implementación de F0-F2: `docs/superpowers/plans/2026-10-07-c1-entrega-2-vigencia-y-exigibilidad.md`.

**Qué quedó (5 migraciones aplicadas a prod vía MCP, todas ensayadas con ROLLBACK):**

| Migración | Qué hace |
| :--- | :--- |
| `20261008100000` | `public.hoy_chile()`. La base corre en UTC y "vencido" se adelantaba desde las 21:00 de Chile. |
| `20261008110000` | Esquema expand: `ISSUE_PLUS_MONTHS`/`CALENDAR_PERIOD`, `exigible_on`, `issue_date`/`period_start`, `compliance_requirement_rules` (base `shipper_id` NULL + variante por cliente, versionada por `vigente_desde`, coherencia por CONSTRAINT TRIGGER diferido) y la fila `alert_thresholds.documento_por_vencer` (30). |
| `20261008120000` → `20261008130000` | Primero funciones `documento_*`. Medido: `/compliance/status` pasó de 0,28 a 0,76 s, porque Postgres no inlinea funciones con subconsultas. Se retiraron: el cálculo se arma en `app/services/vencimientos.py` (única definición) y viaja dentro de la consulta. En la base quedan solo `reglas_aplicables`, `clientes_de_entidad`, `corte_del_periodo` y `vence_segun_regla`. |
| `20261008140000` | Correcciones de la revisión final (opus): la fecha de referencia la dicta el tipo; gracia en todos los tipos; toda variante exige una base vigente desde `-infinity`; mover una regla valida también el requisito de origen. |

**Velocidad final** (endpoints reales, misma tanda; antes → ahora):

| Lectura | Antes | Ahora |
| :--- | ---: | ---: |
| `status` por empresa | 0,19 s | 0,26 s |
| `status` por conductor | 0,16 s | 0,18 s |
| Cola | 0,19 s | 0,25 s |

El tipo se pregunta como pertenencia sin correlación (hashed SubPlan), no con una búsqueda por registro.

**Verificado:**
- Suite completa: 1.147 en verde.
- Diferencia contra el cálculo viejo sobre los 5.691 registros vigentes: solo los 11 NONE con fecha (aceptados), y 0 NULL.
- Deploy Monitor API en verde sobre `bdcba04a`.
- Playwright en dev: Certificación, Monitor y la ficha (`/status`, `/trips`, `/summary` y `/pending`, todos 200, sin errores en consola).

**Compuertas antes de F3 en adelante** (hallazgos de la revisión, latentes porque hoy hay 0 reglas, 0 fechas nuevas y ningún tipo nuevo):
- **I5**: un documento "aún no exigible" (MONTH_AFTER_START / ON_ENTITY_END) sale como AL_DIA. Hay que resolverlo junto con la siembra de F3, con una de dos opciones:
  - no sembrar esos documentos hasta que sean exigibles;
  - crear un estado propio.
- **I6 en `main`**: la API de `main` solo conoce 3 tipos. No cargar ningún requisito con un tipo nuevo hasta desplegar `main` o retirarla. En dev, las respuestas ya aceptan los 5; la entrada se amplía en F5.
- Tipos mensuales: con el aviso general de 30 días quedan siempre "por vencer". Al cargarlos hay que fijar `warning_days` (~5); conviene exigirlo en el trigger (M6).

**Menores diferidos:**
- `test_hoy_chile` es tautológico.
- El frontend calcula su propio "hoy" (UTC) y muestra la fecha cruda. Hay que exponer `vence_el` en F3/F4.
- Volver a medir la velocidad en F5, con reglas cargadas.

**Siguiente paso exacto:**
- [ ] Escribir el plan de **F6.1**: el mapeo de los 96 en xlsx para que WebCarga lo apruebe, con sus preguntas:
  - combinaciones contradictorias;
  - "al término" en EPP, IPER y OS10;
  - vehículos;
  - cronograma sin corte;
  - "mes anterior";
  - fecha de ingreso;
  - erratas.

  Puede hacerse en paralelo con F3.
- [ ] Escribir el plan de **F3**: siembra según `exigible_on` (ON_REQUEST no se siembra) y "Solicitar documento". Resolver I5 dentro de F3.
- [ ] Después **F4** (carga y clasificación: fecha, emisión y período) y **F5** (selector de 4 tipos, ventanas por cliente y contract de las filas viejas de `alert_thresholds`).
- La Task 7b de la entrega 1 (`DROP has_expiration`) sigue esperando la confirmación del usuario.


</details>

### 2026-10-07 — Memoria técnica I+D para Corfo (entregable, sin cambios de código)

Pedido: `docs/reports/contexto-report.md`. Es una memoria de ~2 páginas que acredita I+D. Se hizo con la estrategia
de `one-pagers/proposals/santa-isabel`: HTML con estilos inline, pegado con Playwright en Google Docs, y figuras
en pptx nativo → Slides → PDF → PNG a 300 ppi.

**Entregables en Drive, carpeta `Webcarga` (`1rdqv1pwn0oW4ks9JP1dKVqEpR4bd4Cm5`):**
- `memoria-tecnica-id-webcarga` (Doc `11ZevqUpWMRMNvH0LjSWas7sUkLxKKUJogt433yxayd8`): 5 páginas,
  9 figuras y un glosario.
- `figuras-memoria-id-webcarga` (Slides `1_dLj9YWz1ufXLctQsoXyxdXbya8Rm375j9Gu0GYD9uE`): 9 láminas.
- `nota-interna-id-vs-rutinario` (Doc `1JUXh7kDMyDLoufjcisj5B3EosOIh22rB7NiI96ymPOk`): solo para
  WebCarga; separa I+D defendible, de apoyo, en curso y rutinario.
- Fuentes locales: `~/Desktop/projects/one-pagers/proposals/webcarga-corfo/` (`build_memoria.py`,
  `figuras/build_slides.py`, `figuras/export_pngs.py`, `check/revisar_pdf.sh`).

**Cifras contrastadas el 07/10 contra Supabase (solo lectura) y `origin/dev`:**
- 3.217 viajes.
- 19 de 3.101 traen RUT del TMS; 2.535 se resuelven por nombre.
- Cobertura de conductor: 94,6 / 95,7 / 94,3 % en ago/sep/oct.
- 43.436 versiones de 5.091 viajes; 5.270 archivos ingeridos.
- 22 días firmados con 2.682 líneas y 0 reaperturas.
- 88 viajes ausentes (61 ofertas retiradas + 27 eliminados).
- 149 endpoints en 23 routers (22 archivos).

**Lecciones:**
- El "141 endpoints" que venía del grep subestimaba la cifra: `requirements.py` usa `@requirements_router.`.
- El "93–100 %" del AGENTLOG ya no es cierto hoy (en las últimas 3 semanas la cobertura diaria va de 76 a 100 %).
- El clasificador documental tiene muy poco uso real: 152 archivos, 15/67 propuestos con confianza alta. Por eso quedó fuera
  de la memoria y en la nota interna como I+D en curso.

**Decisiones del usuario:**
- La memoria cuenta resultados medidos, no proceso.
- La API WebCarga aparece explícita en la figura de arquitectura.
- La concentración de la API (`trips.py`: 25 endpoints, 3.192 líneas, 20 % del backend) se declara como
  "endurecimiento planificado" en la memoria y se detalla en la nota interna.
- Los términos de negocio se definen en la primera aparición y hay un glosario al final.

**Estado:** entregable CERRADO (07/10). El usuario lo da por suficiente: es un reporte documental para la
postulación y Pablo no necesita más relato. No se agregan anexos ni secciones nuevas.

**Siguiente paso:**
- [x] Revisión de los 3 archivos: el usuario los da por suficientes.
- Anexos descartados por el usuario (07/10): ni las specs en PDF ni el commit de las specs al repo.
- [x] Deuda revisada el 07/10:
  - Los 9 endpoints del cierre (`daily-closures` 4, `equipment-closures` 3, `closures` 2) están **vivos**:
    los usan Cierre, Monitor e Historial, y ya leen y escriben `closure_lines` vía `services/cierre_lineas.py`.
  - Lo muerto son las 4 tablas viejas: `driver_day_status` (2.787 filas), `equipment_day_status` (4.356),
    `daily_closures` (22) y `equipment_closures` (21).
    - `cierre_lineas` las sigue escribiendo como "proyección" en la misma transacción.
    - Ningún código, vista ni función las lee.
    - Su último seq_scan del día-estado fue el 16/09.
  - Es la **ola 5** de `docs/superpowers/specs/2026-09-14-modelo-de-cierre-design.md`, junto con el `DROP` de
    `app.trips.comments`/`.notes`.
  - Memoria y nota corregidas: antes decían "retirar endpoints sin uso".
- [ ] Ola 5 del cierre:
  - quitar `_proyectar` y los INSERT a las cabeceras viejas;
  - después, `DROP` de las 4 tablas, que tienen FK a drivers, assets y status_taxonomies.
  - No es reversible: hacerlo entre corridas de ingesta.
  - Exploración del 07/10 (solo lectura, sin cambios; el usuario cortó: esa sesión era solo para el informe):
    - Puntos de escritura en `services/cierre_lineas.py`:
      - `_proyectar()` (líneas ~273-301, llamado en ~358 y ~456);
      - los INSERT a `daily_closures`/`equipment_closures` (~602/616);
      - los DELETE al reabrir (~655-656).
    - Tests que leen las tablas viejas: `test_cierre_lineas.py` (~508-544) y `test_modelo_de_cierre.py:102`.
    - **`app.trips.comments`/`.notes` NO van en esta ola:**
      - tienen 0 datos, pero los usan el modelo dbt `app/trips.sql` (`merge_exclude_columns`, `NULL AS notes`),
        `routers/trips.py` (SELECT y los campos válidos del PATCH), `schemas/trip.py` y `frontend/lib/types.ts`;
      - un DROP rompería la corrida de dbt. Requieren una tarea aparte que toque Mage.
    - Orden seguro:
      1. desplegar el código sin la doble escritura;
      2. verificar una firma y una reapertura reales;
      3. recién entonces, la migración DROP por `execute_sql`, entre corridas de ingesta.
    - Ojo: el 07/10 había otra sesión trabajando en C1 en `dev` (commits 12:04-12:21).

### 2026-10-06 — Ronda 166: minuta del 02/10 (Pablo) — HUs y fixes del Diario 2.0

Fuentes:
- Minuta de Pablo: `monitor-app/bugs/20261006/Minuta_Revision_01_02oct2026.docx`.
- Llamada del 02/10 "Webcarga 2.0" en Granola.
- Plan: `~/.claude/plans/starry-percolating-marble.md`.
- **HUs**: `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md` (fuera de git
  por diseño). Incluye D1-D5 para el Diario y C1-C4 y O1 solo como HU, para la reunión con Pablo.

## Hecho (D1-D3, sin migraciones)

1. **D1 — Cierre fusionado por tracto.** Se retira la tarjeta Conductores. Tractoreo queda con una fila
   por patente y el conductor habitual al lado.
   - Si conductor y tracto están los dos sin carga, la fila ES el conductor: el motivo va a la línea
     DRIVER y el tracto lo hereda con `_SQL_SINCRONIZAR_TRACTOS`.
   - Si el tracto tiene un motivo propio distinto del conductor, aparece un segundo selector, "Tracto".
   - "Otros conductores del día" agrupa a los que no tienen tracto habitual, a los que su tracto lo
     manejó otro ese día y a los que están por regularizar.
   - La fusión se hace en el frontend: los dos endpoints ya se pedían. Las dos familias de
     `closure_lines` siguen intactas, igual que `cerrar`.
   - Medido el 02/10: 47 tractos (7 sin habitual) y 1 conductor sin tracto, sin casos raros.
   - `vehicle_driver_assignments` tiene un índice único sobre el ACTIVE por tracto, así que el `LIMIT 1`
     ya era determinista.
2. **D2 — Viajes del cierre con contexto del Monitor.** `SQL_BASE` en `cierre_viajes.py` agrega
   TMS, patente, conductor y empresa, con las mismas expresiones de `_TRIP_SELECT`. El endpoint suma
   origen y destinos vía `_load_trip_stops`.
3. **D3 — Guardar y deshacer.**
   - En la fila, elegir un motivo deja un borrador; el viaje se cierra recién con "Guardar".
   - Grupo nuevo `con_motivo`: viajes declarados desde el cierre de D en adelante, según `audit_log`
     en hora de Chile.
   - `PATCH /trips/bulk-reopen` deshace la declaración:
     - restaura `is_active`/`is_working` desde la traza que ahora deja `bulk-close` (`field='is_active'`);
     - va en **dos UPDATE**, porque el trigger `protect_manual_overrides` revierte `is_active` mientras
       OLD lo marque como manual;
     - devuelve 409 si el viaje volvería a contar en un día firmado. El chequeo se hace DESPUÉS de
       deshacer, dentro de la transacción, porque `trips_del_dia` excluye los viajes con motivo.
   - En la Flota, "Sin especificar" en un tracto vuelve a heredar, **solo si su conductor tiene motivo**.
     Si no, la vigencia del propio tracto volvería a llenar lo que la persona borró a propósito.
- Verificado:
  - backend: cierre 61/61 y suite completa (ver checklist);
  - frontend: 1.405 tests, `tsc` y build en verde, trinquete en verde (atajó dos `text-[10px]`);
  - SQL nuevo probado con parámetros contra producción;
  - 4 mutaciones atrapadas: herencia, 409 y dos del ruteo de la fusión.

## Hallazgo que cambia D4/D5 (medido 06/10)

- El grupo "Abandonados por el TMS" del cierre tenía 52 viajes. Los 40 de Walmart, bajados del portal
  con una ventana 01/07–13/10 (en local, sin GCS):
  - **17 RETORNANDO figuran CERRADO FINALIZADO** en el TMS;
  - 2 figuran CERRADO INCOMPLETO;
  - **21 no están** en el TMS: son eliminados.
- **Causa raíz**: el scraper baja una ventana por fecha de planificación de hoy-7 a hoy+7. Un viaje
  que sale de la ventana no vuelve a actualizarse nunca, y su cierre no llega. Es la queja de Pablo:
  *"cuando el TMS se lo cambia a cerrado finalizado… no nos está generando ese cambio"*.
- La señal "Ya no está en el TMS" (`_tms_dropped`) **confunde salir de la ventana con ser eliminado**.
- El portal acepta 3,5 meses: 75 s y 1,3 MB, 5.083 filas.
- **Pablo no quiere eliminar ni que el sistema decida**: *"que se replique lo que dice el TMS"*. Los
  que sigan abiertos en el TMS sirven en el cierre para gestionar el cobro.

## Checklist — siguiente paso exacto

0. ~~HUs de Certificación~~ **REVISADAS (07/10, Ronda 167)**. La sección de Certificación de
   `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md` se reescribió contra
   la minuta, la transcripción de Granola del 02/10 y el código; los datos se verificaron con psql.
   - **C4 queda fuera de esta fase** (decisión del usuario): es un rediseño y va con plan aparte.
   - **Hallazgos**:
     - el F30-1 se creó el 01/10 con `expiration_policy=NONE`, porque `NuevoDocumentoPanel` no envía
       la política;
     - `has_expiration` sigue con lectores vivos (Sin clasificar, triage, planilla) aunque la fuente
       de verdad es `expiration_policy`;
     - "opcional" se siembra como pendiente (38 y 39 registros "falta");
     - no hay exención por empresa;
     - la póliza no se vincula a Seguros.
   - **HUs nuevas**: C5 (opcionales) y C6 (póliza, remite a HU-06).
   - **Decisión del usuario (07/10)**: *"no hagas parches, sigue el diseño de arquitectura de la
     app"*. Por eso C1 retira `has_expiration` en vez de sincronizarlo, y la recurrencia va como dato
     del catálogo.
   - **HU-C1 con patrón de vigencia** (pedido del usuario): 4 tipos cerrados (no vence, fecha del
     documento, plazo desde emisión, período de calendario), con días de aviso y de gracia.
     - El documento guarda el período que cubre, y el estado se calcula al leer.
     - La regla por cliente es una variante de parámetros del mismo requisito, **no** un requisito
       con `shipper_id`, que sembraría un registro duplicado.
     - Cambiar la política no reescribe documentos aprobados.
   - **Plan de la entrega 1 de C1 escrito (07/10)**, sin ejecutar:
     `docs/superpowers/plans/2026-10-07-c1-una-sola-politica-de-vencimiento.md`.
     - Contenido: todos los lectores pasan a `expiration_policy`, un selector compartido para crear y
       editar, Sin clasificar muestra la fecha si es OPTIONAL, y `DROP COLUMN has_expiration`.
     - El DROP tiene compuerta: `webcarga-monitor-api` (rama `main`, 01/08) usa la misma base y lee la
       columna.
   - **Entrega 1 de C1: Tasks 1-5 HECHAS y pusheadas a `dev` (07/10)**, commits `adc0977a..5ae76d43`
     más la corrección del plan `721ee5c2`.
     - Suites: backend 1.089 en verde (19 min, con integración); frontend 1.412 en verde, `tsc` y
       build en verde.
     - Revisión final (opus): 0 hallazgos críticos o importantes.
     - Ledger: `.superpowers/sdd/2026-10-07-c1-una-sola-politica-de-vencimiento/progress.md`.
   - **Task 6 HECHA (07/10)**: Deploy Monitor API y Deploy Frontend en verde sobre `721ee5c2`.
     Click-through con Playwright en dev: "Nuevo documento" muestra "Fecha de vencimiento" con las 3
     opciones (por defecto "No aplica"). No se creó nada.
     - De paso se vio en vivo el rótulo engañoso de "Opcional" ("No se le pide a nadie por defecto"),
       que es la HU-C5.
   - **Task 7a HECHA (07/10, a pedido del usuario: expand/contract)**: `has_expiration` es ahora una
     columna GENERADA (`expiration_policy <> 'NONE'`), con la migración `20261007120000` aplicada vía MCP.
     - Datos iguales: 21 true y 17 false.
     - Test de integración en verde; 0 errores 5xx en la API.
     - Un rollback de la API anterior a `5ae76d43` ya no da 500.
   - **PENDIENTE Task 7b (DROP has_expiration)**: solo limpieza, sin fecha. Va cuando el usuario
     confirme que la entrega 1 está estable. El ledger del plan sigue vivo hasta entonces.
   - **Menores diferidos**:
     - classify-batch guarda una fecha en un documento NONE (preexistente);
     - el test guardián solo cubre `app/*.py`.
   - **CIERRE 07/10 — EN ESPERA**: WebCarga va a compartir la **HU de vencimientos actualizada** para
     implementarla. Al recibirla:
     - contrastarla con el diseño de HU-C1 en el archivo de HU (4 tipos, período cubierto, aviso y
       gracia, regla por cliente) y marcar qué coincide, qué cambia y qué sigue abierto;
     - recién después, armar el plan de la entrega 2.
     - Lo que dijeron el 02/10 sobre el corte por cliente (transcripción):
       - ventanas configurables por cliente: Pronexo/IANSA corta el F30 el día 5 y el F30-1 el 18;
       - un estándar de WebCarga más variantes por cliente;
       - granularidad "específico documento";
       - una frase cortada: *"nos acostumbraremos a la plataforma de Pronexo, que es el 18"*.
     - **No se respondió** si un mismo archivo le sirve a dos clientes.
     - Propuesta (no aplicada en el archivo de HU): preguntar con 3 opciones: un archivo evaluado contra
       el corte de cada cliente / un solo corte, el más estricto / un registro por cliente.
   - Resto de Certificación sin implementar:
     - C2 se puede hacer ya;
     - C5 espera qué significa "opcional";
     - C3 espera lo que tenga Enrique;
     - C6 espera una auditoría de Seguros;
     - C4 va con plan aparte.
   - **Siguiente paso**: bilateral con Pablo con la agenda al final del archivo de HU. Orden
     propuesto: C1 base (HECHA) → C5 → C3 → C2 → C1 recurrente → C6.
   - `tms_daily_reconciliation`: el usuario lo habilitó el 07/10. La API de mage-agent no muestra la
     hora del trigger. Al 07/10 hay 1 fila del día por stream (qanalytics, sodimac, wingsuite).
     **El 08/10**, revisar que `bronze.tms_reconciliations` tenga filas
     nuevas del 08/10 para qanalytics, sodimac y wingsuite. Si están, el trigger corrió.
   - `tms_daily_tests`: **no crear el trigger.** Queda registrado como deuda técnica en `TECH_DEBT.md`
     (07/10). No avisa ante una falla, no hay Slack ni casilla en esta fase, y no incluye
     `stg_tms_presence`.

1. ~~Commit + push~~ HECHO: `b1f30296` en `dev`; Deploy Monitor API y Deploy Frontend en verde.
2. **D4/D5 aprobado (06/10) con reconciliación diaria. Orden decidido por el usuario: Ronda 164 primero y
   D4/D5 después.**
   - **Migración 20260924100000 APLICADA** el 06/10 a las 18:27 CL. Registro sembrado: 5 streams, últimos
     archivos de las 18:15-18:18. Mientras no se sincronice la 164 es inocua, porque el código viejo no lee
     la tabla.
   - **RONDA 164 DESPLEGADA (06/10, 18:40 CL).** `sync_local_to_remote` subió 20 archivos: la 164, la
     guarda de la 165 y el pipeline `tms_daily_tests`. **Sin crear el trigger diario**, que lo crea el
     usuario. El conflicto de `metadata.yaml` queda sin subir porque el sync salta los conflictos.
     - Conclusión al leer `mage_agent/tools/sync.py`: compara mtimes por IGUALDAD exacta. El usuario
       corrió en su terminal un comando que fijaba la marca remota en "ahora" y no sirvió.
     - **Falta** que el usuario ponga a mano el `concurrency_config` en la UI de Mage: límite 1, skip.
     - Primera corrida (18:45-19:01): los 5 streams cerraron sus archivos en el registro.
       **Wingsuite recuperó 22 archivos con datos y 992 vacíos posteriores al 25/09**, que la marca de
       agua vieja nunca tomó.
     - `app.trips` se actualizó a las 19:01 tocando solo 7 viajes.
     - El clasificador bloqueó leer `n_tup_upd` con psql, así que no hay medición de antes/después.
   - Bloqueo anterior: `sync_status` marca conflicto en `pipelines/batch_tms_monitor_trips/metadata.yaml`
     (remoto modificado el 24/09 23:44). Contra `pipeline_get`, el remoto tiene los mismos 34 bloques y
     el mismo grafo; solo le falta el `concurrency_config` (run_limit 1, skip).
     `pipeline_update` da 405. Marcar el remoto como revisado en `.mage-agent-sync-state.json` lo bloqueó
     el clasificador: **lo decide el usuario**.
   - Los 5 upserts ya tienen la guarda "file_ts nuevo > vigente", así que reprocesar archivos viejos
     en la primera corrida no hace retroceder datos.
   - `status_reported_at` viene del snapshot, que solo versiona cuando el payload cambia: ya significa
     "último cambio" y la 164 no lo altera. Por eso **la presencia en el TMS no se puede leer de ahí**:
     hay que sacarla de los archivos.
   - Confirmado en dbt: `trip_status` prioriza el SAP CERRADO, y el OR 3 del incremental vuelve a
     procesar los qanalytics cuyo milestone pasa a CERRADO. **Ampliar la ventana del SAP basta para que
     los 19 cerrados se cierren solos.**
   - Para marcar eliminados (los 21 que no están): un bloque lee los Nro SAP del archivo ancho y marca
     los viajes abiertos de Walmart con planificación dentro de la ventana que no aparecen. Va en una
     tabla aparte que dbt no toca (`app.trip_source_presence`).
   - **Wingsuite no trae archivos desde el 25/09** (último archivo en el registro). Hay que revisarlo aparte.
   - **D4/D5 DESPLEGADO (06/10, noche), según el patrón Mage → bronze → dbt → app.** La primera
     versión creaba una tabla `app.trip_source_absences` que escribía directamente el bloque de Mage.
     El usuario la objetó por salirse del patrón y **se retiró ese mismo día** con un DROP aplicado;
     estaba vacía y nada la leía.
     - Migraciones:
       - `20261006120000`: solo `monitor_alert_rules.stale_trip_days`, que puede quedar vacío. El
         archivo explica la historia.
       - `20261006130000`: `bronze.tms_reconciliations`, con una fila por reconciliación y `trip_ids`
         crudos.
     - Mage, pipeline `tms_daily_reconciliation`:
       - El bloque `reconciliacion_qanalytics_sap` baja el reporte SAP desde el viaje abierto más
         antiguo (tope de 120 días) y escribe la fila cruda en bronze. No compara nada.
       - El bloque dbt `stg_tms_presence` es una **TABLA**, no una vista. Las vistas de silver se
         recrean en cada corrida de 15 min con `DROP CASCADE`. La primera versión, como vista, falló
         al crearse; el log de Mage se corta antes del error.
       - Macro `trip_planning_date` compartida con `app/trips.sql`.
       - `app.trips.tms_missing_since` se agrega con OR 5 en el incremental. Ese OR tiene una guarda
         `adapter.get_columns_in_relation` para la primera corrida, cuando la columna todavía no
         existe.
       - Despliegue en 2 fases: primero la vista, luego `trips.sql`, para no romper la corrida de 15 min.
     - extraction_service `11f9a906`: el clic de exportar usa `min(timeout_ms, 60 s)` en vez de 10 s.
       Con el reporte ancho, Cloud Run daba "Timeout 10000ms".
     - **Resultado medido (20:50 CL):**
       - la reconciliación trajo **2.774 viajes** (02/07 → 13/10);
       - `stg_tms_presence` marcó **22 ausentes** (los 21 esperados más 2064048) y ningún falso positivo;
       - `app.trips` tiene las 22 marcas;
       - **los 17 RETORNANDO viejos pasaron a CERRADO solos** cuando entró el reporte ancho.
     - Efecto colateral: al redesplegar extraction se reinicia su cola en memoria. La corrida de
       las 20:00 perdió el archivo de Walmart y su transformador cayó con un error de pod (transitorio);
       `app.trips` quedó sin actualizarse de 19:40 a 20:28.
     - API: el cierre excluye `tms_missing_since` de todos los grupos y "abandonado" excluye los
       entregados hace más de `stale_trip_days`; "En curso" excluye `tms_missing_since`.
     - UI: "Eliminado en el TMS" en TripTable, y el umbral en Configuración › Umbrales.
     - Tests: backend con 1.079 en verde y los 3 rojos preexistentes de eliminar; frontend con 1.408.
       Las mutaciones de las guardas se detectaron.
     - **Verificado en vivo** (21:00 CL, despliegue `56dca9cc`):
       - 2064048 no aparece en "En curso" y sí en el historial, con `tms_missing_since`;
       - "Abandonados" del cierre del 06/10 bajó **de 52 a 12** y ya no queda ninguno de Walmart.
         Quedan Sodimac 9, Wingsuite 2 y manual 1: las fuentes que todavía no tienen reconciliación.
     - **Wingsuite agregado (06-07/10, noche).** Utilidad compartida `utils/reconciliacion.py` y bloques
       `reconciliacion_qanalytics_sap` y `reconciliacion_wingsuite`.
       - Medido antes de construir: IANSA no necesita reconciliación (172/172 coinciden). Wingsuite: los 2
         en RUTA estaban Terminado en el TMS; su id es `ID_VIAJE`.
       - **Resultado**: 439974 y 444473 → CERRADO FINALIZADO. "Abandonados" bajó a 10: 9 ofertas de
         Sodimac y 1 manual.
     - **`stg_tms_presence` ahora es una VISTA dentro de `batch_tms_monitor_trips`**, entre
       `int_tms_trips_conformed` y `app_trips_update`.
       - Construirla en el pipeline diario falló dos veces: chocaba con el `DROP CASCADE` de
         `int_tms_trips_conformed` (cotejado con los tiempos de los bloques: 22:38 y 00:28 UTC).
       - El pipeline diario ahora solo escribe en bronze.
     - **INCIDENTE (mío): ingesta detenida de 21:30 a ~00:20 CL.**
       - Subí el grafo nuevo de batch con una corrida en vuelo (14266). Su `app_trips_update` quedó
         esperando un bloque que esa corrida no tenía, y el mismo sync activó el límite de concurrencia
         (`skip`), así que las corridas siguientes se saltaban.
       - Quité el límite para destrabar. Mage lanzó corridas en paralelo, chocaron en las tablas
         `tmp_raw_*` y saturaron extraction.
       - El usuario canceló la 14266 en la UI. Límite restaurado (1, skip) y verificado:
         `app.trips` actualizado a las 00:24.
       - **Regla: nunca subir un cambio de GRAFO de `batch_tms_monitor_trips` con una corrida en vuelo.
         Esperar a que termine y subir antes de la siguiente.**
     - **Sodimac (07/10, 00:46–01:50 CL), resuelto por el catálogo y sin reglas por fuente:**
       - Medido en el historial: Sodimac nunca dijo "ASIGNADO".
         - `Publicada` es una oferta. Después pasa a Aceptada, Removida o Declinada, o desaparece.
         - `Presentada` significa que el camión está en origen.
         - El tooltip "· Sodimac" del 25/08 corregía en pantalla la traducción nuestra.
       - Migración `20261007100000`: `Publicada` en el grupo `otro` con `counts_as_load=false`, y
         `Presentada` en `en_ruta`. `int_tms_trips_conformed` ya no los traduce; `is_assigned` excluye
         `Publicada`.
       - `stg_tms_presence.tms_absence_kind` sale del CATÁLOGO: un estado no terminal que no cuenta como
         carga y desaparece es una `oferta_retirada`; si no, es un `eliminado`. El freno del 50 % no
         cuenta las ofertas. Fuente dbt nueva: `app.trip_statuses`.
       - Migración `20261007110000`: pasada única que lleva los 64 viajes ASIGNADO de Sodimac a
         `Publicada`, copiando lo que da la homologación.
       - El bloque `reconciliacion_sodimac` volvió al pipeline diario. La reconciliación 14286 trajo
         Walmart 2.799, Sodimac 357 y Wingsuite 0 (vacío, contenido por el freno).
       - **Resultado (01:47):**
         - Sodimac: 61 ofertas retiradas, 12 sin declarar y 49 declaradas; 5 eliminados, ya declarados.
         - Walmart: 22 eliminados.
         - Coincide exactamente con la simulación previa contra la lista real.
       - API: grupo nuevo `oferta_sin_declarar` en el cierre (se puede seleccionar y no bloquea); el
         Monitor expone `tms_absence_kind`. UI: "Oferta retirada por el TMS" frente a "Eliminado en el
         TMS", y **se retiró el parche `origenExterno`/`origen` del StatusBadge**.
       - **Incidente 2:** la corrida 14279 (00:45) quedó en "0/0" porque subí los cambios de dbt a las
         00:46, mientras arrancaba. Por el límite (1, skip), las siguientes se saltaron. El usuario la
         canceló. **Regla: no subir nada a Mage en las ventanas :58–:02, :13–:17, :28–:32 ni :43–:47.**
       - mage-agent dio "[404] Email/username and/or password invalid" un rato y después se recuperó
         solo.
       - **Desplegado y verificado en vivo (07/10, 02:05, Playwright en dev):** `c73d7127`, con API y
         Frontend en verde. Cierre del 07/10: Hoy 2, Rezago 13, **Ofertas sin declarar 12**, En curso 10
         y Abandonados 1 (es el viaje manual de prueba HBC(test) 100). Historial: el 881457 dice
         "PUBLICADA · Oferta retirada por el TMS" y el 2000691 (Walmart) dice "Eliminado en el TMS". Ya
         no aparece la marca "· Sodimac".
       - Detalle visual menor: una oferta retirada muestra "115h desde despacho" aunque nunca se
         despachó. Lo hereda el reloj genérico; no se toca sin hablarlo.
     - Sodimac, versión anterior (descartada): Su lista retira las ofertas (crudo `Publicada`) que WebCarga no tomó.
       No son viajes eliminados.
       - Hoy la homologación traduce `Publicada`/`Presentada` → `ASIGNADO` (grupo `en_ruta`,
         `counts_as_load` true). El usuario rechazó resolverlo con una regla escrita a mano por fuente.
       - Propuesta acordada: dejar de traducir y mostrar `Publicada` tal como lo dice el TMS, como ya pasa
         con Aceptada, Creada y Control de salida. `Publicada` se agrega al catálogo con un grupo de
         oferta, y la presencia lee de ahí el tipo de ausencia.
       - ~~Pendiente: medir el impacto~~ HECHO y desplegado (ver arriba).
       - Datos: 64 ofertas, 51 ya declaradas con motivo; 0 a 1 por día cuentan en `trips_del_dia`.
       - El bloque está guardado fuera del mirror (scratchpad: `reconciliacion_sodimac.py.pendiente`).
     - **Pendiente del usuario**: crear el trigger diario de `tms_daily_reconciliation` (~06:30 CL) y
       definir `stale_trip_days` con Pablo.
     - **Alcance final**: Walmart (SAP), Sodimac y Wingsuite. IANSA no lo necesita (172/172 coinciden).
     - **Sigue abierto**:
       - ~~3 tests de `test_eliminar_viajes_integracion.py`~~ RESUELTO en `e733f97a`: usaban el 23/09, que se
         firmó en producción; ahora usan el 01/01/2099;
       - la cola en memoria del extraction_service, frágil ante un redeploy;
       - estados crudos de Sodimac fuera del catálogo: Carga finalizada, Salida rechazada y
         Presentada en origen;
       - con Pablo: `stale_trip_days`, la vista fusionada, la cifra en vivo de un día firmado y las HUs
         de Certificación.
   Diseño original, antes de medir:
   - corrida diaria de **reconciliación** con la ventana desde el viaje abierto más antiguo, con tope;
     las de 15 min quedan como están (el disco de Supabase es el cuello, Ronda 164);
   - eliminado = ausente dentro de la ventana cubierta por la reconciliación, marcado y no borrado;
   - pegados de verdad: siguen en el cierre para gestionar el cobro y salen del Diario a los X días
     de la entrega.
   - Precondición: el mirror de Mage tiene las Rondas 164 y 165 sin sincronizar.
3. ~~Click-through en dev~~ HECHO 06/10 con Playwright:
   - **05/10 (firmado)**: 47 filas = 46 tractos + 1 conductor en "Otros conductores del día".
     Cuadra con la base. La tabla está en solo lectura.
   - **Viajes 06/10**: se ven las columnas de contexto. Elegir un motivo no escribe nada.
     "Guardar" escribe y el viaje pasa a "Con motivo".
   - **Bug real atrapado ahí**: "Deshacer" dio 409 sobre el 881496, un rezago planificado el 02/10,
     día firmado CON el viaje adentro. Corregido en `30c839ad`: solo bloquea un día firmado DESPUÉS
     de la declaración. Tras desplegar, el viaje volvió idéntico (`is_active=t`, sin motivo, `{}`).
   - **GPRZ30** sigue en ámbar en Pendientes y no bloquea.
   - Queda anotado, sin resolver, el caso inverso: `bulk-close` sobre un viaje de un día firmado
     también le cambia el `trips_del_dia` en vivo. Los `frozen_totals` no cambian.
4. Avisar a Pablo que "Conductores" y "Tractos" quedaron en una sola vista.

### 2026-10-01 — Ronda 165: Diario 2.0, puntos 5 y 12 (bugs del 01/10)

Fuentes: `monitor-app/bugs/20261001/` (docx + `requirements-bug-12.md`, que ES el punto 12) y la
llamada con Fabián del 01/10 (Granola). Plan: `~/.claude/plans/mossy-enchanting-cupcake.md`
(la parte de GPRZ30 del plan quedó SUPERADA, ver abajo).

## Causas raíz (medidas contra producción)

- **Doble carga de motivos (punto 5)**: `_propagar_al_tracto_habitual` solo propagaba "no trabajó",
  escribía "Sin conductor" y no seguía cambios ni vigencias. 18/09–01/10: Operaciones escribió
  a mano en el tracto **el mismo motivo** del conductor 108 veces (87 + 21).
- **Rafael / BDLC92 (RF-02)**: `POST /carriers/{id}/assets` nunca marcaba `is_manual_override`
  (el arreglo del 16/09 llegó solo a conductores) y el loader `load_asset_asignments_07` lo
  revertía: BDLC92 se transfirió 6 veces en un mes. 18 tractos transferidos en la app; 3 revertidos.
- **Brian Celis**: ficha duplicada (18659820-2 ACTIVA, 19003069-5 INACTIVA, con 12 documentos);
  el matcher exigía un único candidato → 27 vínculos a mano en 30 días. FCCP42 colgaba del
  inactivo en `vehicle_driver_assignments` (padrón legacy con el RUT viejo).
- **GPRZ30 (RF-01)**: fue de Transportes Miraflores hasta 2024; el TMS la informa en Moneda (jul)
  y Bugarin (desde 09/09), ninguna en el directorio. `PATENTE_NO_REGISTRADA` bloqueaba el día.

## Hecho (LOCAL, sin comitear; suites corriendo/verdes salvo lo anotado)

1. **Herencia del motivo** — `cierre_lineas.py`: `_SQL_SINCRONIZAR_TRACTOS` (por conjuntos, todo
   el día) reemplaza a `_propagar_al_tracto_habitual`; corre en `poner_motivo` (conductor) y en
   `recalcular` tras la vigencia. Columna `closure_lines.reason_from_driver_id` = procedencia
   (no nulo = heredado, sigue al conductor; nulo = lo escribió una persona, nunca se pisa).
   Elegir/borrar motivo en el tracto corta la herencia; un comentario no. UI: "Heredado de X".
   Migración `20261001120000` — **la columna YA ESTÁ APLICADA en producción** (sin backfill, a
   propósito: no adivinar los "Sin conductor" viejos).
2. **Traspaso único** — `carriers.py::_transferir` sirve a conductores y tractos (eran dos copias).
   Migración de reparación `20261001100000` (18 tractos, sin revivir filas INACTIVE marcadas a mano:
   HYXB37/JDYY73). Guarda por equipo en el mirror de Mage `custom/load_asset_asignments_07.sql`.
3. **Matcher** — migración `20261001110000`: con varios candidatos por nombre gana la ÚNICA ficha
   activa; `sync_habitual_drivers` ya no cuelga tractos de fichas inactivas; repunta los vínculos
   habituales a la ficha activa homónima (FCCP42; FLPY18 queda para Operaciones); re-resuelve
   45 días de viajes auto sin conductor.
4. **GPRZ30 — decisión del usuario (opción A, 01/10)**: `PATENTE_NO_REGISTRADA` sale de
   `ESCALACIONES_QUE_BLOQUEAN` (RF-01/CA-01 literal: ninguna patente sin empresa bloquea). Sigue en
   Pendientes, en ámbar, con la empresa que informa el TMS (`tms_carrier_name`) y "Crear empresa
   nueva" prellenado. **Revierte la regla de Pablo del 21/08**. Se descartaron "flota de
   terceros" y la auto-asignación (nadie las pidió).

## Checklist — siguiente paso exacto

1. ~~Suites~~ HECHO: backend 1.069 verdes + 3 rojos preexistentes (`test_eliminar_viajes_integracion.py`
   falla igual en el código comiteado: elige viajes reales que hoy son de días firmados — arreglar
   aparte, el sujeto lo tiene que crear el test). Frontend: secciones 68 verdes, `tsc` limpio,
   trinquete de escala en verde (la suite completa dio 1.397/1.398 antes de corregir el trinquete).
2. ~~Migraciones~~ HECHO 01/10 ~21:05 UTC, con la base quieta:
   - `20261001100000`: 16 tractos reparados y marcados (BDLC92 → Villegom, DTBY52 → La Fortaleza;
     HYXB37/JDYY73 sin tocar, a propósito).
   - `20261001110000`: aplicada en 3 partes por el MCP (la llamada entera dio "Invalid or expired
     requestState" y no aplicó nada). FCCP42 → 18659820-2. **32 viajes re-resueltos**: 2 de Brian y
     30 de conductores cuya ficha se creó DESPUÉS del viaje (Paredes, Navarro, Suárez, Toro, Mejías);
     9 caen en días firmados — sus `closure_lines` NO cambiaron (0 tocadas), pero una pantalla que
     lea los vínculos en vivo de esos días ahora muestra conductor donde antes había vacío.
   - `20261001120000`: la columna ya estaba aplicada desde antes.
3. ~~Commit + push~~ HECHO: `f947c419` en `dev`; Deploy Monitor API y Deploy Frontend en verde.
4. Mage: sincronizar `load_asset_asignments_07.sql` — el mirror tiene la Ronda 164 SIN sincronizar;
   decidir con el usuario si va todo junto.
5. Click-through en dev: motivo al conductor → tracto con "Heredado de"; GPRZ30 en ámbar y
   "Confirmar cierre" sin bloqueo. Avisar a Fabián (y a Pablo por el cambio de regla del 21/08).
6. Pendiente de la llamada, fuera de alcance: "Eliminar viaje" no aparece en manuales previos al 30/09.

### 2026-09-24 — Ronda 164: caída de la tarde (Disk IO agotado) y recorte del IO de la ingesta

Plan aprobado: `~/.claude/plans/purring-hugging-meteor.md`.

## Diagnóstico (medido)

- **16:45 CL**: la base (org `webcarga`, **plan free**, confirmado con `get_organization`) agotó
  el Disk IO. Hubo `statement timeout` a razón de 140/h, checkpoints de 4 páginas/s y el MCP no
  podía conectarse. Supabase Auth comparte esa base, así que `/token` daba 10 s de timeout y el
  login devolvía **504 "Gateway Timeout"**. El "304" que vio el usuario es caché del navegador,
  no un error.
- **No fue la concurrencia** (el tráfico web es de decenas de requests cada 15 min) **ni el
  tamaño** (239 MB contra 500). Esto corrige la hipótesis "Micro/CPU" de la Ronda 163: el cuello
  es el disco.
- **La ingesta corre cada 15 min las 24 h**, no cada 30. Cada corrida dura 7-8 min, así que la
  base pasa la mitad del día bajo carga. El usuario decidió **mantener 15 min**.
- **Causa principal**: los 5 `insert_raw_*.sql` reescribían TODAS las filas de cada archivo
  (payload jsonb, índices, WAL) aunque nada cambiara. Dos cosas dependían de esa reescritura:
  - La marca de agua de los 5 processors: `SELECT file_name ... ORDER BY last_updated_at DESC`.
  - La alarma de SAP caído: `stg_qanalytics_trips.sap_block_liveness`.
  Según la macro `is_stale`, el 98 % de las filas SAP no cambia en 24 h.
- Otras fuentes de carga:
  - `slv_milestone_trips` se reconstruye con `--full-refresh` en cada corrida.
  - `+trips` vuelve a correr todo el upstream.
  - `dbt test` corre cada 15 min.
  - 5 CREATE y 5 DROP de `tmp_raw_*` generan unas 400 líneas de recarga de esquema de
    PostgREST por hora.
- La API `pipeline_list` de mage-agent devuelve un DAG desactualizado (del 19/08, sin
  `app_trips_tests`). **La verdad es el `metadata.yaml`**, que coincide con los logs.

## Hecho (LOCAL, sin desplegar; el mirror de Mage no está en git)

1. **Registro de archivos**, en reemplazo de la marca de agua. El usuario pidió la versión robusta,
   no un parche:
   - Migración `monitor-app/backend/supabase/migrations/20260924100000_bronze_ingested_files.sql`.
     Crea `bronze.ingested_files` y la siembra desde `bronze.tms_trips`. **No aplicada.**
   - `utils/ingested_files.py`: `select_new_files` elige los archivos que no están cerrados, con
     una ventana de gracia de 6 h para los atrasados. `register` los marca `pending` o `empty`.
     Probado en local con una conexión falsa.
   - Los 5 processors usan el registro. Wingsuite marca `empty` los archivos vacíos.
   - Los 5 `insert_raw_*.sql` agregan `AND payload IS DISTINCT FROM EXCLUDED.payload`, cierran los
     archivos que aterrizaron como `loaded` y los `pending` sin filas como `empty`.
   - `stg_qanalytics_trips.sap_block_liveness` lee `MAX(loaded_at)` del stream SAP.
     `sources.yml` declara `ingested_files`.
   - `status_reported_at` / "Ya no está en el TMS" no cambia: sale del snapshot, que ya solo
     versionaba cuando cambiaba el payload.
2. `dbts/app_trips_update.yaml` pasa de `+trips` a `trips trip_stops`. El DAG ya ordena
   `slv_milestone_trips → stg_qanalytics_trips → int → app_trips_update`. Se quitó el
   `--full-refresh` de los 3 yaml de vistas.
3. `app_trips_tests` sale de `batch_tms_monitor_trips` y pasa al pipeline nuevo
   `pipelines/tms_daily_tests/`. `batch_tms_monitor_trips` queda con
   `concurrency_config: pipeline_run_limit 1, skip`.

## Estado al cerrar la sesión (24/09, ~21:10 CL)

- **El trigger de `batch_tms_monitor_trips` está PAUSADO** (lo pausó el usuario; la última
  actividad de Mage fue a las 23:38 UTC). **Nada de Mage está desplegado todavía.** El pipeline
  en vivo es el de siempre: al reactivarlo sin sincronizar vuelve la carga vieja.
- **La migración 20260924100000 NO está aplicada** (commiteada, sin aplicar). Hubo tres intentos
  y ninguno terminó:
  - `execute_sql` del MCP: timeout.
  - SQL Editor del Studio: "failed fetch api.supabase.com". El Studio corta a 58 s
    (`statement_timeout='58s'`) y además tiene timeout HTTP.
  - `psql` por el pooler: `ECHECKOUTTIMEOUT`, el pool estaba agotado.
  El `CREATE`/`INSERT` es idempotente, así que se puede reintentar tal cual. Antes hay que mirar
  `pg_stat_activity` por si un intento anterior quedó colgado.
- **La base seguía estrangulada con Mage quieto.** Los checkpoints escribían 124 buffers en 33 s,
  y el catálogo del Studio, las recargas de PostgREST y `pgbouncer.get_auth` tardaban 11-21 s.
  El presupuesto de IO del plan free solo se recarga con uso bajo el nivel base: **no conviene
  consultar la base mientras tanto**, porque cada intento lo gasta. Además aparece
  `archive command failed` en los logs.
- La línea base medida antes del bloqueo (`pg_stat_statements` acumula desde el 17/04, 47 GB
  de WAL en total):
  - **Una sola sentencia de dbt = 21 GB de WAL y 2,87 millones de bloques escritos**, en 7.354
    llamadas. No alcancé a ver qué nodo es: la consulta excedió el timeout.
    **Es lo primero que hay que identificar**; sospechosos: el `create table` con
    `--full-refresh` de `slv_milestone_trips` o el merge de `app.trips`.
  - `bronze.tms_trips`: **2,5 millones de updates sobre 8.889 filas**, 0 HOT.
  - Los `COPY` a `tmp_raw_*` suman 2,7 GB (SAP), 1 GB (Sodimac) y 0,8 GB (Wingsuite).
  - `bronze.raw_bd_ot` pesa 80 MB, la tabla más grande (pipeline `legacy_drivers_transporters`).
- Conexión por `psql` desde este equipo: el host directo `db.<ref>` es solo IPv6 y no resuelve.
  Hay que usar `aws-1-us-east-1.pooler.supabase.com:5432` con el usuario
  `postgres.viclzoftiudkepqnhekv` y la clave de `monitor-app/backend/api/.env`.

## Checklist — siguiente paso exacto

1. **Revisar solo los logs** (`query_logs`): que no haya `statement timeout` y que los
   checkpoints escriban a ritmo normal (menos de 5 s por cada ~300 buffers). Si pasada ~1 h
   sigue igual o el pool sigue agotado, **el usuario reinicia el proyecto** (Settings → General →
   Restart). El reinicio no recarga el IO, pero libera las sesiones colgadas.
2. Con la base respondiendo:
   - aplicar la migración con
     `psql <pooler> -f monitor-app/backend/supabase/migrations/20260924100000_bronze_ingested_files.sql`,
     sin pasar por el Studio;
   - verificar con `select stream, count(*), to_timestamp(max(file_ts)) from bronze.ingested_files group by 1`.
     Deben aparecer 5 streams, con el último cerca de las 23:30 UTC del 24/09.
3. `sync_status`, luego `sync_local_to_remote`. Confirmar en `metadata.yaml` remoto que ya no
   está `app_trips_tests` y que `concurrency_config` quedó en `pipeline_run_limit 1, skip`.
   El usuario confirmó `skip`: `wait` tampoco recupera el estado del turno saltado, porque el
   scraper baja el estado actual.
4. **Usuario**: reactivar el trigger. Crear el trigger diario de `tms_daily_tests` a las ~07:30 CL.
5. Verificar la primera corrida:
   - verde;
   - `ingested_files` con `loaded` por stream;
   - `last_sap_ingest_at` avanza;
   - `n_tup_upd` de `bronze.tms_trips` cae;
   - sin `CREATE ... tms_milestone_trips` duplicado.
6. Identificar el nodo dbt de 21 GB de WAL:
   `select calls, wal_bytes, left(query,700) from extensions.pg_stat_statements order by wal_bytes desc limit 3`,
   con la base sana y `statement_timeout` holgado.
   Medir las filas de `silver.tms_milestone_trips` que ya no están vigentes en `tms_sap_snapshot`.
   Si son ~0, quitar `--full-refresh` de `dbts/slv_milestone_trips.yaml`.
   Después, `select extensions.pg_stat_statements_reset()` para medir el antes/después por corrida.
7. Paso 5 del plan: staging `tmp_raw_*` permanente con TRUNCATE, para cortar la recarga de
   PostgREST. Va en un despliegue separado, después de medir el 5.

### 2026-09-23 — Ronda 163: bugs del 23/09 (alta manual 500, cierre del 22/09) + eliminar viajes

Reportados en `monitor-app/bugs/20260923/` (dos screenshots). Plan aprobado en
`~/.claude/plans/necesito-que-revises-los-fluffy-quilt.md`.

## Causa raíz, medida (no supuesta)

- **Bug 1, alta manual "Error 500"**: 8 POST /trips con `UniqueViolationError uq_trip_fleet_link`
  en Cloud Run. El INSERT en `app.trips` dispara `trg_trips_resolve_fleet_ins`, que ya escribe el
  vínculo `auto`, y `_insert_trip` insertaba el `manual` sin ON CONFLICT. **Nunca funcionó desde el
  17/08**: hay 1 viaje manual con link manual en toda la historia (07/07). Sin transacción, cada
  reintento dejó un viaje a medias: **9 viajes huérfanos** (7 copias de SAN BERNARDO→IANSA del 23/09,
  1 HBC del 23/09 y 1 del 21/09). La rama CSV por patente chocaba igual.
- **Bug 2, cierre del 22/09**: **el POST de cierre nunca llegó a la API**. La base de Supabase se
  saturó de 22:30 a 02:00 UTC (142 statement timeouts, un `SELECT` de catálogo de 11 s, checkpoints
  de 127 s, con pocas conexiones activas: es hambre de CPU/IO, no locks ni conexiones). Supabase Auth
  usa esa base, así que cayó con ella (85/93 `/token` con 504). La app llamaba a Auth por HTTP en
  CADA request (middleware, layout, API síncrona que bloqueaba el event loop): cada página tardó
  ~35 s → `307 /login` → el login de Microsoft dio el Gateway Timeout del screenshot.
- **El 23/09 se REPITIÓ** desde las 21:00 UTC (18:00 CL): 140 statement timeouts y 169 errores 5xx
  de Auth hasta las 00:00 UTC; el JWKS de Auth tampoco respondía. La noche del 21/09: cero.
  **Es recurrente, no un evento aislado.**

## Decisiones de arquitectura

1. **Un solo dueño por escritura del vínculo manual**: `_escribir_link_manual` es un upsert que
   CONVIERTE el `auto` del trigger en `manual` (terminal). Lo usan el alta y `assign_fleet_link`, que
   esquivaba el mismo choque con SELECT+DELETE+INSERT. La resolución automática es sólo del trigger:
   se retiró `_auto_resolve_fleet_link`.
2. **`create_trip` en transacción**, como `/bulk`. **Manejador global** en `main.py`: un 500
   imprevisto responde JSON `detail` con `ref.` que también queda en el log.
3. **Eliminar viajes**: sólo `source_system='manual'`; admin/owner o el creador
   (`trips_manual.created_by`); nunca si `app.trips_del_dia(D)` lo incluye con D CLOSED. La regla vive en
   `services/eliminar_viajes.py` y decide también `can_delete` en el listado (la UI nunca ofrece lo
   que el backend rechaza). **No hay FK hacia `app.trips` en producción** (dbt las borra): el servicio
   borra a mano `closure_lines`, `trip_notes` (adjuntos por cascada, Storage después del commit),
   `trip_fleet_links`, `trip_stops`, `trips` y **`trips_manual`** (si no, dbt lo resucita). Deja una
   fila `delete` en `audit_log`.
4. **La barra de selección de Certificación se volvió `components/ui/BarraDeSeleccion`**, y
   `TriageBulkBar` la compone. No se creó una barra hermana.
5. **Sesión verificada localmente** (patrón oficial de Supabase para llaves asimétricas, ES256):
   PyJWT en la API y `getClaims` en Next, a través de `leerSesion()` (lib/supabase/sesion.ts), la
   única lectura de sesión del servidor. **Auth caído ≠ sin sesión**: lleva a `/auth/no-disponible`,
   no a `/login`. JWKS inalcanzable = 503, no 401.
6. **La llave PÚBLICA va versionada** (`backend/api/app/supabase_jwks.json` y
   `frontend/lib/supabase/jwks.json`), porque el JWKS de Auth tampoco respondía y Cloud Run arranca
   en frío (min-instances=0). Un kid desconocido se busca en vivo. **Revocar una llave exige sacarla
   de los dos archivos.**

## Estado: DESPLEGADO en dev (24/09, ~01:50 UTC)

- Commits en `dev`: `91b69bc0` (alta + eliminar), `72bcccda` (auth), `73db5e1e` (fix de la regla de
  día firmado). Workflows API y Frontend en verde; `/health` 200; sin token → 401; cero errores en
  Cloud Run; el middleware nuevo reconoce la sesión (Playwright entró directo al Monitor).
- Verde con la base sana: integración de alta manual 4/4, eliminación 6/6 (con mutación comprobada
  sobre el borrado de `trips_manual`), backend unit 804, frontend 1395 + tsc + build. Listado del
  Monitor: 213 ms antes y después del JOIN nuevo.
- **Error mío atrapado en vivo**: la regla de "día firmado" miraba `closure_lines` TRIP, que en
  producción NO existen (sólo ASSET/DRIVER; la ola 4.4 sigue pendiente). El test pasaba porque
  fabricaba una. Ahora usa `app.trips_del_dia(D)`, la misma definición con que el cierre cuenta los
  viajes, y el test firma un día real.
- **El 23/09 lo firmó Operaciones a las 22:51 CL con `viajes: 38`, que INCLUYE las 6 copias
  sobrantes de IANSA.** Por la regla nueva, hoy los 9 viajes huérfanos están bloqueados para
  eliminar (21/09 y 23/09 cerrados). No se reabrió nada: es decisión de Operaciones.

## Causa de la saturación (investigada 24/09, parcial)

- Ocurre casi todos los días HÁBILES (15, 16, 17, 18, 21, 22, 23/09), y ninguno el sábado ni el
  domingo. Normalmente entre 03:00 y 08:00 CL, sin que nadie la vea; el 22 y el 23 se corrió a la tarde.
- Instancia muy chica: base de 239 MB, `shared_buffers` de 224 MB, `max_connections` 60 → Micro
  (CPU compartida con créditos). La transición es brusca: la recarga del esquema pasa de ~1 s a más
  de 10 s de golpe. Encaja con créditos de CPU agotados. **Sin confirmar**: el endpoint de métricas
  daba 504 y el MCP no tiene historial.
- Carga de fondo propia: ~5-6 mil sentencias dbt/día (incluye `dbt test` desde al menos el 14/09) y
  **~116 recargas por hora del caché de esquema de PostgREST, las 24 horas**, disparadas por el DDL
  de la ingesta. Cada una cuesta ~2 s de catálogo más una reconexión.

## Checklist — siguiente paso exacto

1. **Decisión de Operaciones sobre el 23/09**: reabrir el día → eliminar desde el Monitor 6 de las
   7 copias de IANSA (conservar `747ebcec…`, la primera) → volver a firmar. La herramienta ya existe
   y lo permite a admin/owner/creador. El 21/09 (`554a1c7a…`) cuenta en los cierres del 21 y del 22:
   misma decisión.
2. Click-through del usuario: crear un viaje manual con conductor, patente y empresa (ya no da 500);
   eliminar en lote.
3. **Infraestructura (el usuario)**: dashboard → Settings → Compute (confirmar Micro) y Reports →
   Database (CPU / Disk IO) del 22/09 19-23 CL. Si se confirma → subir la instancia (Small/Medium).
4. Después, con OK del usuario (toca Mage): cortar la tormenta de recargas de PostgREST (tablas
   temporales de la ingesta, o que PostgREST no mire `bronze`/`silver`). Medir antes cuál funciona.

### 2026-09-17/18 — Ronda 162: HU-28, asistencia y cierre por ORIGEN y por operación

Operaciones respondió las cuatro preguntas abiertas de la Ronda 161
(`monitor-app/bugs/20260916/levantamiento-user-story.md`) y con eso se diseñó y se implementó la
dimensión que al cierre le faltaba. **HU escrita en
`monitor-app/docs/user-stories/20260917/01-hu-asistencia-y-cierre-por-origen.md`** (es la fuente: el
mockup manda). Plan aprobado en `~/.claude/plans/jiggly-rolling-blum.md`.

## La objeción del usuario, y cómo se resolvió

El usuario frenó el diseño dos veces con la misma idea: *"nada de lo que viene desde la TMS es
editable"*. Cruzado el documento de Operaciones con el levantamiento, **ninguna de las 24 líneas pide
editar un dato que el TMS reportó**: todo es agrupar, filtrar y contar. Y las dos frases ambiguas se
desambiguan solas con las respuestas —"dejar abierto el filtro de CD Origen" significa que el filtro
liste **todos** los CD y no sólo Peñón/QL/LOA (respuesta 3), y "modificar el campo en los no
asignados" es fijar a qué operación se ofrece un camión **sin viaje**, del que el TMS no dice nada
(respuesta 1). Operaciones escribió el mismo criterio del usuario en su línea 21: *"se puede
modificar con la asignación de TMS"*.

Después pidió el estándar de la industria. Es **home terminal / domicile**: dato maestro declarado
del conductor (Samsara, Motive, McLeod LoadMaster, Trimble/TMW; en EE.UU. lo exige la FMCSA). De ahí
salieron las tres reglas que se adoptaron, y **una de ellas descartó mi propia propuesta anterior**
de derivar el CD del historial.

## Decisiones de arquitectura

1. **Un atributo maestro no se deriva de transacciones.** Calcular el CD desde "dónde cargó más
   veces" lo haría cambiar solo, y con él la asistencia de meses ya firmados.
2. **Asistencia y volumen son dos dimensiones distintas**: la asistencia agrupa por el **CD base
   declarado**; el volumen, por el **origen real del viaje**. Dos columnas, nunca un `COALESCE`.
3. **Un maestro de ubicaciones con roles, no una tabla por rol.** `is_origin_cd` es un **booleano**
   y no un `kind` de valor único porque **14 de los 24 orígenes observados YA existían como local de
   entrega**: un valor único obligaba a duplicar esas filas.
4. **La línea del cierre guarda su propia dimensión** (Kimball). El congelamiento sale gratis:
   `recalcular` ya es no-op con el día CLOSED.
5. **Descartado a propósito**: tabla de alias (el dato no está sucio), vigencia SCD2 del CD
   (`end_date` está en **0 de 402 filas** en las 4 tablas de asignación del repo — una quinta
   vigencia que nadie puebla es el frankenstein), y un maestro de "operación" por equipo
   (`carrier_shippers` ya existe y el filtro del cierre ya lo usa).
6. **Nomenclatura**: ninguna columna nueva se llama `operation_*` — el nombre ya está tomado dos
   veces (`assets.webcarga_operation_type_id` = Tractoreo/Equipo Completo; `locations.operation_type`
   = zona RM/Z0/Región).

## Lo medido contra producción, que corrigió dos supuestos del plan

- **Los nombres de CD NO vienen sucios.** 18 orígenes distintos en 47 días, escritos canónicos por el
  TMS; no existe ninguna fila "LOA" ni "QL" — eso es cómo habla Operaciones. La mitad del trabajo que
  el plan proponía (normalizar) no hacía falta.
- **Origen poblado en 1.571 de 1.572 viajes (99,94%)**, sólo en `app.trip_stops.local`.
  `trips.origin_tms`/`origin_city`/`origin_region` son columnas muertas (100% NULL).
- **El CD no es fijo y por eso se declara**: 35% de los conductores de Walmart cargan en más de un
  CD, pero el dominante concentra el **90,5%** de sus viajes.
- **Roster de Tractoreo: 41 conductores**; 35 tienen un CD dominante ≥80%, 3 entre 60-80%, 2 bajo 60%
  y 1 sin historial. Por eso la carga inicial es una **sugerencia de un clic**, no 41 campos vacíos.
- **Siembra del catálogo**: 12 CD (8 marcas sobre filas existentes + 4 nuevas de Walmart), **99,26%
  de los viajes cubiertos**, 0 ambigüedades. Los 12 pares que quedan fuera son tiendas con 1-2 viajes
  de logística inversa, no CD.

## Aplicado a producción (3 migraciones, todas ensayadas con ROLLBACK antes)

| Qué | Dónde |
|---|---|
| `locations.is_origin_cd` + índice parcial + 12 CD sembrados | `20260917020000`, aplicada |
| `drivers.home_location_id` + trigger `drivers_home_location_es_un_cd()` | `20260917030000`, aplicada |
| `closure_lines.home_location_id` + índice `(business_date, home_location_id)` | `20260917040000`, aplicada |

Estado verificado en producción: 12 CD en catálogo, columna e índice de la línea creados, trigger
activo, **0 conductores con CD base** — que es la carga de negocio, no un pendiente de desarrollo.

## Lo construido, por ola

- **Ola 1**: `GET /locations?origin_cd=true`; `is_origin_cd` en el alta y el PATCH.
- **Ola 2**: el CD base entra y sale por el detalle y el alta de conductor; **sugerencia que propone
  y nunca escribe** (umbral 80%, ventana 90 días), campo en `DriverDetailPanel` y en `AltaDeFlota`, y
  sección **Configuración › Operaciones › Centros de distribución**.
- **Ola 3**: la línea del cierre guarda el CD (el tracto lo hereda de su conductor habitual);
  `home_cd_id`/`home_cd_name` y `carrier_shipper_names` en los dos ejes y en el pivot de Reportería;
  columna **"CD"** al lado de "Local de origen"; **el desplegable de CD se alimenta del catálogo y no
  de las filas presentes** (única excepción al criterio de la tabla, comentada en el código); las
  filas sin carga muestran las operaciones habilitadas de su empresa en cursiva; **los tiles pasan a
  contar sobre las filas filtradas**; y el aviso de "nadie tiene CD base" con enlace al Directorio.

## Tres hallazgos que valen más que el código

1. **El `UNIQUE` que la migración de julio declara sobre `public.locations` no existe en
   producción**: lo que hay es un índice único *case-insensitive* con otro nombre
   (`locations_entity_name_site_number_ci_key`). Un `ON CONFLICT ON CONSTRAINT` habría reventado en
   el deploy. Lo atrapó el ensayo contra la base, no los tests.
2. **`routers/locations.py` no tenía NINGÚN test de integración**: sus tests mockeados pasaban con
   una columna inexistente en el `SELECT`. Ahora tiene 4.
3. **Inferí tres firmas en vez de abrirlas** (`shippersApi`, `useRowFeedback`, `useConfigList`) y las
   tres estaban mal; `useConfigList` además habría recargado en bucle con un arrow inline.

## Lo medido

Frontend **1.375 en verde**, `tsc` limpio, `npm run build` OK, trinquete visual **1.685** sin
moverse. **Backend 1.037 en verde, cero fallas** (venía de 1.017): **16 tests nuevos de integración**
en 3 archivos, todos contra Postgres real en transacción revertida. Frontend final: **1.379**.
Los trinquetes atajaron tres veces (1.687 de color, y tamaño bajo 11px); las tres se corrigieron con
tokens y ninguno subió.

**Mutaciones verificadas, 15 en total**: el trigger del CD (probado sacándolo dentro de una
transacción revertida), el borrado con cadena vacía, el campo en la lista `touched`, la sugerencia
que no se ofrece con dato puesto, el filtro alimentado por catálogo, el borrador que se resincroniza,
el error de catálogo que no dibuja un desplegable vacío, el upsert que guarda el CD, la herencia del
tracto, las operaciones habilitadas, los tiles que siguen al filtro, y las dos columnas que no se
funden. **Ojo con una**: sacar la primera guarda del congelamiento NO pone nada en rojo — hay dos, y
hay que sacar las dos para que el test lo note. Defensa en profundidad, no test flojo.

## Dos correcciones del usuario que cambiaron el modelo y el nombre

**1. No hay umbral: si el TMS lo reporta como origen, lo es.** *"si aparecen dentro de la
trazabilidad de origen es porque lo son"*. Mi siembra usaba un umbral de 5 viajes en 90 días —una
heurística mía que separaba "CD de verdad" de "ruido" sin tener con qué decidirlo— y dejaba 12
lugares afuera. El catálogo pasó de 12 a **24**. Y se retiró la exclusión del trigger
`app.reconcile_new_trip_stop_location()`, que sólo sembraba DESTINATION con este argumento: *"el
ORIGIN casi siempre es un CD del transportista, no un local de cliente"*. Era cierto cuando una fila
de `locations` sólo podía significar "local de entrega"; con el rol aparte deja de serlo, y sin el
trigger el catálogo se quedaba viejo en silencio.

**2. No todos los orígenes son CD.** *"no todos se llaman CD porque no lo son... pero sí son un
origen"*. Medido sobre los 24: **sólo 7 se llaman "CD"**. Los otros 17 son bodegas
(`Bod La Farfana 1`), operadores logísticos (`SITRANS`, `Saam Renca`), una devolución
(`Logistica Inversa`) y tiendas despachando (`Express Maipú`, `VIÑA DEL MAR`, `HIPER SANTA CRUZ`).
Estaba nombrando la categoría por su caso más frecuente, que es justo lo que este proyecto prohíbe.

`is_origin_cd` → **`is_origin`**; en pantalla, **"Origen habitual"**. El primer intento fue *"Origen
base"* y el usuario lo frenó — *"¿qué es eso? no se entiende"*—: era una traducción literal de *home
terminal*. El nombre bueno estaba **a una columna de distancia**: la tabla ya dice "Tracto habitual".
La lección: cuando hace falta un término nuevo, mirar primero el vocabulario que la propia pantalla
ya usa.

## Un test mío que cambiaba de color solo, y cómo se cerró

La suite completa falló 1 de 1.037 — y dos veces, en tests DISTINTOS del mismo archivo. No era flake
ni presión de conexiones: `_conductor()` de `test_cd_base_conductor_integracion.py` sorteaba un RUT
completo confiando en que `public.canonical_rut()` lo aceptara, pero esa función **valida el dígito
verificador**. Un número al azar sirve 1 de cada 11 veces; con 40 reintentos cada llamada fallaba el
~2%, y el archivo la llama 7 veces → **~14% de que la corrida se cayera**.

Sólo apareció corriendo la suite ENTERA: el archivo solo pasaba, y los tres archivos nuevos juntos
(16 tests) también.

Arreglado sin reimplementar la regla en Python —lo que el propio docstring del test prohibía—: se le
preguntan a la base los 11 dígitos posibles y se toma el que califica. Evidencia en dos formas: **5
corridas seguidas en verde** (con el helper viejo, ~53% de que al menos una fallara) y la propiedad
directa medida contra producción — sobre **500 cuerpos al azar, exactamente 1 dígito válido cada
uno**, sin excepción.

## Ola 4: DESPLEGADA (decisión del usuario, 18/09)

Retira las dos adivinanzas —`_LAST_KNOWN_ORIGIN_SQL` y su gemela por conductor en
`status_report.py`, y el LATERAL `last_origin` de `equipment_closures.py`— y hace que las
**Secciones 2, 4 y 7 agrupen por el origen habitual declarado**. La **Sección 3 (vueltas) se queda con el
origen real**: es volumen, no asistencia. La Sección 2 tiene que ir por el declarado para que cuadre
con la 7, donde "enrolados" incluye a quien no salió y ése no tiene origen.

**Sección 7 nueva — "Cargaron en otro origen"** (ola 4.1). Es la mitad del valor del estándar:
declarar el origen habitual no sirve para que todos calcen, sino para poder VER cuándo no calzan. Sale de datos que
ya están en la fila, sin una consulta más.

### El antes/después que la condicionaba

| 16/09 | |
|---|---|
| Conductores en el cierre | 41 |
| **Antes** (adivinanza) | 40 con CD |
| **Después** (declarado) | **0 con origen habitual** |

Se retuvo un día por eso. El usuario decidió desplegarla igual el 18/09: **"Sin origen" es la verdad
y se llena solo** a medida que Operaciones carga los 41, mientras que lo anterior dejaba en pantalla
un número que ya sabíamos mal.

Y de paso quedó medido el defecto que la ola retira: la adivinanza atribuía al 16/09 orígenes de
viajes **desde el 23/07** y hasta el **17/09** — o sea le ponía a un día el CD de un viaje
*posterior*. Eso es reescribir el pasado, literal.

**Impacto proyectado** si los CD se cargan con la sugerencia (dominante ≥80%): en los últimos 15
días, **4 desvíos de 354 viajes (1,1%)**, en 2 conductores. La Sección 7 va a ser corta y legible,
no ruido.

## Checklist — siguiente paso exacto

1. **TODO DESPLEGADO Y VERIFICADO.** Las cuatro olas están en `dev`, en cinco commits: `2f96a519`
   (backend), `bedc48b4` (frontend), `d0987812` (ola 4), `ada0a0b4` (fix del test) y `bc05dd33`
   (rename a origen). Deploys en verde, `/health` 200, `/locations?origin=true` responde 401 sin
   credenciales, el filtro muestra **los 24 orígenes** en la app, cero errores en consola y en los
   logs. **Árbol limpio.**
   - **La HU no está en git**: `monitor-app/docs/` está en `.gitignore` por diseño.
   - **Ojo con el orden**: renombrar `is_origin_cd` dejó `/locations` en 500 hasta desplegar el
     backend. Fue asumido y duró minutos, pero un rename de columna viva no tiene orden sin hueco.
2. **Lo único que falta es de negocio: cargar el origen habitual de los 41 conductores.** Para 35 es
   un botón que ya dice el origen concreto; 3 tienen dominante entre 60-80% (se muestra el reparto y
   elige la persona), 2 bajo 60% y 1 sin historial. Mientras tanto el Cierre y el Reporte dicen
   "Sin origen", que es correcto. **No es criterio de completitud de desarrollo.**
3. **Las cuatro preguntas para Operaciones están escritas** en
   `monitor-app/bugs/20260916/preguntas-abiertas-a-operaciones.md` (sí está en git, junto al
   documento original y al levantamiento). Las dos que pesan:
   - **La cara**: si *"dejar abierto el filtro de CD Origen para modificación"* quiso decir el
     **valor** y no el filtro, hay que **rediseñar**, no ajustar.
   - Qué hacer con los desvíos de la Sección 7. Proyectado con la sugerencia puesta: **4 sobre 354
     viajes (1,1%)** en 15 días, 2 conductores. ¿Información para mirar, o alerta?
4. **El cambio de conducta de los tiles** (ahora siguen al filtro) necesita su visto bueno.
5. **UAT del usuario**: el click-through lo hice yo sobre un conductor elegido por SQL y lo revertí al
   terminar. Falta el de Operaciones con datos que se queden.
6. Sigue de la Ronda 161: la UAT del cierre unificado, el congelamiento con tráfico real, la matriz de
   grupos de motivos, y la ola 4.4 (líneas TRIP) y ola 5 (retirar tablas viejas).
