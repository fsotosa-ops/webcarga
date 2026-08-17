# Cierre de Viajes y Reportería — diseño

**Fecha**: 2026-08-16 · **v2**, reescrito tras leer el modelo dbt real en Mage
**Origen**: reunión del 2026-08-14 (Pablo, Fabián, Felipe), con sus antecedentes del 2026-08-12
(Fabián/Felipe) y la minuta del 2026-08-03
**Reemplaza**: el alcance de `2026-07-21-cuadratura-reporteria-redesign-design.md`

> **Por qué hay una v2.** La v1 se escribió leyendo `app_trips.sql` de la raíz del repo, que está
> **183 líneas atrás** del modelo real (`dbt/tms/models/app/trips.sql` en Mage). Le faltaba el cambio
> del 2026-08-02 que hace que `is_active` exija recencia. Tres conclusiones de la v1 eran falsas.
> **Todo lo que sigue está verificado contra la base o contra el proyecto Mage sincronizado.**

---

## 1. El objetivo, en las palabras del usuario

La app está en desarrollo. El objetivo no es perseguir los incidentes históricos que aparezcan en
este análisis, sino que **desde que esté operativa muestre rápido este tipo de cosas cuando pasen**.
Eso ordena las prioridades: lo que hace visible un problema el mismo día vale más que lo que
reconstruye el pasado.

---

## 2. Las cuatro reglas de Pablo

Zanjan el debate que quedó abierto el 12/08 sobre crear un "estado WebCarga" espejo y editable.

1. **El TMS manda.** No se corrige ni se fuerza un estado. *"Si nos ponemos a corregir el TMS nos
   vamos a volver mono."* La columna espejo queda descartada.
2. **La única escritura de WebCarga es "no asignado por WebCarga"**, sobre las cargas que nos
   ofrecieron y no tomamos, con motivo. *"Este es el acusete de operaciones."*
3. **El reporte se arregla en el reporte, no en los estados.**
4. **El cierre es también el inicio del día.**

Y una quinta, que en la v1 quedó como frase de color y en realidad es un requisito:

5. **Un viaje que el TMS no cerró tiene que seguir a la vista.** *"Está bien que aparezca aquí y que
   se quede pegado, porque te da la visibilidad de que el viaje que hizo este gallo todavía no lo
   cierran… si no me cerraron el viaje no me lo van a pagar."*

---

## 3. La contradicción que hay que resolver primero

`app.trips.is_active` exige, desde el 2026-08-02, que el TMS haya reportado en los **últimos 7
días** — con **Sodimac exento** (macro `is_live_tracked_source`, var `live_tracked_sources:
['qanalytics','wingsuite']`). Se agregó para matar viajes que quedaban "en local" mil horas, y para
eso es correcta.

**Pero contradice la regla 5.** Un viaje que QAnalytics abandona sin cerrar sale solo del Monitor a
los 7 días — justo cuando empieza a importar, porque sin cierre en el TMS no llega la orden de
compra.

Medido: **21 viajes de Walmart en estado no terminal ya se apagaron así.**

| Estado en el TMS | Viajes | Días sin novedad (prom.) | Más viejo |
|---|---|---|---|
| Retornando | 7 | 31,6 | 02-jul |
| Asignado | 5 | 24,0 | 10-jul |
| Origen | 5 | 24,7 | 09-jul |
| En Ruta | 4 | 22,1 | 02-jul |

Y del lado opuesto, Sodimac: **exento de recencia, sus viajes no caducan nunca.** Los 14 del 24 de
julio siguen `is_active=true`. Esas son las dos caras de la pregunta que Pablo dejó abierta
(*"¿qué va a pasar con viajes que desaparecen en el TMS?"*): Sodimac **borra** el viaje del portal
sin cambiar el estado, QAnalytics **deja de reportarlo**. Hoy uno no se va nunca y el otro se va
sin permiso.

**Resolución.** No se toca la recencia — revertirla reintroduce el bug que vino a matar, y el
Monitor debe seguir mostrando sólo lo vivo. El Cierre gana un grupo propio, que **no se deriva de
`is_active`** sino de la condición directa: estado no terminal **y** sin novedad hace más de 7 días.
Es una consulta aparte, no un cuarto valor del mismo predicado.

---

## 4. Bloque 0 — La resolución de conductor y flota

### Lo que ya existe y no hay que inventar

`app.trip_fleet_links` **es** la tabla de resolución persistida, con `link_source` distinguiendo
`auto` de `manual`. Estado real:

| `link_source` | Filas | Con conductor | Creadas |
|---|---|---|---|
| `auto` | 453 | 394 | **todas el 2026-07-18** |
| `manual` | 9 | 9 | 07/07 – 14/08 |

Las 453 salieron de `bronze.raw_bd_ot` (Órdenes de Transporte del admin legacy) en la migración
`20260718060000`, que registra: 100% de cobertura en `rut_chofer`/`chofer`/`patente_camion`, 79% de
patentes y 97,6% de empresas matcheando. **Y prohíbe explícitamente repetirlo**: *"se usa acá
EXCLUSIVAMENTE como bootstrap histórico de una sola vez… No se crea ningún job/trigger que la
consulte de nuevo"*, porque esa plataforma se va a dar de baja.

### Por qué el match por nombre no es la respuesta

La misma migración documenta la causa raíz: **QAnalytics (86% del volumen) nunca reporta RUT;
Sodimac no reporta nada de conductor.** Es límite estructural del TMS.

Se probó igualmente un match por conjunto de tokens normalizado. Resultado: 207 → 352 de 497 viajes
resueltos, 0 regresiones, 0 ambigüedades. **Pero cuesta 51x**: la vista pasa de 73 ms a 3.734 ms
sobre 1.540 viajes, porque `@>`/`<@` no son hasheables y degradan el Hash Join a recorrer los 80
conductores por viaje. Además **no puede usar** los tres índices que el modelo ya crea sobre
`fleet->>'driver_name_tms'`, `'tractor_plate'` y `'driver_rut_tms'`, que están afinados para
igualdad exacta.

**Conclusión: el match por nombre queda como respaldo, no como vía principal, y sólo si vive en la
escritura.** En la lectura es inaceptable.

### Decisión pendiente, de negocio

**¿La plataforma admin legacy sigue operando?** Evidencia: su pipeline `legacy_drivers_transporters`
está vivo (tocado el 14/08) y la tabla creció de 105.695 a 107.325 filas, con modificaciones hasta
el 12/08 — pero sus **despachos se cortan el 31 de julio**, y el formato de fecha cambió a ISO (el
regex `DD-MM-YYYY` de la migración de julio ya no matchearía nada).

- **Si sigue viva**: la resolución se alimenta de ahí, de forma continua. Adivinar nombres teniendo
  el RUT al lado sería absurdo.
- **Si está en baja**: el nombre normalizado es el techo (71%), y el hueco lo llena operaciones
  asignando el conductor desde el Monitor — igual que el tipo de vehículo (§8).

### Lo que va igual, en cualquiera de los dos casos

- **`services/pre_cierre.py`** usa `planning_date = $1` exacto en 5 consultas mientras el resto usa
  el criterio multi-día. Un viaje multi-día no dispara correcciones ni escalaciones.
- **`services/driver_roster.py`** no filtra `drivers.operational_status`; `fleet_driver_gap.py:22`
  sí. El mismo conductor de baja cuenta distinto en dos secciones del mismo reporte.
- **Los tres rosters buscan el vocabulario por etiqueta visible** (`wot.label = 'Tractoreo'`) en
  `driver_roster.py`, `equipment_closures.py:57` y `status_report.py`. Renombrar "Tractoreo" desde
  Configuración **vacía el roster en silencio**. Es el defecto que la Ronda 118 ya corrigió en
  `carrier_management_types()`, y por el que existe `status_taxonomies.code` (`TRACTOREO`,
  `EQUIPO_COMPLETO`, ya poblados).
- **`daily_closures.py` no excluye Sodimac**; `equipment_closures.py:69` y `status_report.py:107`
  sí. El mismo día da conteos distintos según la pantalla.

---

## 5. Bloque 1 — El cierre como recorrido de 4 pasos

Pablo: *"como cuando generás una encuesta — primero equipos completos, check; después dedicados;
después viajes"*. La minuta del 03/08 ya había fijado el mismo orden.

| # | Paso | Bloquea | Fuente existente |
|---|---|---|---|
| 1 | **Equipos Completos** — se confirma, no se justifica | No | `equipment_closures.py`, `requires_motivo=false` |
| 2 | **Tractoreo** — el conductor que no salió dice por qué | Sí | `daily_closures.py` + `TRACTOREO_ROSTER_CTE` |
| 3 | **Viajes** — ver §6 | Sí, parcialmente | Bloque 2 |
| 4 | **Dotación** — empresas con la flota descuadrada | No | `services/fleet_driver_gap.py` |

Verificado contra el 14/08: los **36 equipos completos** y los **44 conductores** coinciden exactos
con las cifras que Pablo dio de memoria. En Dotación hay **0 empresas con tracto y cero conductor**
—el caso que él nombró no existe— pero sí **6 descuadradas** sobre 79 tractos y 79 conductores.

**Interacción**: un paso a la vez, barra de progreso con contador por paso, paso resuelto colapsado
con check, resolución en lote con barra contextual (`setReasonBatch` ya existe), filtros por **zona
y gestión** dentro del paso 2 (§7).

**Los cuatro estados**: vacío ("Tomamos todas las cargas del día", con botón de continuar) · a
medias (§6.4) · sin permiso (el motivo ya puesto se lee como texto plano, **no** como campo
deshabilitado) · falló ("se guardaron 9 de 14", **conserva la selección**, reintenta los 5 — aplica
igual a "Cerrar el día", que encadena dos endpoints y hoy puede dejar el día medio cerrado sin
avisar).

---

## 6. Bloque 2 — El paso "Viajes"

### 6.1 Los cuatro grupos

El predicado de "sin asignar" **ya existe y está poblado** — `app_trips.sql` deriva
`is_assigned = trip_status NOT IN ('Creada','Aceptada','Control de salida') AND (patente O conductor)`,
que es literalmente la definición de Pablo. Los grupos salen de columnas existentes salvo el cuarto:

| Grupo | Predicado | Hoy | Bloquea |
|---|---|---|---|
| **Hoy** | `is_active AND NOT is_assigned AND planning_date = hoy` | 3 | Sí |
| **Rezago** | `is_active AND NOT is_assigned AND planning_date < hoy` | 14 | Sí |
| **En curso** | `is_active AND is_assigned AND planning_date < hoy` | 10 | No |
| **Abandonados por el TMS** | estado **no terminal** `AND now() - status_reported_at > 7 días` | 21 | No |

El cuarto es nuevo en la v2 y es el que materializa la regla 5. **No se deriva de `is_active`** —
`is_active` ya los descartó, ese es el problema.

Nota: el **Rezago** es casi todo Sodimac por su exención de recencia; los **Abandonados** son casi
todo QAnalytics. No es casualidad: son las dos caras de §3.

Y un caso que los datos destaparon: los viajes con `planning_date > hoy` (3 de IANSA, con patente y
conductor) no son rezago ni esperan nada. No entran al paso 3.

### 6.2 La columna correcta es "sin novedad del TMS"

La v1 mostraba días desde la planificación. Es la métrica equivocada: un viaje planificado hace 9
días puede haber reportado hace 2 horas. Medido sobre los 10 en curso, el peor lleva **6,4 días sin
novedad**, no 9 — y a los 7 desaparece.

### 6.3 Cómo se cierra un viaje

`PATCH /api/v1/trips/bulk-close` (`routers/trips.py:1940-1974`) ya hace lo correcto:
`is_active=false, is_working=false` + los campos a `manually_edited_fields`, que el trigger
`app.protect_manual_overrides` respeta. **Falta el motivo**: se extiende para exigir
`unassigned_reason_id`, columna que ya existe, tiene 0 filas y **ya está en
`merge_exclude_columns`** del modelo dbt. La traza va a `public.audit_log`.

**El `trip_status` del TMS no se toca nunca.** El viaje conserva su `ASIGNADO` y en el historial se
lee "No asignado por WebCarga · &lt;motivo&gt;" **al lado, no encima**. Pablo: *"yo después filtraré
en el historial todos los no asignados por WebCarga y voy a poder ver todos los viajes que alguna
vez nos ofrecieron y no asignamos"* — ese filtro es parte del entregable.

### 6.4 El día cerrado que recibe viajes después

Fabián: los cambios de base *"no necesariamente los crean el catorce, los crean el dieciséis, pero
con fechas del catorce… en el cierre del catorce no te lo va a tomar"*.

Hoy `POST /daily-closures/close` es un upsert, así que re-cerrar se puede — pero **nadie avisa** que
un día ya firmado recibió viajes nuevos. La cuadratura con facturación se rompe en silencio.

**Regla**: el cierre guarda el conteo de viajes del día al firmar. Si en una lectura posterior el
conteo real difiere, el día se marca **"Reabierto — llegaron N viajes después del cierre"**, con
acceso directo a resolverlos. No se re-cierra solo.

### 6.5 Motivos de viaje

`DRIVER_REASON` tiene 16 motivos que responden otra pregunta (Médico, Vacaciones, No se presentó).
Ninguno de los que nombraron Pablo y Fabián existe: *no tenemos camión*, *no tenemos proveedor*,
*no da por tarifa*, *el mandante lo declinó*.

Dominio nuevo `TRIP_UNASSIGNED_REASON` en `app.status_taxonomies`, gestionable desde **Configuración
› Operaciones** por la misma vía que "Motivos de conductor" — el router genérico y `TaxonomyTab` ya
soportan cualquier dominio. Es una semilla y una pestaña, no código nuevo.

---

## 7. Bloque 3 — Reportería

### 7.1 La duplicación de equipos

La regla multi-día hace que un viaje abierto de días anteriores cuente como carga de hoy además del
viaje nuevo. Medido: el reporte del viernes 14 muestra **51 líneas para 36 tractos reales (+42%)**.
Es el caso que Pablo reprodujo con Riquelme, y sigue pasando: `LRTD13` está abierto en Colún (RUTA)
y en Walmart (RETORNANDO) al mismo tiempo.

**Regla**: un conductor o equipo cuenta **una vez por día**, por su viaje de mayor
`status_reported_at`. El arrastrado va a una columna **Arrastre**. Aplicado al 14/08: **36 = 32
asignados + 4 arrastre**, y los 32 caen justo en el *"entre veintiocho y treinta y tres"* de Pablo.
Ningún estado se toca — es la regla 3.

### 7.2 El mapeo de pago, que la v1 dejó como nota al margen

Fabián lo dio completo y es el corazón del reporte a facturación:

| Estado del TMS | Facturación |
|---|---|
| `CERRADO FINALIZADO` | Se paga siempre |
| `CERRADO INCOMPLETO` | **Se paga igual** — pagan los locales visitados |
| `CERRADO MANUAL` | Caso a caso; los retornos de activo no (el número SAP no calza) |
| `CANCELADO`, eliminados | Fuera |

Se modela como un atributo del catálogo `app.trip_statuses` —que ya es una tabla de configuración—
y no como una lista en código. Así el reporte separa "facturable" de "no facturable" sin que nadie
tenga que recordar la regla, y cambiarla es editar una fila.

> **Insumo pendiente, y es dependencia declarada del pipeline**: el modelo dbt real dice que los
> estados crudos de Sodimac *"siguen sin mapear a app.trip_statuses… tratados con default
> conservador hasta que Fabián confirme el mapeo exacto (insumo pendiente, ver HU Cierre del Día
> §8)"*. Es el mismo Excel de estados de la reunión del 12/08.

### 7.3 Filtro por tipo de operación

Pablo lo pidió en pantalla y hoy no existe. `WEBCARGA_OPERATION_TYPE` ya distingue Tractoreo de
Equipo Completo; falta exponerlo como filtro y como campo del pivot (`lib/utils/pivot.ts:9`).

### 7.4 Motivos hardcodeados en dos lugares

`status_report.py:370-374` (Python) y `StatusReportSection.tsx:89-93` (TS) tienen la lista escrita a
mano. Un motivo nuevo del catálogo no aparece como columna — o sea los del §6.5 serían invisibles.
Ambos pasan a leer `app.status_taxonomies`.

### 7.5 Navegación

Ni el Centro de Cierre ni la Reportería tienen link en el Sidebar (`Sidebar.tsx:18-23`).

---

## 8. Bloque 4 — Conductor, zona, gestión y tipo de vehículo

| Dimensión | Cobertura medida | Estado |
|---|---|---|
| **Conductor** | ya viaja en el payload, sin exponerse como campo | Sólo falta ofrecerlo |
| **Gestión** | 73 Equipo Completo · 43 Tractoreo · 2 sin clasificar | `_ROSTER_SQL` ya lo trae |
| **Zona** | RM 345 · Z0 231 · R. Sur 126 · R. Norte 34 · 53 sin dato | Agregar a `_REPORT_SQL` |
| **Tipo de vehículo** | no existe | Se captura (§8.2) |

### 8.1 La regla de zona, destrabada

El spec de julio dejó zona afuera porque nadie decidió qué hacer con los viajes multi-zona. Medido
sobre 546 viajes: **535 tocan una sola, 11 tocan dos, ninguno tres.** El caso conflictivo es el 2%.

**Regla**: el viaje toma su zona si todos los destinos coinciden; si no, **"Mixto"**. Categoría
explícita, no un promedio ni el primer destino.

Cruce real del 14/08, que cuadra con sus 47 viajes: RM 35 · Z0 10 · R. Sur 1 · Sin clasificar 1.

**Y entra al paso 2 del cierre**, no sólo al reporte: la zona **cambia el motivo**. Un conductor que
quedó en Región Sur no se compara con uno en la RM. Filtrando por Z0 se resuelven esos 10 de una.

### 8.2 Tipo de vehículo — se marca en el Monitor, el cierre sólo calcula

Por el **tracto** la dimensión es una constante (el cierre sólo mira tractos: 497 de 508 dirían
"Tractocamión"). Por la **rampla** el dato no está: de 546 viajes, 522 traen patente de rampla y
sólo **34 matchean**; hay **37 ramplas dadas de alta contra 331 patentes distintas circulando**, y
**200 hicieron un solo viaje**. Es flota transitoria, no catálogo incompleto — y darlas de alta
dispararía requisitos de Certificación para 331 vehículos de terceros. `cargo_type` tampoco sirve:
SECO son 461 de 546 y admite Sider, Furgón Seco, Plano o Botellero.

**Lo captura una persona, a nivel de viaje, en el Monitor, en lote.** Y agrupa: por patente no
(cada rampla hace un viaje al día), pero por **cliente + carga** un día entero cae en **3 a 6
combinaciones** — un viernes de 47 viajes se marca en seis acciones.

- Columna nueva referenciando `FLEET_SERVICE_TYPE`, protegida por `manually_edited_fields`.
- En el Monitor: chip **"Sin tipo (N)"** + barra contextual, el patrón que la app ya usa.
- En el cierre: **sin quinto paso**. El paso 1 muestra el corte por tipo, la **cobertura real** al
  lado ("14 de 29 · 48%") y un atajo al Monitor con el filtro puesto. Si nadie marcó, la barra dice
  0% y el corte no aparece.

> **A medir con un mes cargado**: si el conductor determina el tipo. Hoy usa 7,5 ramplas distintas
> en 16 días (máximo 19), pero eso no dice si son del mismo tipo.

---

## 8bis. La interfaz — decidida mirándola

Seis pantallas de mockup revisadas en sesión. Lo que quedó:

### Dónde vive

**Item propio en el Sidebar**: Operaciones › Monitor · **Cierre del Día**, con contador. Hoy no
existe — `Sidebar.tsx:18-23` sólo tiene Monitor, y su comentario ya lo anticipaba: *"`/dashboard/
operations/closures` pasará a ser el Centro de Cierre del Día (tarea futura), que todavía no tiene
link de nav propio"*.

**Atajo desde el Monitor**: el botón no dice sólo su nombre, dice **cuánto falta** — un `29` grande
y "15 conductores y 14 cargas esperan tu respuesta". Un botón que dice "Cerrar el día" a secas no da
ninguna razón para apretarlo. Los dos contadores son el mismo número y bajan a cero al terminar.

### La escena

- **El título de cada paso es la pregunta**, no el nombre del módulo: *"¿Por qué no salieron estos
  15?"*, no "Tractoreo". El subtítulo dice **por qué se pregunta** — *"son conductores dedicados,
  trabajan sólo para WebCarga, así que todos los días deberían tener viaje"* — que es lo que nadie
  sabe la primera vez. Con eso la pantalla no necesita tour ni globitos.
- **"Se guarda solo"** visible arriba a la derecha.
- **Riel de progreso** con los 4 pasos y su contador, **clickeable**: el orden es una sugerencia
  buena, no una reja.
- **Momento entre pasos**: confirmación breve ("Tractoreo listo · 15 con motivo · quedan 2 pasos"),
  saltable con Enter. En una tarea repetitiva y sin recompensa, ver el avance es lo que hace que se
  termine.
- **Teclado completo**: `↓↑` mover · `espacio` elegir · `A` todas · `M` abrir motivos · `1..9`
  aplicar motivo · `Enter` confirmar y avanzar · `Esc` volver. Un coordinador hace esto todos los
  días a las siete; si el teclado no alcanza, del mes en adelante deja de cerrar.

**Lo que NO se hace**: pantalla completa que tape el menú (encerrar al usuario le quita la salida),
animaciones más allá de la confirmación (a la tercera vez son espera), forzar el orden, ni tutorial.

### La fila: lo justo para decidir, el resto abajo

La fila cerrada muestra **sólo lo que cambia la respuesta**; el detalle se abre hacia abajo, en el
mismo lugar — sin panel lateral ni pantalla nueva, el patrón que Certificación ya adoptó.

| Paso | En la fila | Al abrir |
|---|---|---|
| **Tractoreo** | conductor · empresa · tracto · **zona** · gestión · motivo | teléfono, RUT, rampla, último viaje, dónde quedó, alertas de documentación, y las acciones (llamar, ver ficha) |
| **Viajes** | fecha · días · cliente · ID · motivo | estado TMS, origen, destino, **zona**, y flota **vacía a propósito** — ese vacío *es* el criterio |

Lo de arriba sirve para **decidir**; lo de abajo para **actuar**. La zona no es decoración: un
conductor que quedó en Región Sur no se compara con uno en la RM, y filtrar por Z0 permite resolver
esos 10 de una sola vez.

### Dependencia dura

**Estas pantallas se construyen sobre los tokens y componentes del spec de sistema visual**
(`2026-08-16-sistema-visual-design.md`). Construirlas antes obliga a rehacerlas: la auditoría midió
8 tamaños de letra y 13 colores de texto por pantalla, sin ningún componente compartido de
encabezado, cifra, fila o estado vacío.

---

## 9. Cómo se implementa sin pasar a llevar el pipeline

Verificado contra el proyecto Mage sincronizado. **Esto es vinculante para los planes.**

- **`app.trips` la escribe dbt** (`app_trips_update` → `dbt/tms/models/app/trips.sql`), incremental
  con `merge` y **`on_schema_change='sync_all_columns'`**. Una columna agregada por migración de
  Supabase y ausente del modelo **se elimina en la corrida siguiente**.
- **Toda columna nueva nace en el modelo dbt** —declarada como `NULL::tipo`— y entra a
  `merge_exclude_columns`. Es el patrón ya usado por `unassigned_reason_id`, `fleet_link_id` y
  `stop_manual_fields`.
- **Los triggers van por `post_hook`**, idempotentes. Es como el proyecto evita que un
  `--full-refresh` se lleve PK, RLS, índices y `protect_manual_overrides` — se los llevó **seis
  veces entre mayo y julio** antes de esa corrección.
- **`dbt-postgres` no puede agregar columnas `ARRAY` a modelos incrementales** (deuda registrada):
  nada de `text[]` nuevo en `app.trips`.
- **El `app_trips.sql` de la raíz del repo está obsoleto.** No usarlo como referencia.

---

## 10. Fuera de alcance

- **Perseguir los 21 viajes abandonados históricos.** Decisión del usuario: la app está en
  desarrollo; el objetivo es que **cuando esté operativa los muestre el mismo día**, no reconstruir
  el pasado.
- **Export Excel en formato de facturación** — falta la planilla de Fabián.
- **Conectar el tendering de Sodimac/Walmart por API** — Sodimac no da acceso.
- **Los 15 conductores del TMS que no están en la app** — carga de negocio.
- **`CURRENT_DATE` en UTC** en Certificación y fichas (vencimientos): un documento que vence hoy
  figura vencido desde las 20:00 de Chile. Real pero chico, y de otro módulo. **El cierre no tiene
  ese problema**: recibe la fecha de negocio como parámetro y el frontend la calcula en
  `America/Santiago` (verificado en las 4 copias de `todayISO()`).

---

## 11. Decisiones pendientes

1. **¿La plataforma admin legacy sigue operando?** Decide de qué se alimenta la resolución del
   conductor (§4). Es la más importante.
2. **Mapeo de estados de Sodimac** (Excel de Fabián) — dependencia declarada del pipeline, no sólo
   del cierre.
3. **Registro de corridas de extracción** — `trips.pipeline_updated_at` marca cuándo un viaje
   *cambió*, así que no distingue "no corrió" de "corrió y no había nada". Sin esa fuente no se
   puede bloquear el cierre por extracción vencida con confianza.
4. **`TRIP_UNASSIGNED_REASON`**: dominio nuevo vs reuso de `DRIVER_REASON`.
5. **Umbral de "abandonado por el TMS"**: 7 días empata con la recencia, pero conviene confirmarlo
   con operaciones.
