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

**Corregido al archivar**: el checklist viejo pedía "diseñar (spec nuevo) `app.equipment_day_status`".
**Esa tabla ya existe y tiene datos** — verificado hoy contra producción: 802 filas del 2026-08-01
al 08-14. Lo que falta no es el modelo, es el rediseño de la pantalla que lo usa (ver abajo).

---

## Próxima sesión (actualizado al cerrar la Ronda 122, 2026-08-17)

**Por dónde empezar, en orden.** Los dos primeros están escritos y listos para ejecutar; no hay que
volver a diseñar nada.

1. **Asignar conductor desde el Monitor** —
   `docs/superpowers/plans/2026-08-17-asignar-conductor-desde-el-monitor.md`, 7 tareas, con el
   código de cada test ya escrito. Mockups aprobados en `docs/superpowers/mockups/`. Arranca por
   quitar la exigencia de `carrier_id` en `POST /trips/{id}/fleet-link`, que es el bug reportado
   (viaje `2032999`: forzar el conductor no guardaba nada).
2. **Plan 3 — el recorrido del Cierre** (Bloques 1, 2, 4, 5 del spec del Cierre). Diseñado en su
   §8bis; falta escribir el plan. **Nada bloqueado por terceros.**

**El estado del denominador, que era lo que trababa todo.** Verificado contra producción el
2026-08-17, después de aplicar el modelo de resolución de flota:

| | |
|---|---|
| Resolución del conductor | 60-88% por día, y **de la palabra del TMS**, no de una inferencia |
| Sin identificar | **27 personas** (no 350 viajes) — 7,7 viajes cada una |
| `app.daily_closures` | sigue en **0** — nadie cerró un día todavía |

La brecha que hacía imposible cerrar —12 conductores contra 29 tractos el 14/08— **ya no existe**.
Lo que falta para que `daily_closures` deje de estar vacío es la interfaz, no el dato.

Dónde vive el Cierre: `monitor-app/frontend/app/dashboard/operations/closures/` (con `history/`) y
el overlay "Cerrar el día". Backend: `daily_closures.py`, `equipment_closures.py`, `pre_cierre.py`.

Pendiente de producto que sigue vigente: el **rediseño de Cierres con los 3 formatos fijos por
cliente** (mockups de Figma, refinamiento v2 ítem 6).
