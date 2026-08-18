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
> (**Rondas 112-120 archivadas al cerrar la Ronda 122**: Tramos 2 y 3 de Certificación, el rediseño
> de Configuración, el registro de revisión y el buscador, y el diseño del Cierre. Mismo criterio:
> lo abierto ya estaba consolidado en PENDIENTES VIGENTES antes de mover nada.)

### 2026-08-18 (cont.) — Ronda 125: el paso "Viajes" del Cierre, ejecutado con subagentes

**Plan de 9 tareas ejecutado entero** (`docs/superpowers/plans/2026-08-18-cierre-paso-viajes.md`),
16 commits, un implementador y un revisor por tarea, más una revisión final de la rama completa.
**Falta sólo la Task 9**, el click-through, que está bloqueado por credenciales.

#### Qué existe ahora que antes no

- **Dominio `TRIP_UNASSIGNED_REASON`** con los 4 motivos de negocio (No tenemos camión · No tenemos
  proveedor · No da por tarifa · El mandante lo declinó), gestionable desde Configuración.
- **`app/services/cierre_viajes.py`** — los 4 grupos con UNA sola definición, y
  `GET /api/v1/trips/cierre-viajes`.
- **`PATCH /trips/bulk-close` exige motivo**, valida su dominio, escribe a `public.audit_log` en la
  misma transacción que el UPDATE, y **no toca el `trip_status` del TMS**.
- **`app.daily_closures.total_trips`** — el conteo al firmar, y el delta "posterior al cierre".
- **Pestaña "Viajes"** en el Centro de Cierre y **filtro "No asignado por WebCarga"** en el historial.

#### Los dos defectos que sólo vio la revisión de la rama completa

Cada tarea pasó su revisión individual. El conjunto tenía dos fallas críticas, **las dos de diseño
del plan**, y las dos con el mismo síntoma: *se puede desplegar sin romper nada y sin servir para nada*.

1. **La acción principal nunca se veía terminada.** Cerrar un viaje escribe `is_active=false`, y el
   grupo "Abandonados por el TMS" se define como `NOT is_active` + más de 7 días sin novedad. Medido:
   **13 de los 17 viajes de Rezago ya superan los 7 días**. Al declarar "No asignado por WebCarga",
   el viaje desaparecía de Rezago y **reaparecía en el acto** en Abandonados —grupo de sólo lectura—
   etiquetado como abandonado por el TMS cuando lo había cerrado WebCarga. Corregido: `abandonado`
   excluye lo ya declarado.
2. **El botón "Verlos" llevaba a una pantalla donde los viajes anunciados no estaban.** Medido: 47
   viajes del 14/08, **0 visibles** en la pestaña. El conteo (¿la firma sigue cubriendo todo?) y la
   pestaña (¿qué necesita decisión?) son cosas distintas y el plan las confundió. El Monitor **no
   tiene** filtro por URL, así que se quitó el botón en vez de inventar un mecanismo. **Queda como
   deuda declarada**: el aviso informa pero no lleva a ningún lado.

Y un tercero, importante: **`app.trips.unassigned_reason_id` tenía dos escritores con vocabularios
distintos** — `GestionPanel` escribe `DRIVER_REASON` ("Médico", "Vacaciones") y el bulk-close nuevo
escribe `TRIP_UNASSIGNED_REASON`, sin que la FK ni nadie validara el dominio. El filtro le habría
mostrado a Pablo, bajo "los que nos ofrecieron y no asignamos", viajes cuyo motivo es "Vacaciones".
Había 0 filas, así que se validó antes de que naciera el problema.

#### Lo que el proceso encontró de mis propios planes

Los revisores no encontraron casi nada en la implementación; encontraron **defectos en el plan**:
los colores que puse no pertenecían a la paleta cerrada del módulo · dos de los tests que redacté no
probaban nada (uno tautológico por construcción, otro atado a datos de producción) · el número de
abandonados que documenté (46) estaba mal medido: son **34**, porque conté sin el `NOT is_active` y
dupliqué los Sodimac que ya están en rezago · `planning_date.isoformat()` habría reventado con el
viaje sin fecha · el nombre `get_daily_closure` no existía · y afirmé que el Monitor usaba
`bulkClose` cuando no lo usaba nadie.

#### Un patrón de infraestructura, para la próxima

**Tres subagentes se colgaron** lanzando la suite completa en segundo plano y quedándose a esperarla.
El disparador era pedirles que la corrieran. Se resolvió sacándoles esa responsabilidad: corren sólo
los tests acotados y **las suites completas las corre el coordinador entre tareas** — lo que además
atrapó dos fallas que las corridas acotadas no veían.

#### Estado de los trinquetes del sistema visual — importante para quien siga

**Color 1779/1780 · tipografía 279/279 · `<h1>` 9/9.** Dos de los tres en margen cero: el próximo
color crudo o tamaño por debajo de 11px que alguien agregue **en cualquier archivo del repo** rompe
CI, con un fallo que no va a tener nada que ver con lo que esa persona estaba haciendo. La próxima
tarea de frontend debería empezar bajándolos.

#### Verificación

Backend **804 tests** · frontend **1098 tests** · `tsc` y `npm run build` limpios. Las 3 migraciones
aplicadas a producción son aditivas y verificadas. En producción: 4 motivos sembrados, columna
`total_trips` creada, **0 viajes con motivo y 0 días firmados** — la infraestructura está puesta y
sin estrenar, que es lo esperado.

#### Próximo paso exacto

0. [ ] **Task 9: el click-through.** Bloqueado por credenciales — el servidor de dev redirige a
   `/login` y `.env.local` sólo tiene un placeholder. Hay que desplegar a dev y tener un usuario.
   Es lo único que puede verificar que un viaje cerrado conserva su `trip_status` y que
   `resolve_trip_fleet()` no lo pisa.
1. [ ] **Decidir qué hacer con el aviso "posterior al cierre" sin acción** — o se agrega filtro por
   URL al Monitor, o el aviso se queda informando nada más.
2. [ ] **Bajar los tres trinquetes** antes de la próxima tarea de frontend.

---

### 2026-08-18 (cont.) — Ronda 124: identificar al conductor desde la tabla, y un agujero de RLS

**Plan de asignar conductor ejecutado (Tasks 1-6 de 7) + hallazgo de seguridad aplicado.**
Commits `589d42d1` y `deb2401d`.

#### El plan tenía cuatro supuestos falsos, y se verificaron ANTES de ejecutarlo

Están anotados en el propio plan para no rediscutirlos:

1. **No existe NINGUNA foreign key que apunte a `app.trips`** (verificado sobre `pg_constraint`).
   El test de atomicidad dependía de que un `trip_id` inexistente reventara: no revienta. Se
   reescribió contra `trip_fleet_links_driver_id_fkey`, que sí existe — y además es el error
   plausible, un id viejo en la pantalla, no un viaje inventado.
2. **Los tests de las Tasks 1 y 3 no probaban el endpoint**: insertaban por SQL y verificaban la
   fila. Habrían pasado idénticos antes y después del fix.
3. **`@testing-library/user-event` no es dependencia** del proyecto, que usa `fireEvent`.
4. **El alta exige RUT** (`POST /drivers`) y QAnalytics nunca lo reporta. Decisión del usuario:
   **se pide el RUT en el popover**; `tax_id` sigue obligatorio porque es la clave con la que el
   resolvedor identifica por RUT.

#### La corrección que más cambió el diseño: la similitud era la métrica equivocada

Medido sobre los **7 viajes de identidad segura** (`driver_match_rule='tms_rut'`, donde el TMS mandó
el RUT y la identidad no está en discusión):

| tokens roster | tokens TMS | **en común** | similitud | casos |
|---|---|---|---|---|
| 4 | 2 | **2 = todos** | 0,400 | 3 |
| 4 | 3 | **3 = todos** | 0,700 | 2 |
| 4 | 4 | **4 = todos** | 1,000 | 2 |

En los 7, **todas las palabras del TMS están dentro del nombre del roster**. La similitud baja sólo
porque el TMS reporta MENOS palabras, nunca palabras distintas. **Un umbral en 0,5 habría escondido
3 de esos 7.** La similitud castiga igual a un nombre incompleto que a uno ajeno.

Se ordena por **CONTENCIÓN**, bidireccional igual que el CTE `by_partial` de
`app.resolve_trip_fleet()`. El orden invertido y los acentos ya dan **1,000** porque
`public.name_tokens()` normaliza y ordena (fix de la R122) — la pregunta del usuario sobre "apellidos
invertidos o cualquier combinatoria" está resuelta en la capa de abajo, no acá.

Aplicado a las **28 personas** sin identificar: **19 sin candidato** (alta directa), **7 con uno
solo**, **2 ambiguas** — y esas 2 son el conductor duplicado del roster, que sigue pendiente.

Y el viaje que originó todo, el **2032999** («SUAREZ LOPEZ EFRAIN EDUARDO»): esa persona **no existe
en `public.drivers`** y por contención da **0 candidatos**. Se resuelve dando de alta, no eligiendo —
el mejor "parecido" es otra persona, con 0,22.

#### Dos decisiones de diseño que el plan no cubría

- **El lote CONSERVA la empresa y el tracto ya resueltos.** Los vínculos `auto` traen empresa en
  1.457 de 1.521 filas y tracto en las 1.521; como el `manual` es **terminal**, pisarlos con NULL
  los perdería para siempre. Se cambiaría la respuesta a una pregunta contestando otra.
- **Los ids del lote los da el backend, no un conteo del cliente.** El popover ofrece "aplicar a sus
  N viajes" y varios no están en pantalla: contarlos con lo que la tabla tiene cargado sería
  prometer un alcance y aplicar otro.

#### Deuda propia encontrada y corregida en el camino (el usuario preguntó dos veces)

`nombreLegible` salió de `TripTable` a `lib/utils/nombres.ts` — importar una utilidad DESDE un
componente iba a crear un **ciclo** en cuanto la tabla montara la celda · el tipo de la API salió de
un componente a `lib/types.ts` (el mismo error, cometido diez minutos después) · la bitácora del
lote pasó de un INSERT por viaje a **uno solo** · el endpoint de candidatos era **más pobre que el
resolvedor** (una dirección de contención en vez de dos) · `PoolDeUnaConexion` subió a `conftest` en
vez de duplicarse · y **se rompió el trinquete del sistema visual** (1780 → 1811 colores crudos):
no se subió el tope, los dos grises sin token viven ahora en `lib/ui/texto.ts`.

#### El agujero de RLS — real, y no lo abrió esta sesión

La alerta `rls_disabled_in_public` apuntaba a `document_ingest_batches`, `document_ingest_items` y
`requirement_filename_aliases`, creadas el **14-15/08** (Certificación Tramo 1).

**Por qué era real**: Supabase concede a `anon`/`authenticated` **todo el DML** sobre `public`. Lo
que neutraliza esa concesión en el resto del proyecto **no son los permisos** —`drivers` y
`compliance_records` también los tienen— sino **tener RLS activo sin políticas**. Estas tres se
saltaron ese paso, así que con la clave `anon` (que viaja en el bundle por diseño) se podía SELECT,
INSERT, UPDATE, DELETE y **TRUNCATE** vía PostgREST.

Aplicado en producción. No rompe nada: el frontend no las consulta directo y la API entra con
asyncpg como **dueña de la base**, que no está sujeta a RLS. 115 tests de esa ruta pasan y **ya no
queda ningún lint de nivel ERROR**.

#### Verificación

786 tests de backend (14 de integración contra Postgres real, en transacción revertida) · 1090 de
frontend · `tsc` y `npm run build` limpios.

**Falta la Task 7**: desplegar a dev y hacer el click-through con el 2032999 — que ejercita el
camino de **alta**, no el de elegir candidato.

---

### 2026-08-18 — Ronda 123: el Cierre auditado, y las tres pantallas vuelven a contar lo mismo

**Auditoría del Cierre + Bloque 0 cerrado.** Todo verificado contra el código real y contra
producción del día, no contra este archivo — que es historia de incidentes, no estado.

#### El chequeo: qué faltaba de verdad

`app.daily_closures` **sigue en 0 filas**. Y no es por falta de dato: el pipeline corrió a las 13:08,
con 15 viajes de hoy y 32 de ayer. Es la interfaz y la aritmética.

| Bloque del spec del Cierre | Estado real |
|---|---|
| **0 · Resolución de flota** | Aplicado en la R122, pero **los 4 defectos de conteo seguían los 4 vivos** → cerrados en esta ronda |
| **1 · Recorrido de 4 pasos** | No existe: 3 pestañas planas, sin riel ni contador por paso |
| **2 · Paso "Viajes"** | **Nada.** Ni los 4 grupos, ni el motivo sobre el viaje, ni "día reabierto" |
| **3 · Reportería** | Parcial. `app.trip_statuses` **no tiene atributo de facturación** (columnas: id, label, bg_color, text_color, group_id, sort_order, active) |
| **4 · Zona / gestión / tipo de vehículo** | Zona solo en el reporte. Tipo de vehículo en lote: no existe (`TripTable` no tiene selección múltiple) |
| **§8bis · La interfaz** | **Destrabado**: los tokens y `EncabezadoDePagina`/`Cifra`/`Estado` ya existen. El Cierre es el único módulo que no los usa (salvo `Estado` en `FlotaDelDiaSection`) |

Hallazgos sueltos: `CloseDayDialog.tsx` es **código muerto** (317 líneas con tests, nadie lo
importa); el botón del Monitor **no lleva contador**; no hay nav propio en el Sidebar.

Los 4 grupos del paso "Viajes" que aún no existe, medidos hoy: **Hoy 2 · Rezago 17 · En curso 6 ·
Abandonados por el TMS 46** (23 qanalytics, 21 sodimac, 1 wingsuite, 1 manual). Los abandonados
**más que duplicaron** los 21 que midió el spec el 16/08.

#### Los 4 defectos de conteo — cerrados, cada uno medido antes de tocarlo

1. **`pre_cierre.py` miraba un solo día** en sus 5 consultas mientras el resto del Cierre ya era
   multi-día — y corre DENTRO de `_recompute()`, justo antes del cálculo que sí lo es. Delta medido
   sobre el 14/08 antes de aplicar: patentes 33 → 35, RUT 1 → 1, cliente+patente 33 → 35,
   onboarding 0 → 0, sin tipo 1 → 1. Y **0 patentes pierden señal** en `_single_value`: el ensanche
   no vuelve más conservador al Tipo A, le suma 2 señales usables.
2. **`driver_roster.py` no filtraba al conductor** por `operational_status` mientras
   `fleet_driver_gap.py` sí. Corregido. **Hoy no cambia ningún número** — los 87 conductores están
   ACTIVE, el roster sigue en 44. Es defecto latente, no discrepancia viva; se dice así en el código.
3. **Vocabulario por etiqueta visible → por `code`** en 5 sitios (`driver_roster`,
   `fleet_driver_gap`, `equipment_closures`, `trips`, `status_report`). Equivalencia verificada
   antes del cambio: 43/43 Tractoreo y 73/73 Equipo Completo, 0 filas sin código. Renombrar
   "Tractoreo" desde Configuración ya no vacía el roster en silencio.
4. **`daily_closures.py` no excluía Sodimac** mientras las otras tres pantallas sí.
   **El número que abrió el caso**: para el 14/08 su universo era de **63 viajes contra 48** de las
   otras dos. Ahora comparten base de **49**, y la única diferencia que queda es el requisito de
   tracto resuelto, que es intencional. Y **ningún conductor cambia de estado** (27 antes y después):
   alinea la aritmética sin mover el cierre de nadie.

#### La decisión de diseño que se tomó al medir, y va contra la letra del plan

El plan pedía la exclusión de Sodimac en 4 líneas de `daily_closures` y también en `pre_cierre`.
Se aplicó **solo en las 2 que definen el universo de conteo** (`day_trips` y el lateral
`mismatch_trip`), no en los 2 laterales de `clients`: esos agregan **qué clientes atendió el
conductor, para mostrarlos** — excluir ahí escondería un cliente real, que no es el defecto.

Y en `pre_cierre` **no se agregó**, deliberadamente: sería código muerto. Sus 5 consultas exigen
patente o RUT, y de los **54 viajes Sodimac que existen en `app.trips`, 0 traen patente y 0 traen
RUT**. Esa fuente ya está excluida por construcción. Queda un test que explica por qué no hace
falta, para que nadie la agregue "por consistencia".

#### Lo que esta ronda NO arregló, y hay que decirlo

De los 4 fixes, **2 son de causa raíz y 2 no**. El `label` → `code` elimina la clase de bug (el
identificador era la etiqueta editable) y el filtro de conductor de baja era un predicado faltante.

Pero los otros dos —el criterio multi-día y la exclusión de Sodimac— **son correctos y a la vez
replican la duplicación que es la causa raíz real**. Medido después de aplicarlos:

| Predicado escrito a mano | Veces | Archivos |
|---|---|---|
| Criterio multi-día | **14** | daily_closures, equipment_closures, status_report, trips, pre_cierre |
| `source_system != 'sodimac'` | **9** | daily_closures, equipment_closures, status_report, trips |

**"El universo de viajes del día" no tiene una sola definición: se copia y pega.** Por eso derivó,
y esa deriva es exactamente el bug que esta ronda vino a corregir. El repo ya resolvió esta misma
clase dos veces —extrayendo `app.v_trip_fleet_resolution` y `TRACTOREO_ROSTER_CTE`, con el
comentario "la duplicación en 4 lugares fue justo la causa del bug"— y acá se siguió el patrón
viejo en vez del bueno.

**La corrección de fondo**: una sola definición. O una función `app.trips_of_day(p_date date)`
—sirve con `$1` y también en los laterales correlacionados vía `LATERAL`, que es lo que obliga a
tener dos redacciones distintas hoy— o una constante compartida al estilo `TRACTOREO_ROSTER_CTE`.
No se hizo por alcance: toca `trips.py` en 4 puntos más. **Es el ítem que cierra el tema de verdad.**

#### Decisiones de negocio tomadas

1. **Motivos de viaje → dominio nuevo `TRIP_UNASSIGNED_REASON`** (hoy 0 semillas). Los 16 de
   `DRIVER_REASON` responden otra pregunta. Se ejecuta con el Bloque 2.
2. **El mapeo de estados de Sodimac deja de estar bloqueado por un tercero.** Los estados vienen de
   los TMS y el catálogo **debe absorber dinámicamente** los que aparezcan sin mapear.
   **Evidencia de que el mecanismo hace falta**: hay un viaje de Wingsuite con `trip_status =
   'Cancelado'` mientras el catálogo tiene el id `'CANCELADO'` — mismo estado, distinta caja, y el
   viaje **se cae de todo JOIN con `app.trip_statuses` en silencio**. Es 1 viaje, pero el mecanismo
   de pérdida está activo. Vive en el pipeline, no se tocó acá.
3. **Umbral de "abandonado por el TMS" (7 días): sigue sin confirmar** con operaciones.

#### Verificación — qué se corrió y qué no

- **Suite completa del backend: 770 pasan.** Se actualizaron 5 guardarraíles que asertaban el texto
  `wot.label = 'Tractoreo'` (su intención sobrevive, cambió el mecanismo) y se agregaron 6 nuevos:
  criterio multi-día en las 5 consultas de `pre_cierre`, exclusión de Sodimac en las 2 de
  `daily_closures`, filtro de conductor de baja, y lectura por código en `status_report`.
- **El SQL real validado contra Postgres de producción**: las 6 constantes (`_RECOMPUTE_SQL` de
  daily y de equipment, `_DETAIL_SQL`, `_REPORT_SQL`, `_FLEET_DRIVER_GAP_SQL`, `_ROSTER_SQL`)
  parsean, resuelven columnas y **tipan sus parámetros** vía `prepare()` — que no ejecuta, así que
  las de escritura se validaron sin escribir nada. Las de lectura se ejecutaron: `_DETAIL_SQL`
  devuelve las 44 filas de la cuadratura (12 asignados / 32 no), `_ROSTER_SQL` 79 tractos
  (43 TRACTOREO · 35 EQUIPO_COMPLETO · 1 sin código).
  Los mocks no probaban nada de esto: asertan por secuencia de `side_effect`.
- **NO se corrió el click-through en vivo del frontend.** Riesgo bajo y acotado: no cambió ningún
  contrato de API — el único campo renombrado (`webcarga_operation_type_label` →
  `..._code`) se usaba en un solo lugar interno y no aparece en el frontend. Queda pendiente igual.
- **Comiteado** en `c81d0e28` (ver Ronda 124 para lo que siguió).

#### Próximo paso exacto

0. [ ] **Click-through en vivo del Cierre** con el frontend de dev contra la API modificada:
   confirmar que las 3 pestañas muestran cifras coherentes entre sí. Es lo único de la Ronda 123
   que quedó sin hacer.
1. [ ] **Ejecutar el plan de asignar conductor desde el Monitor** (7 tareas). Verificado que el bug
   de origen sigue: `POST /trips/{id}/fleet-link` exige `carrier_id` y recibe `body: dict` **sin
   modelo Pydantic** (`trips.py:2160-2175`), o sea el 422 es un `raise` a mano.
2. [ ] **Plan 3 — el recorrido del Cierre** (Bloques 1, 2, 4 y §8bis). Ahora sí sobre aritmética que
   cuadra. Incluye sembrar `TRIP_UNASSIGNED_REASON` y adoptar los componentes del sistema visual.
3. [ ] **Una sola definición del "universo de viajes del día"** — `app.trips_of_day(date)` o una
   constante compartida. Hoy el criterio multi-día está escrito a mano **14 veces** y la exclusión
   de Sodimac **9**. Es la causa raíz que esta ronda alineó pero no eliminó.
4. [ ] **Absorción dinámica de estados sin mapear** en el catálogo (decisión 2 de arriba).
5. [ ] **Borrar `CloseDayDialog.tsx` y sus tests** — código muerto confirmado.

---

### 2026-08-17 (cont.) — Ronda 122: el modelo de resolución de flota, y el denominador deja de mentir

**Bloque 0 completo, aplicado y verificado en producción.** Spec:
`docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md`.

#### El defecto de raíz, que no era ninguno de los síntomas

`app.v_trip_fleet_resolution` decidía quién manejó cada viaje **en cada lectura**, con un COALESCE de
tres niveles sobre comparación de strings. O sea: corregir mañana la tipografía del nombre de un
conductor **cambia quién aparece en un día que operaciones cerró ayer**. Un cierre es una afirmación
sobre un instante; si se recalcula, no afirma nada. Para un módulo de cierre eso es descalificante.

Todo lo demás —el 34% de cobertura, el padrón que envejece, la patente con tabulador— eran efectos.

#### Las cuatro capas

```
bronze (crudo) → silver (conformado) → public (maestro) → app (operación)

1 · IDENTIDAD   public.canonical_rut / canonical_plate + trigger + CHECK
2 · DIMENSIÓN   public.vehicle_driver_assignments  ← silver.int_habitual_driver_by_tractor
3 · HECHO       app.trip_fleet_links               ← app.resolve_trip_fleet(), por TRIGGER
4 · LECTURA     app.v_trip_fleet_resolution        — lee la 3, no resuelve
```

**No se creó ninguna tabla.** `trip_fleet_links` ya tenía `UNIQUE(trip_id)`, FK a
drivers/carriers/assets y `link_source`; estaba congelada desde el backfill del 18/07. Sólo faltaba
quién la escribiera. La vista pasó de **7 JOIN a 2** con la misma firma, así que los 5 routers y 18
lugares que la consumen no cambiaron una línea.

**Dónde vive cada cosa se deriva de la dirección de dependencias**, no del gusto: las funciones de
identidad restringen tablas de `public`, así que van en `public` (ponerlas en `app` haría que la base
dependa de lo que alimenta); el padrón es conformación de bronze, así que va en `silver`.
Identificadores en inglés, como el resto de la base.

#### El hallazgo que cambió el diseño

El 91% de acierto del padrón **escondía dos poblaciones opuestas**:

| Antigüedad de la evidencia | Casos | Acierto |
|---|---|---|
| Menos de 3 meses | 673 | **94,2%** |
| Entre 3 y 6 meses | 25 | **4,0%** |

Una entrada vieja no es una conjetura peor: es un nombre casi seguro equivocado, y en el Cierre un
nombre plausible se confirma solo. De ahí el corte de frescura de 90 días — **419 entradas
descartadas**. No resolver es una respuesta: la celda vacía hace la pregunta, la mal llenada la
esconde.

#### Cinco defectos propios que encontraron los tests, no la lectura

1. **Un CHECK con `=` sobre una función que devuelve NULL se considera CUMPLIDO.** El candado
   aceptaba exactamente los valores que venía a rechazar. Va `IS NOT DISTINCT FROM`.
2. **`trim()` no saca tabuladores** — sólo espacios. `upper(trim())` no es normalización, y había una
   patente `GBVC90` + TAB invisible para cualquier join.
3. **`pg_trigger_depth()` no sirve de guardia de reentrada acá**: vale 1 tanto cuando dispara el
   merge de dbt como cuando dispara el `UPDATE` del propio resolvedor. Va bandera de transacción.
4. **`source` y `is_manual_override` tenían defaults contradictorios**: cualquier inserción sin
   especificar violaba el CHECK. Se quitó el default — no hay dato sin procedencia.
5. **`assets.py` ponía `is_manual_override=true` sin tocar `source` en el `ON CONFLICT`**: reasignar
   a mano un vehículo del padrón habría reventado.

#### Resultado medido — el número que abrió el caso

| Día | Viajes | Tractos | Conductores | Resuelto |
|---|---|---|---|---|
| 14/08 **antes** | 47 | 29 | **12** | 34% |
| 14/08 **después** | 47 | 32 | **33** | **100%** |

Últimos días al 93-100%. **1.541 filas = 1.541 viajes distintos**: sin duplicación.
Reparto final: `padron` 1.463 · `tms_rut` 7 · `nombre` **0** · sin conductor 62 · `manual` 9 intactas.
El match débil de nombre —el del 34%— dejó de dispararse por completo.

#### Las 13 altas (datos, no esquema — por eso van acá y no en una migración)

**6 tractos y 7 conductores** que ruedan hace 30 días y no estaban en los maestros. Nombres en
`initcap`, que es la convención de las 80 filas existentes.

**Costo declarado: +132 registros de Certificación** (4.990 → 5.122). No es ruido: son vehículos y
personas que efectivamente trabajan y que Certificación no veía. La carga documental es de negocio
(ver [[project_carga_documental_es_de_negocio]]).

Quedan fuera 1 tracto y 3 conductores del padrón fresco que **no ruedan** — no se dan de alta por lo
mismo que no se dieron de alta los ~700 históricos: dispararía requisitos de gente que no trabaja acá.

#### Mage — hecho

Los dos triggers **se perdían con un `dbt --full-refresh`**. Ya están en el `post_hook` de
`dbt/tms/models/app/trips.sql`, verificado bajando copia limpia del remoto. Se agregó una tercera
línea que resuelve los viajes sin vínculo: en un full-refresh el `CTAS` inserta las filas **antes**
de que el post_hook recree el trigger, así que esas filas nunca lo disparan.

**Corrección de una memoria propia**: lo que el clasificador bloquea es `block_update`, no el flujo
de sync. `sync_local_to_remote` pasó a la primera. No volver a decir "está bloqueado" sin intentarlo.

#### Auditoría: cuántas definiciones de identidad quedan

2 vivas —`public.canonical_rut` y `document_matcher.py:rut_dv()`— y **coinciden** en los 4 casos de
prueba (son runtimes distintos, no copias). 1 borrada (`app.normalize_rut`, código muerto con nombre
que mentía). 4 muertas en `dbt/transporters/macros/`, cuyo proyecto apunta a tablas que no existen:
se borran **con el proyecto**, no sueltas.

#### La corrección que encontró el usuario mirando el Monitor (viajes 2032999 y 2031752)

**La precedencia estaba invertida.** El padrón quedaba ENCIMA del nombre del TMS, o sea la
inferencia sobre la evidencia. El TMS dice quién manejó ESE viaje; el padrón dice quién maneja
habitualmente ese tracto. Medido: de 1.002 viajes resueltos por padrón, **46 mostraban una persona
sin nada en común con la reportada**, y el padrón **nunca** estaba llenando un hueco — siempre pisaba
al TMS.

**La causa raíz de que el nombre fallara no era suciedad: era el ORDEN.** El roster guarda
"Nombre Apellido" y el TMS reporta "APELLIDO NOMBRE". Por eso la igualdad exacta cubría 34%.
Comparando el **conjunto** de palabras sube a 59%; aceptando subconjuntos de ≥3 palabras llega a
**79%, con cero ambigüedad medida**.

Precedencia corregida: `manual > tms_rut > nombre > nombre_parcial > padron`, y el padrón **sólo si
el TMS calló**. La identificación baja de ~100% a 60-88% por día, y **esa caída es la corrección**:
el 100% incluía respuestas que contradecían al TMS.

**El padrón resultó casi innecesario** — pasó a resolver 1 viaje. Todo ese aparato estaba
compensando un bug de orden de nombres. Sigue sirviendo como respaldo cuando el TMS calla y como
fuente de la sugerencia, pero no es lo que sostiene la resolución.

**Y la asimetría con la empresa es correcta, no una inconsistencia:** el TMS informa «WEBCARGA SPA»
en **933 de ~1.050 viajes**, en cinco grafías — no sabe qué EETT operó, porque nos ve a nosotros
como el transportista. La regla no es "el TMS siempre manda", es **manda la fuente que realmente
sabe**.

#### Diseño cerrado, implementación diferida: asignar conductor desde el Monitor

**El bug de origen**: `POST /trips/{id}/fleet-link` exige `carrier_id` (422 sin él), así que **no se
puede asignar un conductor sin asignar también una empresa**. Por eso forzar el conductor en el
detalle no guardaba nada. Es también lo que obliga a que la asignación viva en el detalle.

Plan escrito y **sin ejecutar** por decisión del usuario:
`docs/superpowers/plans/2026-08-17-asignar-conductor-desde-el-monitor.md`, 7 tareas.
Los mockups aprobados quedaron en `docs/superpowers/mockups/` — **fuera de `.superpowers/`, que está
en `.gitignore`**.

Las cuatro decisiones ya tomadas (no volver a discutirlas, están argumentadas en el plan): la celda
es el control · el valor crudo siempre se ve · sin chip de color por fila, con el contador-filtro
arriba como condición dura · la casilla de alcance marcada por defecto y el número en el botón.

El dato que ordena el diseño: **27 personas explican 208 viajes** (7,7 cada una, máximo 33). La
unidad de trabajo es la persona, no el viaje.

Y por qué **no** hay emparejamiento automático por similitud: los viajes identificados por RUT
—donde la identidad es *segura*— tienen similitud de nombre de **0,40**. Un umbral alto para ser
seguro descarta personas que sí son la misma.

#### Próximo paso exacto

0. [ ] **Ejecutar el plan de asignar conductor desde el Monitor** (7 tareas). Empieza por quitar la
   exigencia de `carrier_id`, que es el bug reportado.
1. [ ] **Plan 3 — el recorrido del Cierre** (Bloques 1, 2, 4, 5). Todo diseñado en §8bis del spec del
   Cierre; falta escribir el plan y ejecutar. **Ya no hay nada bloqueado por terceros.**
1b. [ ] **Fusionar el conductor duplicado del roster** — dos filas con el mismo nombre. El resolvedor
   se niega a elegir entre las dos (correcto), pero deja esos viajes sin identificar.
2. [ ] `silver.int_habitual_driver_by_tractor` a modelo dbt. **No urgente**: sobrevive al
   full-refresh porque dbt no es su dueño. Exige agregar un bloque al DAG de la ingesta.
3. [ ] **Registro de corridas de extracción** — sigue siendo la única pieza diferible del Cierre.

---

### 2026-08-17 — Ronda 121: la decisión bloqueante, resuelta — el legacy está vivo como registro, muerto como feed

**Auditoría, sin código.** Se revisó el pipeline `legacy_drivers_transporters` en Mage y se midió la
cuadratura de los RUT contra producción. La pregunta que bloqueaba el Plan 4 **queda respondida**, y
la respuesta no era ninguna de las dos que estaban planteadas.

#### La "plataforma legacy" no es una plataforma

`raw_bd_ot_master.py` no consulta ningún sistema: descarga por Microsoft Graph el archivo
**`Teamwebcarga/Documentos compartidos/Finanzas/BD OT 2026.xlsx`**, hoja `BD OT`. Vive en
**Finanzas**, y eso explica todo lo demás.

**Está vivo**: última modificación **2026-08-12** (metadato de SharePoint, que coincide exactamente
con el `max(f_h_modificacion)` de la tabla). 165 OT creadas y 685 modificadas en agosto.

**Pero cambió de oficio**: **cero despachos en agosto**; el último `f_despacho` es **2026-07-31**, y
todas las filas de julio en adelante están en `Pendiente de pago` / `Feedback`. Dejó de ser registro
de operación y es hoy un **libro de liquidación**. Por eso la evidencia parecía contradictoria: el
archivo se edita todos los días, y aun así no sabe nada de lo que pasó ayer en ruta.

#### La cuadratura de los RUT: el dato es bueno

| Medición | Resultado |
|---|---|
| Filas con `rut_chofer` | 107.325 de 107.325 (100%) |
| Normalizan a RUT plausible (8-9 caracteres) | 105.620 (98,4%) |
| **Pasan el dígito verificador (módulo 11)** | **103.097 — 97,6%** |
| Formatos conviviendo | 55.519 con guión · 35.032 con puntos · 13.779 sin nada |

Los RUT inválidos son cola larga: por valor distinto sólo 565 de 763 son válidos, o sea la basura es
de bajo volumen y los RUT que se repiten mucho son los correctos. Firma típica de un registro real.

#### El match funciona… en julio, que es la única ventana donde ambas fuentes se solapan

`app.trips` va del 01/07 al 18/08; los despachos del legacy cortan el 31/07. Cruzando por **patente
de tracto + fecha de despacho** sobre los 985 viajes de julio:

| | Viajes |
|---|---|
| Con patente | 960 de 985 (97,5%) |
| **Resueltos a un único RUT** | **825 — 86% de los que tienen patente, 84% del total** |
| Ambiguos (más de un RUT) | **6 (0,6%)** |
| Sin match | 129 |

Contra el **34%** que logra hoy la igualdad exacta de nombre. La ambigüedad, que era el riesgo
teórico del cruce por patente, resultó ser el 0,6%.

#### Y no sirve para agosto — de ahí sale el diseño correcto

De los **528 viajes de agosto con patente, 0 cruzan por el mismo día**. Obvio: el archivo no tiene
despachos de agosto. **Pero las 528 patentes son conocidas por el legacy históricamente.**

O sea: el legacy no sirve como *feed diario*, sirve como **padrón**. En vez de cruzar por día, se
deriva una vez un registro **patente → conductor** y se resuelve contra él.

**Backtest honesto** (padrón construido SÓLO con datos anteriores al 01/07, evaluado contra la
verdad de julio): **91,0% de acierto** donde hay entrada previa, 88,9% sobre todos los casos.

**Aplicado a agosto: 528 de 528 viajes con patente resuelven — 47 patentes, 46 conductores.** La
flota real de agosto son 47 tractos, no cientos.

**Y la brecha para cerrarlo son 8 filas**: 38 de esos 46 conductores **ya están** en `public.drivers`
(que tiene 79 con `tax_id`). El legacy conoce 763 RUT distintos; el padrón operativo son decenas.

#### Bug real en el dedup de Mage

`bd_ot_master.sql` inserta filtrando con
`WHERE NOT EXISTS (select 1 from bronze.raw_bd_ot target where target.hash_id = md5(t::text))`.
Eso compara **sólo contra el destino, nunca dentro del propio lote**: si el Excel trae dos filas
idénticas en la misma carga, las dos pasan el filtro y las dos entran.

**Medido: 107.325 filas contra 103.848 `hash_id` distintos → 3.477 filas duplicadas.** No es fatal
—río abajo se deduplica por `id_envio`— pero significa que **el conteo de filas no es conteo de OT**
(98.960 OT distintas, 1,08 versiones cada una) y que recargar el archivo infla la tabla.

#### Lo que esto define para el Bloque 0

El padrón **envejece**: es exacto hoy porque se alimentó hasta el 31/07, y va a derivar a medida que
cambien los conductores. El diseño entonces no es "leer el legacy", es **sembrar con el legacy y
dejar que operaciones corrija** — que es exactamente lo que ya hace `trip_fleet_links` con
`link_source='manual'` (9 filas hoy) contra `'auto'` (423, todas del backfill del 18/07, congeladas).
La corrección humana gana, y el legacy puede morir sin llevarse el sistema.

**No hace falta que el archivo siga vivo.** Eso desbloquea el Plan 4 sin depender de Finanzas.

---

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

**Agregado al cerrar la Ronda 125 (2026-08-18)** — lo que salió de las Rondas 123-125:

21. [ ] **El aviso "posterior al cierre" no lleva a ningún lado.** Informa el número y el botón se
    quitó, porque el Monitor no soporta filtro por fecha en la URL (verificado: no usa
    `useSearchParams` ni lee parámetros). O se le agrega, o el aviso queda informativo a propósito.
22. [ ] **Los tres trinquetes del sistema visual, dos en margen cero**: color 1779/1780,
    tipografía sub-11px **279/279**, `<h1>` **9/9**. El próximo color crudo o tamaño chico que
    alguien agregue **en cualquier archivo del repo** rompe CI con un fallo ajeno a lo que estaba
    haciendo. La próxima tarea de frontend debería empezar bajándolos.
23. [ ] **Una sola definición del "universo de viajes del día".** El criterio multi-día sigue escrito
    a mano **14 veces** y la exclusión de Sodimac **9**. La R123 lo alineó pero no lo eliminó, y la
    R125 tuvo que sacar una quinta copia nacida dentro del propio plan. Es la causa raíz de los
    cuatro defectos de conteo que corrigió la R123.
24. [ ] **Absorción dinámica de estados sin mapear** en `app.trip_statuses`. Evidencia: Wingsuite
    manda `Cancelado` y el catálogo tiene `CANCELADO`, así que ese viaje cae fuera de todo JOIN en
    silencio. Decisión del usuario del 18/08: los estados vienen de los TMS y el catálogo debe
    absorberlos. Vive en el pipeline.
25. [ ] **Confirmar con operaciones el umbral de 7 días** para "abandonado por el TMS".
26. [ ] **Fusionar el conductor duplicado del roster** — dos filas con el mismo nombre; son las 2
    personas ambiguas que la R124 midió. El resolvedor se niega a elegir (correcto) y esos viajes
    quedan sin identificar.
27. [ ] **Borrar `CloseDayDialog.tsx` y sus tests** — 317 líneas, código muerto confirmado: ningún
    archivo de `app/` lo importa.
28. [ ] **UX: el viaje que el TMS cierra y sigue sin conductor** se cae del Monitor "en curso" justo
    cuando todavía hay trabajo. Mismo patrón que resolvió "Abandonados por el TMS" en el Cierre: el
    trabajo no debe desaparecer porque el TMS cambió de estado.
29. [ ] **UX: el alta de conductor no declara lo que cuesta.** Crear una persona dispara sus
    requisitos de Certificación (13 altas costaron 132 registros) y el popover no lo dice. Se
    resuelve en el copy y la fricción del paso de alta, antes de confirmar — no con un modal.
30. [ ] **Medir la densidad del Monitor** antes de opinar sobre su UX. Lo único observado hasta hoy
    es un límite de herramienta leyendo el árbol de accesibilidad (65k caracteres), que **no** es
    evidencia de un defecto de pantalla. Si se aborda, medir columnas, contenido por fila y cuántas
    decisiones caben sin scroll, con benchmark contra SaaS del rubro.

**Corregido al archivar**: el checklist viejo pedía "diseñar (spec nuevo) `app.equipment_day_status`".
**Esa tabla ya existe y tiene datos** — verificado hoy contra producción: 802 filas del 2026-08-01
al 08-14. Lo que falta no es el modelo, es el rediseño de la pantalla que lo usa (ver abajo).

---

## Próxima sesión (actualizado al cerrar la Ronda 125, 2026-08-18)

1. **El click-through del paso "Viajes"** (Task 9 del plan) — **bloqueado por credenciales**. Hay que
   desplegar a dev y tener un usuario real: el servidor redirige a `/login` y `.env.local` sólo trae
   un placeholder. Es lo único que verifica de punta a punta que cerrar un viaje conserva su
   `trip_status` del TMS y que `resolve_trip_fleet()` no pisa la declaración.
2. **El click-through de asignar conductor** (Task 7 del plan anterior) con el viaje **2032999** —
   mismo bloqueo. Ese caso resuelve por **dar de alta** (0 candidatos por contención), no eligiendo.
3. **Decidir el destino del aviso "posterior al cierre"**: hoy informa el número y no lleva a ningún
   lado, porque el Monitor no soporta filtro por URL. O se le agrega, o el aviso queda informativo.
4. **Bajar los tres trinquetes del sistema visual** antes de tocar frontend: color 1779/1780,
   tipografía **279/279**, `<h1>` **9/9**. Dos en margen cero.
5. **Una sola definición del "universo de viajes del día"** — sigue escrito a mano 14 veces (el
   criterio multi-día) y 9 (la exclusión de Sodimac). La Ronda 123 lo alineó pero no lo eliminó, y
   la Ronda 125 tuvo que sacar una quinta copia que había nacido dentro del propio plan.
6. **Absorción dinámica de estados sin mapear** en el catálogo (evidencia: `Cancelado` de Wingsuite
   cae fuera del JOIN porque el catálogo tiene `CANCELADO`).
7. **Fusionar el conductor duplicado del roster** — son las 2 personas ambiguas de la R124.
8. **Borrar `CloseDayDialog.tsx`** y sus tests: código muerto confirmado.

**El estado del Cierre**, verificado el 2026-08-18:

| | |
|---|---|
| Las 3 pantallas viejas | cuentan sobre el mismo universo (R123) |
| Identificar conductor | es un gesto de la tabla del Monitor, en lote (R124) |
| **El paso "Viajes"** | **existe**: 4 grupos, motivo obligatorio, delta posterior al cierre, filtro en el historial (R125) |
| `app.daily_closures` | sigue en **0** — nadie firmó un día todavía |

Lo que falta para que `daily_closures` deje de estar vacío ya no es el paso "Viajes": es el
**recorrido de 4 pasos** (Bloque 1 + §8bis del spec) y que alguien lo use.

Dónde vive el Cierre: `monitor-app/frontend/app/dashboard/operations/closures/` (con `history/`).
Backend: `daily_closures.py`, `equipment_closures.py`, `pre_cierre.py`, `driver_roster.py`,
`fleet_driver_gap.py`, `status_report.py`, y ahora `services/cierre_viajes.py`.

Pendiente de producto que sigue vigente: el **rediseño de Cierres con los 3 formatos fijos por
cliente** (mockups de Figma, refinamiento v2 ítem 6).
