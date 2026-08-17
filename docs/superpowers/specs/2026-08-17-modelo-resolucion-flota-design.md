# Modelo de resolución de flota — diseño

**Fecha:** 2026-08-17
**Reemplaza:** el Bloque 0 de `2026-08-16-cierre-de-viajes-design.md` y el plan
`2026-08-17-cierre-bloque-0-padron.md`, que atacaban el síntoma (la cobertura del match) y no
la estructura.

---

## 1 · El defecto de raíz

`app.v_trip_fleet_resolution` **resuelve al leer**:

```sql
COALESCE( fl.driver_id,        -- lo guardado
          vda_auto.driver_id,  -- patente → assets → vehicle_driver_assignments
          d_by_name.id )       -- igualdad exacta de nombre contra el roster
```

Tres consecuencias, y la primera sola ya obliga al cambio:

1. **La historia es reescribible.** El nivel 3 compara `drivers.full_name` con el nombre que trae
   el TMS. Corregir la tipografía de un nombre mañana cambia quién aparece como conductor en un día
   cerrado ayer. Un cierre es una afirmación sobre un instante; si se recalcula, no afirma nada.
2. **No hay dónde registrar cómo se resolvió.** Un `driver_id` no dice si salió de una confirmación
   humana o de un match de string con 34% de acierto. Sin eso no se puede priorizar qué revisar, ni
   medir si el sistema mejora.
3. **La regla de identidad está repartida.** `upper(trim())` dentro de la vista, `||'-'||dv` en
   Mage, `rut_dv()` en Python (`document_matcher.py`), funciones en Postgres. Cuatro definiciones de
   "es la misma persona / el mismo vehículo" que pueden divergir sin que nadie se entere.

Todo lo demás que apareció —el 34% de cobertura, el padrón que envejece, la patente con tabulador—
son efectos de esto.

---

## 2 · Las cuatro capas

Cada una tiene un solo trabajo, y ninguna hace el de la siguiente.

```
bronze (crudo) → silver (conformado) → public (maestro) → app (operación)

┌────────────────────────────────────────────────────────────────────────┐
│ 1 · IDENTIDAD    public.canonical_rut() · public.canonical_plate()      │
│                  public.rut_check_digit() · public.is_valid_rut()       │
│                  + trigger + CHECK en las columnas maestras             │
│     Invariante: dos representaciones del mismo RUT no pueden coexistir  │
├────────────────────────────────────────────────────────────────────────┤
│ 2 · DIMENSIÓN    public.vehicle_driver_assignments        (TABLA)       │
│                  ← silver.int_habitual_driver_by_tractor  (vista)       │
│                  ← public.sync_habitual_drivers()   deliberada          │
│     Invariante: un tracto tiene un conductor vigente, no una lista      │
├────────────────────────────────────────────────────────────────────────┤
│ 3 · HECHO        app.trip_fleet_links  (UNIQUE trip_id)                 │
│                  ← app.resolve_trip_fleet()   por TRIGGER, automático   │
│     Invariante: una vez escrita, sólo la cambia una regla de mayor      │
│                 precedencia o una persona                               │
├────────────────────────────────────────────────────────────────────────┤
│ 4 · LECTURA      app.v_trip_fleet_resolution                            │
│                  LEE la capa 3. No resuelve nada.                       │
└────────────────────────────────────────────────────────────────────────┘
```

**La regla que ordena todo:** *el conocimiento fluye hacia abajo, nunca hacia arriba.* La capa 4 no
consulta la 2. La 3 no compara strings al leer. Si una capa necesita algo de dos capas más abajo, la
que está mal es el diseño, no la consulta.

**Dónde vive cada cosa se deriva de esa misma regla.** Las funciones de identidad **restringen tablas
de `public`**, así que van en `public`: ponerlas en `app` haría que la base dependa de lo que
alimenta. El padrón es una **conformación de bronze**, así que va en `silver`, igual que
`int_tms_trips_conformed`. Es además la convención que el proyecto ya seguía —`reconcile_new_driver`
y `reconcile_new_asset` viven en `public` porque sirven tablas de `public`.

**Nomenclatura:** identificadores en inglés, como el resto de la base (`vehicle_driver_assignments`,
`license_plate`, `reconcile_new_driver`); comentarios en español, como el resto del repo.

### 2.1 · Tabla o derivación: la pregunta se responde por capa

| Capa | ¿Tabla o vista? | Por qué |
|---|---|---|
| 2 · `vehicle_driver_assignments` | **Tabla** | Guarda correcciones humanas (dato que no existe en ninguna fuente), tiene vigencia en el tiempo, y operaciones la posee |
| 2 · `int_habitual_driver_by_tractor` | **Vista** | Derivación pura de bronze. Nada que guardar |
| 3 · `trip_fleet_links` | **Tabla** | Es el hecho fechado. Si se recalcula, el cierre no afirma nada |
| 4 · `v_trip_fleet_resolution` | **Vista** | Sólo presenta la 3 |

### 2.2 · Qué corre solo y qué se invoca

| | Cuándo | Por qué |
|---|---|---|
| `sync_habitual_drivers()` | **Deliberado** | Depende de que Mage recargue un Excel que se está muriendo. Un trigger sobre `bronze` pondría lógica de negocio en la capa cruda e invertiría el flujo |
| `resolve_trip_fleet()` | **Trigger, automático** | Ningún viaje puede existir sin intento de resolución. Si depende de que alguien se acuerde, vuelve el problema |

El trigger es `FOR EACH STATEMENT` con tabla de transición, no `FOR EACH ROW`: dbt materializa
`app.trips` con `merge` en lotes de cientos de filas, y el resolvedor arma una tabla temporal por
invocación.

**Y el guardia de reentrada es una bandera de transacción, no `pg_trigger_depth()`** — que vale 1
tanto cuando dispara el merge de dbt (queremos que corra) como cuando dispara el `UPDATE` de
`fleet_link_id` del propio resolvedor (no queremos). Son indistinguibles por profundidad.

---

## 3 · Capa 1 — Identidad

Un identificador tiene **una** forma en la base, y la entrada acepta todas.

| Tipo | Forma canónica | Función | Maestro con CHECK |
|---|---|---|---|
| RUT | `NNNNNNNN-D` | `app.rut_canonico(text)` | `public.drivers.tax_id` |
| Patente | `AAAA99` | `app.patente_canonica(text)` | `public.assets.license_plate` |

**Entrada tolerante, almacenamiento estricto.** Un trigger `BEFORE INSERT OR UPDATE` canoniza lo que
llega; un CHECK garantiza que lo guardado es canónico venga de donde venga. Hacen falta las dos: sólo
con el CHECK, cada escritor tendría que normalizar antes (y Mage escribe `public.drivers` sin pasar
por la API); sólo con el trigger, un `COPY` lo saltearía.

**Dónde SÍ y dónde NO se aplica**, que es la parte que se hace mal:

| Lugar | Qué es | Se restringe |
|---|---|---|
| `public.assets.license_plate`, `public.drivers.tax_id` | **Maestro** | **Sí — CHECK** |
| `app.trips.fleet->>'…'` | Payload crudo del TMS, lo materializa dbt | No. Es la palabra de la fuente |
| `bronze.*` | Crudo por definición | No |
| `app.trip_fleet_links.*_plate` | Copia del crudo al momento de resolver | No |

**El maestro se restringe; la frontera se normaliza al leer.** Y como el maestro ya es canónico por
CHECK, se normaliza **sólo el lado no confiable** — envolver el maestro sería redundante e impediría
usar el índice:

```sql
ta.license_plate = app.patente_canonica(t.fleet->>'tractor_plate')
```

**Dos reglas duras aprendidas ejecutando esto:**

- **`IS NOT DISTINCT FROM`, nunca `=`, en un CHECK que llama a una función que puede dar NULL.**
  `NULL = 'basura'` no es FALSE, es NULL, y **un CHECK con expresión NULL se considera cumplido**:
  el candado aceptaba exactamente lo que venía a rechazar.
- **`trim()` en Postgres saca sólo espacios, no tabuladores.** Por eso `upper(trim())` no es una
  normalización, es una aproximación — y había una patente con tabulador en `assets`.

---

## 4 · Capa 2 — Dimensión: quién maneja qué

`public.vehicle_driver_assignments`, que ya existe con la forma correcta (vigencia por
`status`/`start_date`/`end_date`, e `is_manual_override` como en `assets` y `drivers`).

**Lo que le falta es procedencia, y no es adorno.** Medición del 2026-08-17:

| Antigüedad de la evidencia | Casos | Acierto |
|---|---|---|
| Menos de 3 meses | 673 | **94,2%** |
| Entre 3 y 6 meses | 25 | **4,0%** |

Una asignación derivada de evidencia vieja **no es una conjetura peor: es un nombre casi seguro
equivocado**, y en el Cierre un nombre plausible se confirma solo. Pero `start_date` dice cuándo la
escribimos, no de cuándo es la evidencia: una fila sembrada hoy con evidencia de mayo se ve nueva.

Dos columnas nuevas:

```sql
ALTER TABLE public.vehicle_driver_assignments
    ADD COLUMN source              text NOT NULL DEFAULT 'manual',
    ADD COLUMN source_confirmed_at date;   -- la fecha de la EVIDENCIA, no de la escritura
```

`source ∈ ('manual', 'padron_legacy', 'tms')`.

**La redundancia con `is_manual_override` se vuelve segura haciéndola verificable**, en vez de
confiar en la disciplina:

```sql
CHECK (is_manual_override = (source = 'manual'))
```

Se conserva `is_manual_override` porque es convención del proyecto (`assets`, `drivers`) y hay código
que la lee; romperla en una sola tabla es peor que la redundancia.

**Invariante ya existente y correcto:** `ux_vehicle_driver_assignments_active_asset` — un tracto, un
conductor vigente. Es asimétrico a propósito: **un conductor sí puede manejar varios tractos** (96 de
348 en el padrón; uno llega a 8). El join es por `asset_id`, así que ese caso no duplica nada; el
inverso duplicaría la fila del viaje.

---

## 5 · Capa 3 — El hecho resuelto

`app.trip_fleet_links` deja de ser un backfill congelado y pasa a ser **la respuesta**, una fila por
viaje (`UNIQUE (trip_id)`, ya está), escrita por un resolvedor.

### 5.1 · La precedencia, en un solo lugar

| # | Regla | `driver_match_rule` | Qué la respalda |
|---|---|---|---|
| 1 | Una persona lo dijo | *(NULL — la persona **es** la procedencia)* | Terminal. No la pisa nada |
| 2 | El TMS trae el RUT | `tms_rut` | Identidad directa (hoy: 8 de 1.541) |
| 3 | Patente → padrón vigente | `padron` | 94,2% con evidencia < 3 meses |
| 4 | Nombre exacto contra el roster | `nombre` | 34%. Se registra como tal |
| — | Nada aplica | *(sin fila)* | La celda vacía **hace la pregunta** |

**Corrección sobre la primera versión de este spec:** la regla del match **no** va dentro de
`link_source`. Son dos preguntas distintas —*cómo se creó el vínculo* (`manual` | `auto`) y *cómo se
identificó al conductor*— y meterlas en una columna obliga a inventar un valor para "resolví el
tracto pero no al conductor". Columna propia, `NULL` cuando no hay conductor:

```sql
ALTER TABLE app.trip_fleet_links
    ADD COLUMN driver_match_rule text,
    ADD COLUMN resolved_at       timestamptz;
ALTER TABLE app.trip_fleet_links ADD CONSTRAINT tfl_driver_match_rule_check
    CHECK (driver_match_rule IS NULL OR driver_match_rule IN ('tms_rut','padron','nombre'));
```

**`driver_match_rule` es la columna que convierte el sistema en medible.** Con ella se responde
"¿cuántos cierres de esta semana se apoyan en un match de nombre?" y se prioriza. Con un booleano, no.

### 5.2 · No resolver es una respuesta

Cuando ninguna regla aplica **no se escribe fila**. Un conductor equivocado pero plausible se
confirma sin que nadie lo mire; un vacío obliga a decidir. Es la misma razón por la que el sembrado
descarta la evidencia vieja en vez de usarla.

### 5.3 · Cuándo se resuelve

Al aparecer o cambiar el viaje. `app.trips` la materializa dbt con `merge`, así que el disparador es
un **trigger `AFTER INSERT OR UPDATE` sobre `app.trips`**, declarado en el `post_hook` del modelo dbt
—que es como el proyecto ya declara sus triggers— y una función re-ejecutable para reprocesar a mano.

**El resolvedor nunca toca una fila `manual`.**

---

## 6 · Capa 4 — La vista, degradada a lectora

```sql
CREATE OR REPLACE VIEW app.v_trip_fleet_resolution AS
SELECT t.id AS trip_id,
       fl.carrier_id       AS resolved_carrier_id,
       fl.driver_id        AS resolved_driver_id,
       fl.tractor_asset_id AS resolved_tractor_asset_id,
       fl.link_source,
       da.carrier_id       AS resolved_driver_home_carrier_id
FROM app.trips t
LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
LEFT JOIN public.driver_assignments da ON da.driver_id = fl.driver_id AND da.status='ACTIVE';
```

De siete JOIN a dos. **Los 5 routers y 18 lugares que ya la consumen no cambian una línea** — misma
firma, más columnas. Y ganan `link_source` gratis.

---

## 7 · Qué se gana, en propiedades

| Propiedad | Antes | Después |
|---|---|---|
| Un día cerrado no cambia | No: se recalcula al leer | **Sí**: es un hecho guardado |
| Se sabe cómo se resolvió | No | **Sí**: `link_source` |
| Corrección humana estable | Frágil | **Terminal** por precedencia |
| Definición de identidad | 4 dispersas | **1 por tipo** |
| Costo de lectura | 7 JOIN con funciones | **2 JOIN por índice** |
| Se puede medir la calidad | No | **Sí**: `GROUP BY link_source` |

---

## 8 · Estado — todo aplicado el 2026-08-17

| Capa | Migración | Resultado medido |
|---|---|---|
| 1 · Identidad | `20260817120000_identidad_canonica.sql` | 79/79 RUT y 118/118 patentes canónicos; `GBVC90⇥` limpiada |
| 2 · Dimensión | `20260817120100_capa2_padron_y_dimension.sql` | **46 asignaciones sembradas, 419 descartadas por viejas** |
| 3 + 4 | `20260817120200_capa3_4_resolucion_materializada.sql` | **1.443 viajes materializados** |

Las capas 3 y 4 van **en la misma migración**: entre una y otra la vista leería una tabla a medio
llenar.

### 8.1 · Verificación contra producción

**El número que abrió el caso.** El 14/08 el Cierre mostraba **12 conductores contra 29 tractos**, y
cerrar exigía justificar ~17 ausencias falsas:

| Día | Viajes | Tractos | Conductores | Resuelto |
|---|---|---|---|---|
| 11/08 | 43 | 28 | 23 | 70% |
| 12/08 | 43 | 28 | 22 | 72% |
| 13/08 | 33 | 26 | 22 | 79% |
| **14/08** | 47 | **32** | **28** | **85%** |
| 15/08 | 33 | 28 | 24 | 82% |
| 16/08 | 16 | 13 | 10 | 81% |

**Sin duplicación:** `1.541 filas = 1.541 viajes distintos = 1.541 en app.trips`.

**Reparto por regla**, que es lo que antes no se podía preguntar:

| Regla | Viajes |
|---|---|
| `padron` | 1.154 |
| *(sin conductor)* | 271 |
| `nombre` — el match débil, ahora visible | 27 |
| `tms_rut` | 7 |
| `manual` — las 9 correcciones humanas, intactas | 9 |

## 8.2 · Pendiente en Mage

Los dos triggers **se pierden con un `dbt --full-refresh`** (hace `DROP` + `CREATE TABLE AS SELECT`).
Hay que agregarlos al `post_hook` del modelo `app/trips.sql`, junto a `trg_protect_manual_overrides`,
que está ahí por exactamente esta razón. El push a Mage lo bloquea el clasificador de permisos: las
dos líneas están al pie de la migración de la capa 3, listas para pegar.

Lo mismo con `silver.int_habitual_driver_by_tractor`: debería ser un modelo dbt como el resto de
`silver`, y está creada por migración por el mismo bloqueo.

---

## 9 · Lo que se descarta, y por qué

- **Tabla nueva de padrón.** `vehicle_driver_assignments` es exactamente eso. Crear otra sería un
  segundo lugar donde vive el mismo hecho.
- **Normalizar las cuatro columnas de patente.** Tres son crudo o copia de crudo. Restringir el
  crudo pierde la evidencia de lo que la fuente realmente dijo.
- **Resolver en el backend.** Mage escribe `public.drivers` sin pasar por la API: una regla que vive
  en Python no ve la mitad de las escrituras.
- **Cruzar con el legacy por día.** Sus despachos cortan el 2026-07-31: en agosto resuelve 0 de 528.
  Como padrón resuelve 528 de 528.
