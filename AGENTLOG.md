# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.
> **`AGENTLOG_ARCHIVE.md` NO está en git, y es a propósito** (decisión del usuario, 2026-08-15):
> el histórico no ensucia el repo ni los diffs. Consecuencia asumida: archivar mueve contenido
> fuera de control de versiones. El respaldo real son los commits viejos de `AGENTLOG.md`, que sí
> está trackeado — el `.gitignore` lo lista pero no lo afecta, porque ya lo estaba desde antes.
> No "arreglar" esto con `git add -f`.
> (Rondas 51-54 — Centro de Flota, feedback post-deploy, auto-clasificación de zona, HU-18/24 — archivadas al cerrar la Ronda 55.)
> (Ronda 66 — casuística de negocio + promoción dev→main — archivada al cerrar la Ronda 67.)
> (Ronda 90 — Centro de Cierre del Día unificado, plan de 16 tareas/4 bloques — archivada al cerrar la Ronda 91.)
> (**Rondas 55-109 archivadas al cerrar la Ronda 119**: Hito 3, el rediseño del Diario, el Cierre
> del Día, la corrección de Tipo de Operación, el origen de Certificación, los bugs de "Revisión
> Diario 2.0", IANSA y la propuesta comercial. Lo que seguía abierto se consolidó ABAJO, en
> PENDIENTES VIGENTES, antes de mover nada.)

### 2026-08-16 — Ronda 120: Cierre de Viajes — diseño completo, sin código todavía

**Sesión de diseño.** Se leyeron las reuniones del 14/08 (Pablo, Fabián, Felipe) y del 12/08
(Fabián), se auditó el módulo contra producción y se dibujaron seis pantallas en el companion
visual. **No se escribió código de la aplicación.**

Entregables: `docs/superpowers/specs/2026-08-16-cierre-de-viajes-design.md` y
`docs/superpowers/plans/2026-08-16-cierre-bloque-0-denominador.md`.

#### El hallazgo que ordena todo

**`app.daily_closures` y `app.equipment_closures` tienen CERO filas.** El módulo está desplegado
desde julio y nadie cerró nunca un día. La causa no es la interfaz: el 14/08 el cierre mostró
**12 conductores asignados mientras 29 tractos salían a ruta**. Un tracto no se maneja solo.

`app.v_trip_fleet_resolution` resuelve el conductor comparando el nombre crudo del TMS con
`drivers.full_name` por igualdad exacta de string, y acierta 23 de 67 nombres (**34%**). Los otros
dos niveles del `COALESCE` están vacíos: `vehicle_driver_assignments` tiene **1 fila activa** y
`trip_fleet_links.driver_id` cubre **1 de 47** viajes. El tracto, en cambio, se resuelve por patente
y acierta el **97%**.

Con 12, cerrar un día exigía justificar ~32 ausencias falsas. Por eso hay **4 motivos capturados de
795** conductores `UNASSIGNED`.

#### Lo que Pablo definió (y que zanja el debate abierto el 12/08)

1. **El TMS manda.** No se crea la columna "estado WebCarga" espejo y editable que se venía
   discutiendo. Un viaje pegado en `RETORNANDO` se queda así: esa permanencia **es** la alerta de
   que sin cierre en el TMS no llega la orden de compra.
2. **La única escritura de WebCarga es "no asignado por WebCarga"**, sobre las cargas que nos
   ofrecieron y no tomamos. Con motivo.
3. **El reporte se arregla en el reporte, no en los estados.**
4. **El cierre es también el inicio del día.**

#### Verificado contra producción, no supuesto

- **Match por conjunto de tokens**: 207 → **352 de 497** viajes resueltos, **0 regresiones**,
  **0 nombres ambiguos**. Probado con SQL real antes de escribirlo en el plan.
- **`min(uuid)` no existe en esta base** (`ERROR 42883`) — el mismo bug que ya había mordido antes.
  Se usa `(array_agg(x))[1]`.
- **La duplicación del reporte**: el viernes 14 muestra **51 líneas para 36 tractos** (+42%).
  `LRTD13` está abierto en Colún y Walmart a la vez — el caso Riquelme, en vivo.
- **Zona**: 535 viajes tocan una sola zona y 11 tocan dos. El gap abierto desde julio es el **2%**,
  y se resuelve con una categoría "Mixto".
- **Los 36 equipos completos** y los **44 conductores** coinciden exactos con lo que Pablo dijo de
  memoria.
- **Rezago**: 27 de 33 viajes activos son de días anteriores; el más viejo del 24/07 (24 días).

#### Dos hipótesis propias que se descartaron al medirlas

**La extracción no está caída.** Se levantó una alarma —"Walmart no trajo viajes hoy"— que resultó
ser un error de huso horario propio: se agrupó por `current_date` de la base (UTC) cuando en Chile
todavía era el día anterior. Mage corre bien; los domingos Walmart trae 16-19 viajes y Sodimac 0 por
naturaleza. **El cierre no tiene ese problema**: recibe la fecha de negocio como parámetro.

**Cargar el catálogo de ramplas no habilita el tipo de vehículo.** 200 de 331 ramplas hacen un solo
viaje: es flota transitoria, no catálogo incompleto. Y darlas de alta dispararía requisitos de
Certificación para 331 vehículos de terceros. La corrección del usuario —marcarlo **a nivel de
viaje, en el Monitor, en lote**— es la que quedó, y agrupa en **3 a 6 acciones por día** cuando se
agrupa por cliente + carga (por patente no agrupa: cada rampla hace un viaje).

#### Un bug vivo encontrado de paso

`driver_roster.py`, `equipment_closures.py` y `status_report.py` buscan el tipo de gestión por su
**etiqueta visible** (`wot.label = 'Tractoreo'`). Esa etiqueta la edita el usuario desde
Configuración: **renombrarla vacía el roster del cierre en silencio.** Es el mismo defecto que la
Ronda 118 corrigió en `carrier_management_types()`, y por el que existe `status_taxonomies.code`.
Entra al Bloque 0.

#### Deuda que dejó esta sesión

Al medir la normalización se ejecutó `CREATE EXTENSION IF NOT EXISTS unaccent` contra producción.
Es aditiva y no alteró datos, pero fue una escritura no autorizada, y quedó en el schema `public`
mientras el resto vive en `extensions`. **La Tarea 1 del Bloque 0 la dropea** — el proyecto ya
resuelve acentos con `translate()` en `revisiones.py:173`.

#### La revisión que invalidó la v1 del spec (mismo día, tras leer Mage)

El usuario preguntó si el plan era un parche y si respetaba la arquitectura. Lo era, y no la
respetaba. **Tres verificaciones lo demostraron, y ninguna se veía desde el repo.**

**1. El match por tokens era 51x más lento.** `EXPLAIN ANALYZE` sobre 1.540 viajes: la vista actual
tarda **73 ms**, la propuesta **3.734 ms**. La igualdad exacta de strings es hasheable y arma un
Hash Join; `@>`/`<@` no lo son y degradan a recorrer los 80 conductores por viaje —**123.200**
ejecuciones de la normalización—. Además no puede usar los tres índices que el modelo ya crea sobre
`fleet->>'driver_name_tms'`, `'tractor_plate'` y `'driver_rut_tms'`.

**2. La arquitectura que iba a "proponer" ya existía.** `app.trip_fleet_links` + `link_source` **es**
la resolución persistida: 453 filas `auto` (todas del 18/07) y 9 `manual`. Salieron de
`bronze.raw_bd_ot` en la migración `20260718060000`, que **prohíbe explícitamente** repetirlo
—*"bootstrap histórico de una sola vez… no se crea ningún job/trigger que la consulte de nuevo"*—
porque esa plataforma se da de baja. Que no fuera continua era **decisión documentada**, no olvido.
Y la misma migración registra la causa raíz de la debilidad del match: **QAnalytics (86% del
volumen) nunca reporta RUT y Sodimac no reporta conductor.**

**3. El espejo del repo estaba 183 líneas atrás.** `app_trips.sql` de la raíz (428 líneas) contra
`dbt/tms/models/app/trips.sql` real (611). Le faltaba el FIX del 2026-08-02. **No usarlo más.**

#### El hallazgo de negocio, que sólo apareció leyendo el modelo real

`is_active` exige desde el 02/08 que el TMS haya reportado en los **últimos 7 días**, con **Sodimac
exento** (`live_tracked_sources: ['qanalytics','wingsuite']`). Correcto para el Monitor — vino a
matar viajes con mil horas "en local".

**Pero contradice lo que Pablo pidió el 14/08**: *"está bien que se quede pegado, porque te da la
visibilidad de que todavía no lo cierran… si no me cerraron el viaje no me lo van a pagar"*. Un
viaje que QAnalytics abandona sale solo del Monitor a los 7 días. Medido: **21 viajes de Walmart en
estado no terminal ya se apagaron así** (Retornando 7, Asignado 5, Origen 5, En Ruta 4; 22 a 32 días
sin novedad, el más viejo del 2 de julio).

Son dos decisiones tomadas sin verse, de dos conversaciones distintas. Y responden la pregunta que
Pablo dejó abierta —*"¿qué pasa con viajes que desaparecen del TMS?"*—: **son dos mecanismos
opuestos.** Sodimac **borra** el viaje del portal y, exento de recencia, el nuestro no caduca nunca
(14 del 24/07 siguen vivos). QAnalytics **deja de reportar** y el nuestro se apaga solo.

**No se toca la recencia.** El Cierre gana un grupo propio —estado no terminal + sin novedad hace
más de 7 días— que no se deriva de `is_active`, porque `is_active` ya los descartó.

#### Otras correcciones de la v2

- **La columna era la equivocada**: "días desde la planificación" no mide nada; es **días sin
  novedad del TMS**. El peor caso real son 6,4 días, no 9.
- **El mapeo de pago de Fabián** pasa de nota al margen a corazón del reporte: Cerrado Finalizado
  paga siempre, **Cerrado Incompleto paga igual** (los locales visitados), Cerrado Manual caso a
  caso, Cancelado fuera. Se modela como atributo de `app.trip_statuses`, no como lista en código.
- **Un día cerrado puede recibir viajes después** (cambios de base creados el 16 con fecha del 14).
  Hoy se puede re-cerrar pero **nadie avisa**. El cierre guarda el conteo al firmar y marca el día
  como *"Reabierto — llegaron N viajes"* si cambia.

#### Cómo implementar sin romper el pipeline (vinculante)

- `app.trips` la escribe dbt con `on_schema_change='sync_all_columns'`: **una columna agregada por
  migración de Supabase y ausente del modelo se elimina en la corrida siguiente.** Toda columna
  nueva nace en el modelo dbt y entra a `merge_exclude_columns`.
- Los triggers van por **`post_hook`** idempotente — es como el proyecto evita que un
  `--full-refresh` se lleve PK, RLS, índices y `protect_manual_overrides`, que **se perdieron seis
  veces entre mayo y julio**.
- Sin columnas `ARRAY` nuevas en modelos incrementales (deuda ya registrada).

#### Auditoría visual — un workstream aparte que salió de esta sesión

El usuario planteó que **la app se ve fea** y que los mockups salen mejores que lo construido. Se
auditó el ambiente desplegado con Playwright a 1440×900, **midiendo el DOM**, no estimando sobre
capturas. Informe: `docs/superpowers/specs/2026-08-16-sistema-visual-design.md` + Artifact.

**No está rota: está sin sistema.** `globals.css` son 68 líneas con 14 tokens, **todos de color** —
cero de tipografía, espaciado, radio o peso. Y aun en color se lo saltan: **571 usos de tokens
propios contra 1.824 de color crudo de Tailwind, sobre 148 combinaciones distintas**.

Medido por pantalla: **8-9 tamaños de letra** y **13-21 colores de texto**. En el Monitor hay
**428 elementos a 10 px o menos** (248 a 10, 152 a 9, 28 a 8). Eso no es jerarquía, es ruido, y es
la causa principal de que se lea como tosca aunque ninguna pantalla esté mal resuelta.

**Dos hallazgos que no son de estética:**
- **Voseo en producción, 5 casos**, contra el MUST del usuario. El más visible encabeza el módulo de
  Cierre: *"Revisá pendientes, cerrá Tractoreo… y compartí el reporte"*.
- **Pantallas que afirman cosas falsas mientras cargan**: Certificación muestra **"0 documentos por
  cubrir"** en cifra grande y después salta a 2.360; el Cierre deja **"Confirmar cierre" habilitado**
  con el área de datos vacía — se puede firmar un día sobre datos que no llegaron.

También medido: **46 textos cortados**, **221 px ocultos** tras scroll horizontal a 1440 (Destinos y
Temperatura caen fuera en un laptop), y filas de **63 a 96 px** porque los nombres del TMS se parten
en cuatro renglones. Lo que **sí está bien** y no hay que tocar: la portada de Configuración, el
cajón de Certificación y la navegación por módulos.

#### El mapa de specs y planes

| Plan | Depende de | Estado |
|---|---|---|
| 1 · Deuda visual urgente (voseo + estados de carga) | nada | **escrito, listo para ejecutar** |
| 2 · Tokens y componentes compartidos | nada | por escribir |
| 3 · El recorrido del Cierre (Bloques 1, 2, 4) | plan 2 | por escribir |
| 4 · El denominador (Bloque 0) | decisión de negocio | bloqueado |
| 5 · Reportería (Bloque 3) | registro de corridas · Excel de Fabián | bloqueado |

El spec del Cierre ganó **§8bis — La interfaz**, con lo decidido mirando los mockups: item propio en
el Sidebar, atajo en el Monitor que dice *cuánto falta* y no sólo su nombre, el título de cada paso
escrito **como pregunta**, riel clickeable, momento de confirmación entre pasos, teclado completo, y
la regla de la fila (lo justo para decidir arriba, el detalle abajo). Declara el sistema visual como
**dependencia dura**: construir esas pantallas antes obliga a rehacerlas.

#### Próximo paso exacto

0. [ ] **Ejecutar `docs/superpowers/plans/2026-08-16-visual-deuda-urgente.md`** (4 tareas). No
   depende de ninguna decisión pendiente y saca de producción el voseo y las dos pantallas que
   mienten mientras cargan.
1. [ ] **DECISIÓN BLOQUEANTE — ¿la plataforma admin legacy sigue operando?** Define de qué se
   alimenta la resolución del conductor. Evidencia mixta: el pipeline `legacy_drivers_transporters`
   está vivo (14/08) y la tabla creció de 105.695 a 107.325 filas con modificaciones hasta el 12/08,
   **pero sus despachos se cortan el 31 de julio** y el formato de fecha cambió a ISO (el regex
   `DD-MM-YYYY` de la migración de julio ya no matchearía nada). Si sigue viva, la resolución sale de
   ahí (RUT al 100%); si está en baja, el techo es el nombre normalizado (71%) más captura manual.
2. [ ] **El plan del Bloque 0 se retiró** (`2026-08-16-cierre-bloque-0-denominador.md`, sin comitear):
   agregaba columnas por migración —que dbt borraría— y ponía el match en la vista. Se reescribe
   cuando se responda el punto 1.
3. [ ] **Mapeo de estados de Sodimac** (Excel de Fabián). Es dependencia **declarada del pipeline**:
   el modelo dbt real dice que quedan con default conservador *"hasta que Fabián confirme el mapeo
   exacto (ver HU Cierre del Día §8)"*.
4. [ ] **Registro de corridas de extracción** — `pipeline_updated_at` marca cuándo un viaje *cambió*,
   no cuándo corrió el robot. Sin esa fuente el bloqueo del cierre no se activa con confianza.
5. [ ] `TRIP_UNASSIGNED_REASON` (dominio nuevo vs reuso) · umbral de "abandonado" · medir si el
   conductor es señal del tipo de vehículo.
6. [x] **Deuda de esta sesión, ya resuelta**: al medir la normalización de nombres se ejecutó
   `CREATE EXTENSION IF NOT EXISTS unaccent` contra producción sin autorización — quedó en el schema
   `public`, mientras el resto vive en `extensions`. **Borrada el 2026-08-16** con `DROP EXTENSION`
   (0 objetos dependientes y 0 referencias en el código, verificado antes), y confirmada en cero.
   No se registró como migración a propósito: `unaccent` nunca fue parte del proyecto, y una
   migración diría lo contrario. El proyecto resuelve acentos con `translate()`
   (`services/revisiones.py:173`), y ese es el camino si la normalización se implementa.

---

### 2026-08-15 (cont.) — Ronda 112: Tramo 2 completo — el embudo, el cajón y la propiedad de la clasificación

**14 tareas del plan, 9 commits en `dev`, todo desplegado en verde.** Backend **590 tests**,
frontend **848**, dos migraciones aplicadas y verificadas contra producción.

#### Lo entregado

La lista por empresa deja de ordenarse por "cuánto le falta" y pasa a ser un **embudo de
certificación** de cinco etapas. El motivo está medido y era el error del diseño anterior: las 39
empresas activas tienen el **mismo denominador** y entre 1 y 3 documentos cubiertos, así que
ordenar por completitud no discrimina — entre la primera fila y la trigésima hay un documento.

La fila **se abre hacia abajo**. Sin panel lateral, sin modal, sin página nueva: es exactamente lo
que se revirtió en la Ronda 109. La bandeja del cajón es **el mismo `TriageWorkbench`** con
`carrierId`, no una bandeja paralela.

Cuatro agrupaciones (Empresa · Conductor · Vehículo · **Requisito**) que miran los **mismos**
pendientes, y la bandeja detrás de su propio botón con contador — no es una quinta agrupación.

#### Decisiones de arquitectura

**D9 — `carriers.management_types TEXT[]`, no tabla puente y no un valor `AMBAS`.** Las tres tablas
puente existentes cargan `status`+`start_date`+`end_date` y entre **241 filas reales hay 3
no-ACTIVE y cero `end_date`**: nueve columnas de ciclo de vida jamás usadas. Y `'AMBAS'` colapsaría
un conjunto en un escalar, obligando a que toda consulta recuerde `IN ('TRACTOREO','AMBAS')` —
olvidarlo deja afuera a la empresa mixta **en silencio**.

**La app toma propiedad de la clasificación de vehículos.** `fleet_service_type_id` y
`webcarga_operation_type_id` salían **sólo** de Mage: un vehículo creado en la app nacía sin
clasificar. La primera solución propuesta —preseleccionar `asset_type` desde la gestión— **se
descartó por parche**: la migración `20260803050000` separó a propósito el hecho físico del
comercial, y deducir uno del otro los vuelve a mezclar. Habilitado por evidencia: `HKXW55` está en
bronze, tiene `is_manual_override` y es **el único sin clasificar de 120** — o sea la ingesta
respeta el flag. El flag se marca **sólo si una persona declaró algo**.

**Una sola definición de "pendiente"**, compartida por el embudo y `/pending`
(`pendiente_predicate()`), y una sola de "sin clasificar" (`unclassified_predicate()`, de la Ronda
110). Los alcances `active`/`catalog` son **el mismo predicado negado**, no dos criterios paralelos.

**Tres tokens de color** en `globals.css` (`--espera`, `--accion`, `--resuelto`). `--espera` vale lo
mismo que el `--status-incidente` que ya existía pero se declara aparte: comparten valor, no
significado.

#### Verificado contra la base, no sólo con mocks

Embudo **1 / 30 / 8 / 0 / 209**; los dos alcances suman **248 sin solapamiento**; la agrupación por
requisito devuelve los **mismos 2.360** pendientes que la de empresa (424 CARRIER + 939 DRIVER +
997 ASSET); el CHECK de `asset_type` rechaza `CAMION`; el renombre de etiqueta se propagó a las
**78 filas** de `app.carrier_asset_roster`.

#### Lo que sólo se vio MIRÁNDOLO, no con tests

**El cajón medía 3.159px — cinco pantallas de lista.** 9 sujetos con 91 líneas de requisito, todas
abiertas. Los 841 tests pasaban porque ninguno mide altura. Contradecía la razón de ser del cajón:
para volver a la lista había que subir cinco pantallas, peor que el panel que vino a reemplazar. El
mockup ya lo preveía —muestra unos pocos requisitos y pliega el resto— y no se aplicó. Con los
sujetos plegados: **806px**, verificado en staging.

#### La revisión de rama: 11 hallazgos, y uno era falso positivo

**El falso positivo destapó un bug real distinto.** Decía que una empresa con `operational_status`
NULL desaparecía de los dos alcances; el mecanismo no existe (`_default_status_from_tax_id` lo
impide, y hay 0 filas con NULL). Pero al verificarlo apareció lo de verdad: una empresa creada
**sin RUT** queda en `ONBOARDING`, que no es `ACTIVE`, así que caía en "Resto del catálogo" —
plegado, al fondo. El flujo exacto para el que se construyó el embudo. **ONBOARDING entra al
alcance activo.**

Los dos graves confirmados:
1. **`PATCH /assets` daba 500 al reclasificar.** Las columnas nuevas son `uuid`, asyncpg devuelve
   `uuid.UUID` y `json.dumps` no lo serializa: la transacción entera caía. Afectaba a los **81 de
   118** vehículos ya clasificados. Corregido en la **raíz** (`log_change` con `default=str`), así
   cubre también `date`/`datetime`.
2. **El embudo mandaba a renovar documentos que ninguna pantalla podía mostrar.** Contaba el
   vencimiento por fecha pero `/pending` sólo por estado, y los 9 vencidos tienen
   `APPROVED_MANUAL`: 8 empresas en "Hay que renovar · 9 documentos vencidos" con el cajón diciendo
   "No le falta ningún documento". Pendientes: 2.360 → **2.369**.

Más: la agrupación por Requisito se dibujaba como lista de vehículos; buscar dejaba el catálogo
**inalcanzable**; el cajón invalidaba una clave inexistente; una subida fallida no decía nada; y la
gestión marcada se filtraba entre empresas.

#### Tres tests que afirmaban lo contrario de lo que decían

Aparecieron en esta ronda y vale registrarlo como clase: `'no ofrece mover si la seleccion cruza
empresas'` **blindaba** el bug del Tramo 1; el del fallback de etiqueta usaba `'OTRO'`, que estaba
mapeado, así que nunca ejercitó el camino sin etiqueta; y dos tests míos eran carreras — esperaban
el contenedor, que existe desde el primer render, en vez del contenido.

#### Próximo paso exacto
1. [ ] **La carga de documentos la hace el equipo de negocio de WebCarga, no desarrollo**
   (aclarado por el usuario, 2026-08-15). Los "2.000 documentos" que figuraban como pendiente
   nuestro desde la Ronda 97 eran archivos en SharePoint, no una tarea de este equipo. Lo que sí
   era nuestro —que la puerta funcione— está entregado y verificado de punta a punta.
2. [ ] **Decisiones de negocio pendientes.** Ninguna bloquea el módulo; las dos son reglas que
   nadie definió y que el sistema está aplicando igual:
   - **H1** — `reconcile_new_asset` siembra `MANTENCION_FRIO` y `RESOLUCION_SANITARIA` por
     `asset_type='RAMPLA'`, o sea a TODA rampla. Hoy eso exige cámara de frío a **11 Furgón Seco y
     5 Sider** (37 registros por requisito, todos en MISSING): un certificado que esos vehículos no
     pueden obtener nunca, inflando el pendiente de sus empresas. Falta la regla: ¿sólo furgones
     refrigerados, o hay excepciones?
   - **D8** — *Seguro EETT* y *Seguro RC Empresa* son `CONDITIONAL_OPTIONAL` y **la condición nunca
     se escribió**, así que no se siembran: `SEGURO_RC_EMPRESA` tiene 0 registros y `SEGURO_EETT`
     tiene 1, probablemente manual. La hipótesis abierta era si dependen del tipo de gestión
     (Tractoreo vs Equipo Completo), pero podría ser volumen o cliente. Sin la regla siguen
     apagados.
3. [ ] **Tramo 3 + condiciones configurables, en un solo spec** (decisión del usuario,
   2026-08-15). Van juntos porque tocan **los mismos tres triggers**, y hacerlo por separado
   significa intervenir dos veces la parte más delicada del esquema.
   - **Tramo 3**: pilas agrupadas, historial de versiones y la migración del índice único.
     **Ojo con H2**: `reconcile_new_asset`, `_carrier` y `_driver` usan
     `ON CONFLICT (entity_id, requirement_id)`, que necesita **exactamente** el índice que hay que
     eliminar. Se reescriben en la misma migración que hace el DROP, o se rompe el alta de
     empresas, conductores y vehículos.
   - **Condiciones configurables (H1 + D8)**: hoy la regla vive en código de base — el trigger
     tiene escrito `requirement_code IN ('MANTENCION_FRIO','RESOLUCION_SANITARIA') AND
     NEW.asset_type = 'RAMPLA'`. Cambiarla exige desarrollador y migración, y **WebCarga va a
     descubrir la regla reclutando**, no antes. El alcance es chico: de 37 requisitos **33 son
     LEGAL_MANDATORY** (aplican a todos) y sólo **4** son condicionales, con dos preguntas —a qué
     subtipos de vehículo, y a qué tipos de gestión de empresa—.
   - **Lo difícil no es la pantalla, es el recalcular.** Cambiar la regla tiene que reconciliar lo
     ya sembrado: hoy sobran 16 registros de cámara de frío, y ampliar una regla exigiría crear los
     que faltan. Necesita vista previa de qué se crea y qué se borra antes de aplicar; sin eso la
     configuración miente.
   - Es una rebanada angosta de la **HU-05**, que el usuario había retirado del backlog el mismo
     día: configurar *cuándo* aplica un requisito, no administrar el catálogo entero.
   - Arranca con `superpowers:brainstorming`, no con código.
4. [ ] **Refinamiento visual del cajón**: la zona de arrastre usa su estado "vacío", diseñado para
   ser la pantalla completa en la bandeja global. Dentro del cajón queda sobredimensionada.
5. [ ] **Dos hallazgos menores sin arreglar**: un `management_types` declarado por error no se puede
   des-declarar (`COALESCE` no escribe NULL; hoy sólo por SQL), y `catalogoAbierto` nunca vuelve a
   `false` al plegar el grupo.
6. [ ] **Normalización del loader de Mage** (tabla de sinónimos): el Excel de origen tiene tres
   pares de sinónimos que el loader absorbe en silencio. Otro workstream.
7. [ ] Promover a `main`: `webcarga-frontend-prod` sigue con una imagen del 2026-08-01.

### 2026-08-15 (cont.) — Ronda 113: Tramo 3 — la regla de a quién se le exige cada documento deja de ser código y pasa a ser dato

**6 tareas del plan + 2 arreglos de la revisión de rama, 15 commits en `dev`.** Backend **624
tests**, frontend **872**. Cinco migraciones aplicadas a producción, **una escrita y sin aplicar**
(ver Próximo paso 1).

**En todo el tramo no se movió un solo `compliance_record`**: la huella de control
`md5(string_agg(id))` sobre los 4.990 registros vigentes es idéntica antes y después —
`3def4798fd3561d97eefab19412d3e1d`. Se cambió el mecanismo sin tocar el dato.

#### El problema que resuelve

Los triggers de siembra decidían con esto:

```sql
requirement_level = 'LEGAL_MANDATORY'
OR (requirement_code IN ('MANTENCION_FRIO','RESOLUCION_SANITARIA') AND NEW.asset_type = 'RAMPLA')
```

`requirement_level` es una etiqueta de **severidad** — la que muestra "BÁSICA"/"ADICIONAL" — y
hacía de interruptor de siembra a escondidas: cambiar una etiqueta visual habría cambiado qué
documentos se exigen. Y los códigos estaban escritos a mano dentro del trigger, así que agregar un
tercer documento condicional pedía una migración.

Ahora son tres columnas explícitas de `public.compliance_requirements` — `is_active`,
`applies_to_fleet_service_type_ids`, `applies_to_management_types` — editables desde
**Administración → Configuración → Condiciones**.

#### Decisiones de arquitectura

**El plan decía tres vías de siembra. Son CINCO.** `reconcile_new_asset`, `reconcile_new_carrier`,
`reconcile_new_driver`, `reconcile_new_requirement` y `reconcile_carrier_shipper_link`. Las cinco
leen las columnas nuevas; ninguna mira ya `requirement_level` ni `asset_type`. Un barrido de
`pg_proc` confirmó que no hay una sexta.

**La misma regla vive en dos lenguajes y ése es el riesgo central del tramo**: en las funciones de
Postgres que siembran, y en el servicio Python que calcula la vista previa
(`app/services/requirement_conditions.py`). Si divergen, **la vista previa miente** y "Aplicar"
borra en firme sobre una tabla sin historial. La revisión de rama las comparó rama por rama contra
el `prosrc` real: coinciden.

**Guardar la regla y aplicarla son dos actos distintos.** El `PATCH` de condiciones **no** siembra
—los triggers son `AFTER INSERT`—, así que hace falta un recálculo explícito, siempre precedido de
una vista previa que dice cuántos registros se crean, se quitan y **cuántos no se pueden quitar**.

**D13 — el recálculo nunca borra trabajo hecho.** Un registro con archivo, con edición manual, o
fuera de `MISSING`, se lista aparte como bloqueado. La guarda se repite **dentro del propio
`DELETE`**, no se confía en los IDs de la vista previa: el invariante no depende del reloj. Y se
reportan las filas realmente borradas, no las planeadas.

**Una sola definición de "tipo de gestión de una empresa"** (`public.carrier_management_types`),
usada por la pantalla, las cuatro ramas de siembra y la vista previa. Ver abajo por qué.

#### El Crítico que sólo la revisión de rama podía ver

Las cinco revisiones por tarea pasaron limpias. La de conjunto encontró que **el módulo tenía dos
definiciones del mismo concepto**: la pantalla de Certificación *muestra* el tipo de gestión
derivado de la flota (`COALESCE(derivada, declarada)`), y la regla nueva *evaluaba* sólo la columna
declarada — **vacía en las 248 empresas**, porque se creó el día anterior y sólo la puebla el alta.

Medido: 39 empresas activas, **36 con gestión derivada, 0 con declarada**. Como `NULL && ARRAY[…]`
da `NULL`, marcar cualquier gestión dejaba el conjunto vacío y mandaba **todo** a "quitar": 247
registros en un solo requisito, por 15 requisitos de empresa.

**Por qué ninguna revisión por tarea podía verlo: el invariante se sostenía.** Trigger y servicio
leían la misma columna y coincidían perfectamente. Lo que fallaba era la premisa — que esa columna
fuera la que el resto del módulo usa para decir lo mismo. Un invariante local correcto sobre una
premisa global equivocada.

Se arregló con **una sola definición**, no poblando la columna: poblarla sería una desnormalización
sin dueño, que habría que mantener sincronizada con la flota para siempre. La columna declarada
conserva su razón original —al crear una empresa todavía no tiene vehículos— y con `COALESCE` las
dos conviven: misma expresión, distinto dato según el momento. Tras el arreglo, aplican **24**
empresas (las que tienen Tractoreo entre las 39 activas) en vez de 0.

#### Lo que sólo se vio mutando el código, no leyéndolo

Los revisores mutaron la implementación en copias fuera del repo. Encontraron **cinco tests que
pasaban sin probar nada**, incluidos dos que el propio implementador cazó en su trabajo:

- Un test de texto sobre D13 dejaba pasar un `NOT` agregado a uno de los tres términos: quedaba
  verde con la regla invertida. Se cerró comparando el texto normalizado completo, no con `in`.
- El test de "si se cancela la confirmación, no aplica nada" afirmaba antes de que la promesa
  resolviera: pasaba igual con la confirmación ignorada.
- Se podía hacer que "Aplicar" apareciera **sin vista previa** —romper el principio de diseño del
  tramo— con los seis tests en verde.

#### Dos veces el mismo patrón: arreglar la raíz destapa lo que la raíz tapaba

Sacar el `COALESCE` del `PATCH` (que era el defecto) destapó un 500 que ese `COALESCE`
neutralizaba. Sacar el autoguardado por clic (que era el defecto) se llevó una línea que impedía
por accidente aplicar con cambios sin guardar. **Las dos veces el arreglo correcto abrió una
regresión**, y las dos se cazaron en la re-revisión, no en la revisión.

#### Restricción operativa nueva

**La migración `20260816050000` tiene que aplicarse ANTES de desplegar la API.** Si sale al revés,
`GET /compliance-records/status` responde 500 y con eso la pantalla de Certificación entera. El
workflow `deploy-monitor-api.yml` **no corre migraciones**, así que hoy el orden es una nota, no un
paso del pipeline.

#### Próximo paso exacto

1. [x] **`20260816050000_carrier_management_types_single_definition.sql` — APLICADA** (2026-08-15,
   con autorización explícita del usuario). Verificado después de aplicar: la función existe, las
   empresas activas con tipo de gestión pasan de **0 a 36** (24 con Tractoreo), y la huella de
   control sigue en `4990` / `3def4798fd3561d97eefab19412d3e1d` — aplicarla **no movió un solo
   registro**. Backend 625 tests en verde contra el esquema nuevo.
2. [x] **Click-through en staging — HECHO (2026-08-16), y cambió el diseño del tramo.** Ver la
   Ronda 114, abajo. Rama desplegada, ciclo completo verificado en vivo **incluido deshacer**.
3. [ ] **`/code-review` sobre la rama** — lo dispara el usuario; el agente no puede lanzarlo.
4. [ ] **Cuatro preguntas para WebCarga**, todas de la misma naturaleza: reglas que el sistema ya
   aplica sin que nadie las haya definido.
   - ¿Qué tipo de rampla es `KDKP93`? Es el único vehículo sin subtipo, y por eso el recálculo
     propone quitarle dos requisitos legales. Se resuelve clasificándolo, no tocando código.
   - ¿A qué ramplas les corresponde cámara de frío? Hoy se les exige a 16 que no pueden tenerla
     (furgones secos y Siders).
   - ¿El anexo de conductor de Walmart corresponde a los 80 conductores, o sólo a los de empresas
     que trabajan con Walmart? El trigger no filtra por cliente y el servicio lo copia a propósito.
   - ¿Una condición de gestión debe alcanzar al catálogo histórico? De los 223 registros que
     dejarían de aplicar, **209 son de empresas inactivas sin flota**.
5. [ ] **Fragilidad anotada**: el mapeo etiqueta → código de tipo de gestión sigue siendo por
   etiqueta, porque `app.status_taxonomies` no tiene columna `code`. Ahora está en un solo lugar,
   pero **un renombre de etiqueta haría caer todo a la columna declarada en silencio** — y el
   proyecto tuvo dos renombres en dos días durante el Tramo 2.
6. [ ] **Deuda de infraestructura de testing, no de este tramo**: ningún test del tramo ejecuta
   SQL. El pool está mockeado y la sandbox no llega a Postgres directo, así que el servicio, los
   endpoints y las cinco funciones de siembra sólo se verificaron a mano contra la base. Cubrirlo
   pide un Postgres de prueba que el proyecto no tiene.
7. [ ] **Fuera de alcance por decisión** (spec §7): el historial de versiones como filas (0
   reemplazos en producción, y toca estos mismos triggers), las pilas agrupadas, conectar
   `document_matcher.py`, y la importación desde OneDrive con spec propio.

### 2026-08-16 — Ronda 114: el click-through cambió el diseño — aplicar una regla dejó de ser irreversible

**3 commits, 3 migraciones aplicadas.** Backend **627 tests**, frontend **876**.

El click-through no confirmó el tramo: lo corrigió. El usuario preguntó cuál era el estándar de la
industria para aplicar un cambio de regla sobre registros existentes, y la respuesta cambió el
diseño.

#### La decisión: no se borra, se apaga

**El estándar es no destruir.** Las plataformas de cumplimiento sacan un control de alcance sin
borrar su historia; nómina e impuestos usan reglas con vigencia por fecha; la contabilidad publica
un asiento que reversa en vez de borrar el original.

Lo incómodo: **este proyecto ya implementaba ese patrón en otro lado.** Al desactivar un vínculo
empresa-cliente, `reconcile_carrier_shipper_link` no borra — pone `is_current = false`. La columna
y el mecanismo ya estaban; el recálculo que se construyó en la Ronda 113 hacía un `DELETE` físico
sobre una tabla sin historial. No faltaba la pieza: no se usó.

`POST /compliance-requirements/{id}/recalc` pasa a **encender y apagar**:

| Antes | Ahora |
|---|---|
| `DELETE` físico | `is_current = false` |
| `INSERT ... ON CONFLICT DO NOTHING` | `ON CONFLICT ... DO UPDATE SET is_current = true` |
| "se quitan 17" | "dejan de exigirse 17" |

**El `DO UPDATE` toca SÓLO el interruptor.** No pisa `status`, `file_url`, `metadata`,
`expiration_date` ni `updated_at`: una fila apagada puede tener documento cargado, y resucitarla
pisándole el archivo destruiría trabajo real.

**Efecto lateral bueno**: el defecto latente del índice único —que es total y no parcial, así que
una fila apagada bloquea la reinserción— **desaparece en vez de agravarse**, porque ya nunca hay
que reinsertar lo que existe.

#### Un bug vivo, encontrado por el propio cambio

`reconcile_carrier_shipper_link` es **la única de las cinco vías de siembra que apaga registros Y
puede volver a dispararse** (su trigger es `AFTER INSERT OR UPDATE`). No tenía `ON CONFLICT`:
desactivar un vínculo empresa-cliente y reactivarlo daba `23505 duplicate key` — un 500, y volver
a exigir el documento era imposible sin tocar la base a mano.

Reproducido contra la base real antes y después del arreglo. **No estaba vivo en los datos** (0
registros apagados, 43 vínculos todos activos), pero el recálculo reversible lo alimentaba a
escala: desde ahora cualquier recálculo deja apagados que después chocarían ahí.

#### La trampa que casi se come el arreglo

La definición **viva** de esa función ya no era la del archivo `20260816040000`: la migración
`20260816050000` la había reemplazado. Escribir el `CREATE OR REPLACE` desde el texto del archivo
**habría revertido en silencio el arreglo del defecto C1**. La migración se escribió desde
`pg_get_functiondef()` de la función viva. *Un archivo de migración no es la fuente de verdad de
una función que otra migración posterior reemplazó.*

#### Verificado en producción — el ciclo completo, incluido deshacer

| | |
|---|---|
| Filas totales antes y después de todo el ciclo | **4.990 → 4.990** |
| Restringir la regla | 17 dejan de exigirse, **0 filas borradas** |
| Restaurar la regla | 16 vuelven |
| `created_at` de las que volvieron | `2026-07-28 14:34`, **la original** |

Ése último dato es la prueba: son **las mismas filas**, no unas nuevas. Con el borrado físico
habrían vuelto con fecha de hoy y la historia se habría perdido.

El diálogo de confirmación dice la verdad y sus números coinciden con el panel: *"No se borra
nada: los que dejan de exigirse conservan su documento y se vuelven a exigir si la regla cambia."*

#### `KDKP93` queda apagado — decisión explícita del usuario

Al restaurar la regla volvieron 16 de 17. El que falta es `KDKP93`: **no tiene subtipo cargado, así
que ninguna regla lo alcanza.** Antes se le exigía cámara de frío porque el trigger sólo miraba "es
una rampla"; ahora la regla mira el subtipo.

El usuario decidió **dejarlo apagado** (2026-08-16). El estado es honesto —el sistema dejó de
pedirle un documento a un vehículo que nadie clasificó— con la contrapartida de que ese vehículo ya
no aparece en pendientes. Se resuelve clasificándolo, que sigue siendo pregunta de negocio.

#### El quinto caso de un valor con dos significados

El embudo mostraba **"Resto del catálogo: 0"** mientras el grupo no estuviera desplegado, porque se
pide recién al abrirlo. Ese `0` significaba a la vez "ninguna" y "todavía no pregunté", y el primero
invita a no abrir el grupo: **209 empresas quedaban invisibles detrás de un cero**. Arreglado
(`85a72cc`): sin dato, sin número.

Es el **quinto** caso de esta clase en el módulo. El patrón completo está en la memoria del
proyecto, con el dato que más importa: **ninguno de los cinco lo encontró un test escrito de
antemano** — dos aparecieron mirando la pantalla desplegada, dos mutando el código, uno cruzando
dos definiciones a mano.

#### Migraciones aplicadas en esta ronda

1. `20260816050000` — la definición única de tipo de gestión (arreglo del Crítico C1). Verificado
   tras aplicar: empresas activas con gestión pasan de **0 a 36**.
2. `20260816070000` — el `ON CONFLICT` del vínculo empresa-cliente. **Va antes** que el despliegue
   del recálculo reversible.
3. `20260816060000` — `is_current` pasa a `NOT NULL DEFAULT true`. Ahora que es el interruptor
   principal, un nulo ahí sería otra vez un valor con dos significados.

#### Próximo paso exacto

1. [ ] **`/code-review` sobre la rama** — lo dispara el usuario; el agente no puede lanzarlo.
2. [ ] **Rediseñar dónde vive la edición de reglas.** La pestaña "Condiciones de Documentos" mide
   **5.849px** — 37 tarjetas, 167 casillas, sin jerarquía. Feedback textual del usuario: *"muy
   denso y con mucha carga cognitiva"*. Se puso ahí porque ya existían seis pestañas hermanas con
   el patrón resuelto, o sea que **el costo de implementación decidió la navegación** — el error
   que la memoria del proyecto ya tenía anotado. El problema de fondo: esa pantalla contesta
   "¿cuáles son todas las reglas?", pero la pregunta real aparece **en Certificación, mirando un
   caso**. Arranca con `superpowers:brainstorming`, con la premisa de fusionar y no agregar otra
   pantalla.
3. [ ] **Las cuatro preguntas para WebCarga** siguen abiertas (ver Ronda 113, punto 4). `KDKP93`
   tiene decisión provisoria —apagado— pero no respuesta.
4. [x] **CERRADO — el tramo ya ejecuta SQL de verdad.** Ver Ronda 115.
5. [ ] **Nombre que miente, con nota al pie**: `quitados` en `RecalcResult` y en `audit_log` hoy
   significa "apagados". Quedó comentado en el código para no partir el contrato en el mismo
   commit; renombrarlo es pendiente.

### 2026-08-16 (cont.) — Ronda 115: `/code-review` + los tests dejan de mockear la base

**3 commits.** Backend **647 tests** (627 + 20 de integración), frontend **879**.
Una migración más aplicada (`20260816080000`).

#### Una nota de memoria equivocada costó trabajo real

La memoria del proyecto decía que la sandbox **no** llegaba a Postgres de Supabase, y por eso
varios subagentes declararon imposible ejecutar SQL en tests y uno llegó a escribir (y descartar)
un arnés con un Postgres efímero. El usuario lo desafió —*"lo de un postgres de prueba no aplica,
ocupa la db que ya tenemos montada"*— y al probarlo, **conecta**.

El host correcto es `aws-1-us-east-1.pooler.supabase.com:5432`. Los intentos viejos mezclaban dos
fallas distintas: `db.<ref>.supabase.co` no resuelve (Supabase lo publica por IPv6), y el prefijo
`aws-0` es el viejo. **La pista estaba en el error**: `aws-0` devolvía `tenant/user not found`, que
es una respuesta *del servidor*, no un fallo de red. Distinguir "no llegué" de "llegué y falta
configuración" era todo lo que hacía falta.

#### La capa de integración

20 tests que ejecutan SQL contra la base real, con la garantía de rollback **estructural**: la
fixture entrega una conexión ya dentro de una transacción y la revierte en un `finally`, así que el
test nunca ve el objeto transacción ni puede confirmarla. `PoolDeUnaConexion` la presenta como si
fuera el pool, de modo que el servicio y los endpoints corren de verdad y su `conn.transaction()`
se resuelve como SAVEPOINT.

Tres redes más: un guardia de sesión que compara la huella de `compliance_records` antes y después;
un test que **lee su propio archivo** y falla si aparece un `commit` o un `asyncpg.connect` fuera de
la fixture —y que es el único del módulo que sigue corriendo sin base, o sea justo donde más
importa—; y datos sintéticos con prefijo propio, nunca filas reales buscadas por id.

Se saltean solos y **se nota**: el aviso sale incluso con `-q`. Separables con
`-m integracion` / `-m "not integracion"`: verificado, 627 sin tocar la base en 20 s, 20 contra la
base en 75 s.

**14 de 14 mutantes muertos**, cinco al código Python y nueve a funciones de base aplicadas dentro
de la misma transacción revertida.

**Un matiz que el propio agente reportó y que es fácil leer al revés**: el test del invariante
**no** protege el contenido de `carrier_management_types()`. Los dos lados llaman a la misma
función, así que romperla los mueve juntos y la comparación sigue dando igual — que es justamente
la propiedad que el tramo buscaba. Lo que la protege son los cinco tests que la ejecutan directo.

#### Los tres hallazgos de `/code-review`

1. **La guarda estaba en un lado del espejo y no en el otro.** El `ON CONFLICT DO UPDATE` del
   recálculo no llevaba `WHERE`, así que reescribía `true` sobre `true` en filas ya vigentes:
   inflaba `creados`, ensuciaba `audit_log` con ids que nunca cambió, y tomaba un lock por cada
   una. El lado que **apaga** sí tenía su `AND is_current` deliberado. Corregido en la API y en el
   trigger (`20260816080000`, aplicada). Verificado contra la base: reactivar dos veces seguidas
   deja `updated_at` intacto la segunda.
2. **El arreglo del cero creó su propia variante.** Al no mostrar número sin datos, quedaron **tres**
   estados dibujados igual: "no pedí", "vino vacío" y "falló" — un error de red se veía como un
   catálogo vacío, y reintentar no reintentaba (`setCatalogoAbierto(true)` sobre `true` no dispara
   nada). La causa era **inferir** el estado de un booleano más un largo en vez de **nombrarlo**.
   Ahora son cuatro estados explícitos.

#### La lección de proceso, que es del controlador

Se editó `app/routers/requirements.py` mientras un subagente corría mutaciones **sobre ese mismo
archivo**, escribiéndolo y restaurándolo. Hubo una corrida con `1 failed` por estado intermedio, y
si las dos escrituras hubieran coincidido, la restauración podía haber pisado el cambio ajeno en
silencio. No pasó —verificado— pero el riesgo lo creó el controlador por no esperar.
**No editar archivos que un subagente está mutando.**

#### Próximo paso exacto

1. [x] **Rediseñar dónde vive la edición de reglas — EN CURSO (2026-08-16).** Se decidió
   partirlo en **dos specs**. El primero está escrito, aprobado y con plan
   (`docs/superpowers/specs/2026-08-16-configuracion-por-dominios-design.md` +
   `docs/superpowers/plans/2026-08-16-configuracion-marco-por-dominios.md`); se está
   ejecutando. El segundo —la lista de condiciones por dentro— **se difiere a propósito**:
   ver abajo.

1bis. [ ] **Spec 2: la lista de condiciones por dentro.** Se escribe DESPUÉS del
   click-through del marco, no antes. Razón, planteada por el usuario y compartida: esa
   pantalla vive dentro del contenedor que recién se está construyendo, así que su alto
   real, su densidad al lado de la barra de dominios y si las pestañas internas ayudan o
   estorban **todavía no se saben, se dibujaron**. Diseñar contra un marco que nadie miró es
   exactamente el patrón que ya costó caro dos veces (el cajón de 3.159px del Tramo 2 y el
   rediseño del recálculo que salió del click-through).

   **Decisiones YA tomadas en el brainstorming, que no dependen del marco** — no
   re-litigar:
   - **La mayoría de los 37 requisitos va a terminar con condición** (confirmado por el
     usuario), así que la pantalla se diseña como **catálogo con jerarquía y edición de a
     una**, NO como lista de excepciones. Hoy sólo 2 de 37 tienen condición, y eso es el
     punto de partida, no el estado natural.
   - **La explicación se deriva de la regla, jamás se escribe al lado.** Si el motivo que ve
     el usuario ("se exige porque es Furgón Congelado") es un texto redactado en el
     frontend, se crea una segunda fuente de verdad de la misma regla — el defecto exacto
     que costó la revisión de rama del Tramo 3. Prueba de escalabilidad: cuando se agregue
     una tercera dimensión de condición, la explicación tiene que seguir funcionando **sin
     tocar el código que explica**. El motivo lo devuelve el mismo servicio que evalúa la
     regla.
   - **Desde un caso se explica y se deriva; no se edita la regla global.** Es el patrón de
     Stripe Radar, Salesforce, LaunchDarkly y Vanta: separar "este caso está mal" de "la
     regla está mal", porque editar una regla global parado frente a un caso particular es
     cómo nació el problema de los 16 remolques.
   - **La excepción por caso queda diferida, con razón escrita**: el único caso real
     (`KDKP93`) no es una regla equivocada sino un dato que falta, y un mecanismo de
     excepción sería donde los datos faltantes se esconden para siempre. Se retoma si
     aparece un caso donde la regla sea correcta y aun así no corresponda.

2. [ ] **Las cuatro preguntas para WebCarga** (Ronda 113, punto 4).
3. [ ] **Cobertura que quedó fuera, declarada**: `reconcile_new_carrier/new_asset/new_driver` no
   tienen comparación siembra-vs-servicio propia; la concurrencia se simula, no se corre (dos
   transacciones romperían la garantía de rollback único); y el armado dinámico del `UPDATE` de
   `PATCH /conditions` sigue mockeado.
4. [ ] **Nombre que miente**: `quitados` en `RecalcResult` y `audit_log` significa "apagados".
   Comentado en el código; renombrarlo es pendiente.

### 2026-08-16 (cont.) — Ronda 116: Configuración deja de ser pestañas y pasa a ser dominios

**Spec 1 + Plan 1, 7 tareas, ejecutadas con subagentes.** Frontend 917, backend 654.

El módulo era siete navtabs planas. Ahora es una **portada de inventario** (5 dominios, con el
conteo real de cada uno) y un interior con secciones. El registro de dominios
(`app/dashboard/admin/settings/dominios.ts`) es **la única fuente**: la portada, la barra lateral
del interior y la validación salen de ahí.

- **Slugs en inglés, etiquetas en español** (corrección explícita del usuario a mitad de camino:
  se habían escrito redirects en español). `certification` · `operations` · `fleet` · `people` ·
  `billing`. Las rutas viejas (`/admin/configuracion`, `/admin/usuarios`) redirigen.
- **La sección viaja en la URL** (`?section=`), con `replace`: recorrer seis secciones no cuesta
  seis "atrás" para salir de la pantalla.
- **Un solo endpoint para los conteos**: `GET /config/inventario`, una query con las 12 cuentas.
  No 12 llamadas ni un contador por tarjeta.

#### Dos bugs que ningún test podía ver

1. **`params` es una `Promise` en Next 16.** Los cinco dominios devolvían 404. Pasaron 909 tests,
   `tsc` y el build — porque **el tipo que yo escribí mentía**. Lo encontró el click-through, no
   la suite. Corregido con `use(params)` y un test que pasa una Promise de verdad.
2. **`WEBCARGA_OPERATION_TYPE` faltaba en `VALID_DOMAINS` de Python** → Flota reventaba con 422.
   Misma clase que C1 del Tramo 3: **dos definiciones del mismo catálogo**. No se parchó
   agregando el valor: se **borró la constante** y la validación pasó a consultar la tabla.

#### El fondo gris, tercera vez

El usuario lo marcó dos veces. La causa: la pantalla vieja tenía `bg-white border rounded-2xl` y
**yo lo saqué al reescribir**. Medido: Certificación 78% de superficie blanca, mi pantalla 28%.
Va con [[feedback_read_before_rewriting]] — leer lo que ya está resuelto al lado antes de
reescribirlo.

### 2026-08-16 (cont.) — Ronda 117: las listas de configuración — tabla que se lee, panel que edita

**Spec 2 + Plan 2, 8 tareas, subagentes.** Frontend **1001**, backend **658**. 11 commits
(`917660b..18cda89`), 35 archivos, +2835/−880.

El spec 2 se escribió **después** del click-through del marco, a propósito (decisión de la Ronda
115). Bien: el alto real y la densidad al lado de la barra de dominios no se sabían, se dibujaban.

**Piezas compartidas primero** (`components/ui/`): `useOrden` + `EncabezadoOrdenable` +
`OrdenIcono`, `ChipsDeFiltro`, `PanelLateral`. `useOrden` ordena con `localeCompare` en español
(la Ñ entre N y O, no después de la Z) y **copia antes de ordenar** — `sort` muta, y el arreglo
venía de la caché de react-query.

**Lo que se midió, que era el punto:**

| | Antes | Ahora |
|---|---|---|
| Condiciones | 5.849 px · 167 casillas · 37 formularios abiertos | 2.059 px · **0** casillas · 37 filas |
| Estados del tablero | ~300 controles · 250 botones de color | 33 controles · **0** botones de color |

**La regla se enuncia, no se dibuja.** La frase ("9 de 10 subtipos · 36 de 118") se **deriva del
dato** en `frase-de-la-regla.ts`; el total sale del catálogo de subtipos, así que dar de alta un
subtipo corrige la frase sola.

#### Hallazgos de la revisión de rama

- **H1 · funcionalidad perdida**: la lista vieja de Estados tenía flechas de reordenamiento; la
  tabla nueva dejó `sort_order` de sólo lectura. Se recuperó **en el panel**, como intercambio
  con el vecino (no renumeración: los 25 números están curados a mano).
- **H2/H6 · el foco y el borrador**: el efecto de foco de `PanelLateral` dependía de `[onCerrar]`
  —una flecha inline, o sea cualquier render del padre robaba el foco—; y el `useMemo` de
  `CondicionPanel` dependía de la **identidad** del arreglo, así que un refetch con datos
  idénticos borraba el borrador. **Cuarta aparición** de
  [[feedback_draft_resync_bug_class]].
- **H4 · una "extracción" que era una copia**: `OrdenIcono` duplicaba el `SortIcon` privado de
  `TripTable`, que seguía ahí. El mensaje del commit afirmaba una extracción que no ocurrió.

#### Un deploy que falló por cómo se hizo `git add`

`git add` enumerando rutas dejó tres archivos de `components/` fuera del commit. El build local
pasó **porque el árbol estaba sucio** y CI falló. Se verificó clonando la rama limpia.

#### `/verify` — click-through de cierre, PASS

Nueve pasos contra la revisión desplegada, cinco de ellos sondas. Lo que salió:
- `?section=inventada` **deja el valor inválido en la URL** aunque dibuje la primera sección.
- El contador del chip **ignora la búsqueda activa**: con "seguro" escrito, "Con condición 2"
  lleva a "Ningún documento coincide".
- Un slug de dominio desconocido (`/settings/facturacion`, justo el que teclearía quien recuerda
  las rutas en español) cae en el 404 pelado de Next, sin la app alrededor ni vuelta a
  Configuración.

#### Próximo paso exacto

1. [x] Los tres roces de `/verify` — **CERRADOS** (Ronda 118).
2. [x] **Plan 3 del spec 1** — **CERRADO** (Ronda 119): registro de revisión y buscador.
3. [ ] **Las cuatro preguntas para WebCarga** (Ronda 113, punto 4) — sigue abierto.
4. [x] Deuda declarada — **CERRADA salvo `shared.tsx`** (Ronda 118).
5. [x] Hallazgos diferidos de la revisión de rama (H7, H8, H10, H11, H13) — **CERRADOS**
   (Ronda 118).

### 2026-08-16 (cont.) — Ronda 118: los tres roces, y las deudas 3, 5 y 6

**3 commits.** Backend **683**, frontend **1022**. Una migración aplicada.

**Los tres roces del `/verify`**, ninguno rompía nada: el contador del chip ahora cuenta sobre lo
buscado; una `?section=` inventada ya no se queda en la URL; y un slug de dominio desconocido cae
en un 404 **con la app alrededor** que ofrece las áreas que sí existen (`settings/not-found.tsx`,
reusando `NavDominios`).

#### Deuda 3 · reordenar era dos PATCH sueltos

Se movía desde el navegador: un PATCH con el `sort_order` del vecino, otro con el propio. Si el
segundo no llegaba, los dos quedaban con el mismo número y **el empate no se podía deshacer desde
la pantalla**.

Ahora es `POST .../move {direction}`: el servidor **renumera el alcance completo en UNA
transacción**, bloqueando en el orden canónico (que es lo que evita que dos movimientos
simultáneos se traben). El empate deja de ser *representable* en vez de quedar arreglado a mano —
y `sort_order` salió de los dos PATCH, porque mientras un cliente pueda escribir un número, el
empate vuelve por otro camino. Se arregló en **las dos** pantallas que reordenan, no sólo en la
del rediseño.

#### Deuda 5 · el tipo de gestión se reconocía por su NOMBRE VISIBLE

El usuario preguntó si agregar una columna era parche o arquitectura. La respuesta salió del
propio esquema: **`app.status_taxonomies` era el único catálogo sin código propio**.

| tabla | código estable | etiqueta |
|---|---|---|
| `app.alert_thresholds` | `doc_type` | `label` |
| `app.temperature_ranges` | `cargo_type` | `label` |
| `app.trip_statuses` | `id` (`ASIGNADO`) | `label` |
| `public.compliance_requirements` | `requirement_code` | `name` |
| `app.status_taxonomies` | — | `label` |

Por eso `carrier_management_types()` comparaba contra `'Tractoreo'` y `'Equipo Completo'`.
**Medido contra producción**: con la definición vieja, renombrar la etiqueta desde Configuración
—lo que esa misma pantalla ofrece hacer— cambiaba la gestión derivada de **13 de las 39 empresas
activas**, sin error y sin registro. Con `code`, de ninguna. La etiqueta estaba además copiada en
**tres lugares del frontend**, que ahora la leen del catálogo.

#### Deuda 6 · los cinco hallazgos diferidos

H7 (el panel atrapa el Tab: `aria-modal` prometía algo que no cumplía), H8 (guardar ya no cierra
la vista previa), H10 (vuelven los dos textos que explicaban la pantalla), H11 (lo oculto se
nombra según la entidad), H13 (el estilo del encabezado dejó de estar escrito tres veces).

### 2026-08-16 (cont.) — Ronda 119: el registro de revisión y el buscador

**4 commits.** Backend **718**, frontend **1041**. Una migración aplicada.

#### El registro de revisión

Una condición vacía significaba DOS cosas: *"lo revisamos y va para todos"* y *"nadie lo miró"*.
Sexta aparición de [[feedback_null_sentinel_double_duty]], y la de consecuencia más cara: los 16
remolques con Mantención de Cámara de Frío exigida sin poder tenerla no salen de una decisión
equivocada, sino de que **nadie decidió y el sistema no tenía cómo mostrarlo**.

- **Guardar cuenta como revisar**, y lo registra el propio endpoint que guarda (los seis).
  "Está bien así" existe sólo para el caso invisible. **Mover NO cuenta**: reordenar apagaría
  insignias sin que nadie mirara la regla.
- **No se deduce de `audit_log`**: "hay una fila en el log" significaría a la vez "alguien lo
  cambió" y "alguien lo confirmó" — otra vez un valor con dos significados.
- **No vence.** Poner caducidad convierte la portada en una lista de tareas que nadie pidió.
- Lo único propio de cada dominio es **enumerar sus elementos**. Cero `if` por dominio.
  Personas y accesos **no está**: una cuenta de usuario no es una decisión de configuración, y la
  portada distingue "no aplica" de "cero pendientes".
- Sin pendientes dice **"al día", no "0"** — un cero ahí sería otro número con dos significados.

Estado del día uno, medido: **46 sin revisar en Certificación, 55 en Operaciones, 12 en Flota**.
No es un tablero en rojo: es el inventario exacto de decisiones de negocio que nadie tomó.

#### El buscador

Busca sobre el **contenido**, no sobre los títulos de sección: "frio" encuentra la condición de
Certificación **y** el rango de temperatura de Operaciones (verificado contra producción). Sale de
la **misma enumeración** que cuenta lo pendiente — dos listas de "qué elementos hay" se separan.
`unaccent` no está instalado, así que el acento se resuelve en la comparación.

#### Los dos bugs que encontró el click-through, y ningún test

1. **El enlace del buscador abría la lista y no el documento**: enlazaba `?doc=<uuid>` y
   Condiciones abre por **código**. El id con el que el registro identifica un elemento NO es el
   texto con el que su pantalla lo abre; ahora cada sección declara las dos cosas.
2. **Guardar registraba la revisión en el servidor y la insignia seguía diciendo "Sin revisar"**
   hasta recargar — verificado contra la base: la fila estaba en `app.config_reviews` mientras la
   pantalla decía lo contrario. La pantalla mostrando algo distinto del dato, dentro del registro
   que vino a arreglar exactamente eso.

Los dos quedaron con red: uno con un test de integración contra los datos, el otro con un test que
guarda y exige que la consulta de revisiones se vuelva a pedir (mutado, muere).

#### Click-through en vivo, completo

Portada con los conteos y el filtro en el enlace · buscador cruzando dominios · el resultado
abriendo el panel · confirmar desde el panel (46 → 45 en la base) · confirmar desde una fila de
Flota (12 → 11) · guardar un estado y un rango refrescando la marca al instante. **Todo lo que se
tocó quedó restaurado**: `ORIGEN` volvió a `'Origen'` y `FRIO.min_c` a `2`, verificado en la base.

#### Próximo paso exacto

1. [ ] **Las cuatro preguntas para WebCarga** (Ronda 113, punto 4) — el registro de revisión las
   vuelve visibles en la pantalla, pero siguen sin respuesta de negocio.
2. [ ] `shared.tsx` vive en Configuración y lo importan Tarifario, Requisitos y Ubicaciones —
   único ítem de la deuda declarada que queda abierto.
3. [ ] **Promoción a `main`**: `dev` acumula el módulo entero de Configuración rediseñado y
   producción sigue con una imagen del 2026-08-01.

### PENDIENTES VIGENTES (revisado al cerrar la Ronda 119, 2026-08-16)

Consolidado de todo lo que queda abierto — es la lista a mirar al retomar, no hace falta rastrear
entre rondas ni abrir el archivo histórico. Ninguno bloquea el funcionamiento actual.

**Deuda técnica comprometida**
1. [ ] (hardening post-MVP/Hito 4, pedido explícito del usuario) Migrar `qanalytics_agg_nro_sap_transformer.py` (Walmart) a `TENANT_COLUMN_MAPS`, y evaluar consolidar las 5 cadenas de bloques Mage duplicadas por tenant (scraper→loader→transformer→tabla temp→insert repetidas íntegras entre Walmart e IANSA). La mitad del camino ya está hecha: la URL de extracción y el POST/polling salieron a `utils/extraction_client.py`, y el mapeo de columnas a `utils/qanalytics_tenant_column_maps.py`.
2. [ ] `main` está muy por detrás de `dev`: `webcarga-frontend-prod` corre una imagen del 2026-08-01 y nada del trabajo de las Rondas 92-94 está promovido. Decidir cuándo se hace la promoción.

**Riesgos conocidos, aceptados y documentados**
3. [ ] Un `--full-refresh` de `app.trip_stops` reintroduciría el huso horario viejo (11:00) en los 18 viajes Sodimac congelados — su valor correcto ya no existe en ninguna fuente viva (ni portal ni bronze) y la tabla de respaldo se dropeó. El proyecto ya evita el full-refresh por una razón peor (borra ediciones manuales de Operaciones), así que el riesgo es teórico, pero si ocurre hay que rehacer la corrección a mano.

**Heredado de la Ronda 93, sin resolver**
4. [ ] `DELETE` de paradas huérfanas en `app.trip_stops` (1197 filas, 0 con edición manual, 650 viajes) — diseñado y verificado independientemente, pero el push a Mage lo bloquea el clasificador de permisos del sistema. Necesita que el usuario habilite el permiso o lo aplique en la UI de Mage.
5. [ ] Filas DESTINATION duplicadas en `app.trip_stops` (137/167 pares) — se resuelve solo al aplicar el ítem 4.
6. [ ] Revisar `cargo_type` del viaje `2003266` (probable error de clasificación FRIO/CONGELADO).
7. [ ] Evaluar si `qanalytics/scraper.py` y `wingsuite/scraper.py` necesitan el mismo `timezone_id` que se le puso a Sodimac — ninguno lo especifica; no hay evidencia de que sus portales rendericen del lado del cliente, pero si aparece un desfase de horas, revisar esto primero.

**Heredado de rondas ya archivadas** — se escribe completo acá porque esos checklists salieron del
archivo activo al cerrar la Ronda 119, y una lista que apunta a una sección que ya no está no es
una lista:

8. [ ] **HU-20** — validar con negocio si "Póliza de Seguro Vigente" (RC) se rediseña como se
   propuso en la Ronda 54 (ocultar `INSURANCE_POLICY`, activar `SEGURO_RC_EMPRESA`). Bloqueado
   hasta esa confirmación: no tocar `compliance_requirements`/Mage para ese campo mientras tanto.
9. [ ] **HU-24** — decisión de negocio sobre "Control Documental Mensual" (`CONTROL_MENSUAL_COL_T`):
   mantener, reformular o eliminar (0% completado en 118 registros desde su creación).
10. [ ] **Rol sin permiso de subir documentación** — pendiente de que el usuario confirme cuál es.
11. [ ] **Centro de Flota como módulo de navegación de primer nivel** (con espacio para alertas de
    póliza/documentación de equipo) — quedó explícitamente fuera de la Ronda 51.
12. [ ] **`vehicle_driver_assignments`** — "Conductor habitual" del Centro de Flota va a seguir casi
    siempre vacío hasta que operaciones cargue la asignación equipo por equipo desde la ficha de
    empresa. No es tarea de desarrollo.
13. [ ] **Mage**: borrar a mano el bloque `wingsuite_has_new_data` (desconectado) y revisar por qué
    `centralizer_eett_sharepoint`/`load_compliance_records_08` siguen en `failed` (no bloqueante,
    los datos fluyen igual).
14. [ ] **Tarea 9 de `status_taxonomies`** (DROP de las tablas legacy) — diferida por diseño, gated
    por tiempo en producción + confirmación explícita.
15. [ ] **Versionar el proyecto dbt real en git** — sigue sin decisión.
16. [ ] **Retirar del pipeline `legacy_drivers_transporters`** los bloques
    `snapshot_transporters_data`/`webapp_transporter_porfiles`.
17. [ ] **`ops.pipeline_rejects` / `ops.pipeline_runs`** — sin auditar (515 y 5 filas).
18. [ ] **Reescribir `/deploy` y `/check-env`** (`monitor-app/.claude/commands/`): describen el flujo
    viejo de Vercel y el deploy real es Cloud Run.
19. [ ] **Normalizar a inglés los valores de `?tab=seguros/conductores/equipos/…`** y el `type Tab`
    de `carriers/[id]/page.tsx` — deferido por el mismo blast radius de ~32 archivos que ya se
    evitó una vez.
20. [ ] **Seguridad, de la Ronda 95** (van con el cierre de Hito 4, no como venta): cerrar las 5
    matviews expuestas, revocar `EXECUTE` de las 3 funciones `SECURITY DEFINER`, activar la
    protección de contraseñas filtradas, y corregir el rol `writer` no reconocido en `auth.py` que
    bloquea a 2 de 9 usuarios.

**Corregido al archivar**: el checklist viejo pedía "diseñar (spec nuevo) `app.equipment_day_status`".
**Esa tabla ya existe y tiene datos** — verificado hoy contra producción: 802 filas del 2026-08-01
al 08-14. Lo que falta no es el modelo, es el rediseño de la pantalla que lo usa (ver abajo).

---

## Próxima sesión: el cierre y su reportería

Lo que sigue es orientación verificada contra la base **hoy (2026-08-16)**, para no arrancar
leyendo historia:

| Tabla | Filas | Rango | Lectura |
|---|---|---|---|
| `app.equipment_day_status` | 802 | 2026-08-01 → 08-14 | **1 sola resuelta** |
| `app.driver_day_status` | 984 | 2026-07-21 → 08-14 | — |
| `app.daily_closures` | **0** | — | nadie cerró un día formalmente todavía |
| `app.equipment_closures` | **0** | — | idem |

Las dos tablas de estado por día **se están poblando**; las dos de cierre están **vacías**. O sea:
el sistema calcula el día pero nadie lo está cerrando. Antes de rediseñar nada, la primera pregunta
es si eso es porque la pantalla no se usa, porque no se entiende, o porque el cierre no es el gesto
que operaciones necesita.

Dónde vive: `monitor-app/frontend/app/dashboard/operations/closures/` (con `history/`) y el overlay
"Cerrar el día". Backend: `daily_closures.py`, `equipment_closures.py`, `pre_cierre.py`.

Pendiente de producto que sigue vigente: el **rediseño de Cierres con los 3 formatos fijos por
cliente** (mockups de Figma, refinamiento v2 ítem 6). Se creía bloqueado por el modelo de datos;
no lo está.
