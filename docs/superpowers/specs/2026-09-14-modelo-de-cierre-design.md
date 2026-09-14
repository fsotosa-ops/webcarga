# Modelo de cierre: un período, líneas de conciliación, y un día firmado que no se mueve

> Estado: **diseño aprobado en conversación, sin implementar.**
> Pedido del usuario (14/09): *"debería haber un modelo para gestionar los cierres… necesito que
> sea robusto, escalable y mantenible"*, después de señalar que agregar una tercera columna de
> comentario era construir un frankenstein. Tenía razón.

## Por qué

El Cierre creció por ejes: primero conductores, después tractos copiando el de conductores, y
después viajes sin tabla propia. Hoy hay **cinco almacenamientos y dos firmas** para un solo acto.
No es una crítica de estilo: produce defectos medibles.

### Lo que está roto, medido contra producción el 14/09

**1. Un día firmado sigue cambiando.** La firma vive en una tabla y las cifras en otra que se
recalcula en cada `GET`. De 7 días firmados, **6 se recalcularon después de firmarse**:

| Día | Firmado | Último recálculo |
|---|---|---|
| 03-09 | 04-09 | 09-09 |
| 07-09 | 08-09 | 14-09 22:37 — al abrir la pantalla |
| 11-09 | 11-09 | 14-09 20:24 |

**2. Un día puede estar cerrado y abierto a la vez.** El 03-09 está firmado en `daily_closures` y no
en `equipment_closures`. Son dos cabeceras independientes con dos `POST /close` encadenados desde el
frontend: si el segundo falla, el día queda medio firmado y nada lo dice.

**3. La seguridad se perdió al copiar.** `daily_closures` y `driver_day_status` tienen RLS activa con
su política de lectura. Sus gemelas `equipment_closures` y `equipment_day_status` tienen **RLS
apagada y cero políticas**. Nadie lo decidió; se copió la tabla y no el paso de seguridad.

**4. El eje de viajes no tiene dónde guardar nada.** No hay tabla: declarar un viaje escribe
`is_active=false` + `unassigned_reason_id` **sobre `app.trips`**, que es una tabla materializada por
dbt. De ahí salen `merge_exclude_columns`, `manually_edited_fields` y el trigger
`protect_manual_overrides` — y de ahí salió la familia de bugs de la Ronda 158 completa. Y como no
hay fila, ese eje no puede tener `resolved_by`, `resolved_at` ni comentario.

**5. Cuatro columnas de comentario, cero texto.** `driver_day_status.comentario`,
`equipment_day_status.comentario`, `app.trips.comments` y `app.trips.notes`: las cuatro vacías.
Mientras tanto `app.trip_notes` —con feed, autor, tipo, fijar y resolver— tiene 13 notas humanas y
es el único mecanismo vivo.

## El patrón

Esto es un **cierre de período con conciliación de excepciones**. La misma forma que el cierre
contable mensual, el cuadre de inventario y —el análogo más cercano— el **cierre de turno en
manufactura**: cada máquina-hora del período tiene que quedar explicada, y lo que no produjo exige un
código de motivo de un catálogo controlado antes de poder cerrar el turno.

Es literalmente el caso: cada tracto y cada conductor de un día tienen que quedar explicados.

Tres piezas:

1. **Período** con máquina de estados, uno por día — se cierra *un día*, no "un día de tractos".
2. **Líneas de conciliación**: una por (período, sujeto), con el sujeto polimórfico.
3. **Congelamiento al cerrar**: cerrado el período, las líneas no se recalculan más.

## El modelo

Dos tablas donde hoy hay cinco almacenamientos. El catálogo de motivos (`app.status_taxonomies`) no
se toca, y `app.trip_notes` se queda como la bitácora del Monitor — decisión del usuario.

### `app.closure_periods`

```sql
business_date   date PRIMARY KEY
status          text NOT NULL CHECK (status IN ('OPEN','CLOSED'))
closed_by       uuid REFERENCES auth.users(id)
closed_at       timestamptz
reopened_by     uuid REFERENCES auth.users(id)
reopened_at     timestamptz
reopen_note     text
override_count  int  NOT NULL DEFAULT 0
override_note   text
frozen_totals   jsonb          -- las cifras al momento de firmar
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
```

`frozen_totals` guarda lo que hoy son columnas sueltas de las dos cabeceras (`total_drivers`,
`resolved_count`, `total_equipment`, `total_trips`). Van en `jsonb` **y no en columnas** porque son
una foto de cifras derivadas: cada eje nuevo agregaría dos columnas a una tabla que sólo las
reporta. No se consultan por valor, se muestran.

### `app.closure_lines`

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
business_date   date NOT NULL REFERENCES app.closure_periods(business_date)
subject_type    text NOT NULL CHECK (subject_type IN ('DRIVER','ASSET','TRIP'))
subject_id      uuid NOT NULL          -- polimórfico, sin FK (ver más abajo)
status          text NOT NULL          -- ASSIGNED | UNASSIGNED | MISMATCH
requires_reason boolean NOT NULL DEFAULT true
reason_id       uuid REFERENCES app.status_taxonomies(id)
comentario      text
resolved_by     uuid REFERENCES auth.users(id)
resolved_at     timestamptz
computed_at     timestamptz NOT NULL DEFAULT now()
UNIQUE (business_date, subject_type, subject_id)
```

**`subject_id` va sin FK y es a propósito.** Es polimórfico —apunta a `public.drivers`,
`public.assets` o `app.trips` según `subject_type`— y Postgres no permite una FK condicional. El
proyecto ya tiene este patrón en `public.audit_log` y en `compliance_records`, y ya tiene la lección
anotada: filtrar un `entity_id` polimórfico sin filtrar también por tipo da falsos negativos. La
integridad se cuida con un trigger de validación, no con una FK.

**Índices**: `(business_date, subject_type)` para la lectura de cada pestaña, y
`(subject_type, subject_id)` para "¿qué pasó con este tracto en los últimos 30 días?", que hoy no se
puede preguntar sin recorrer dos tablas.

**RLS desde la migración, no después.** Lectura para `authenticated`, escritura por el rol `writer`
vía el backend, mismo criterio que `driver_day_status`. Es el paso que se perdió al copiar el eje de
tractos y no se puede volver a perder.

### El congelamiento

El recompute pasa a ser: `if period.status = 'CLOSED': no recalcular`. Una sola línea, y es la que
convierte la firma en una firma. Hoy esa condición no existe en ningún lado.

**Reabrir es un acto explícito**: endpoint propio, rol admin, nota obligatoria, y queda en
`reopened_by`/`reopened_at`/`reopen_note`. Hoy se reabre sin querer, con sólo entrar a la pantalla.

### El eje de viajes

Gana su fila con `subject_type='TRIP'`, y con ella `resolved_by`, `resolved_at` y comentario, que hoy
no puede tener.

**Decisión de cutover a tomar**: hoy declarar un viaje escribe `is_active=false` en `app.trips`, y el
Diario lee esa columna para saber si un viaje sigue abierto. Dos caminos:

- **(a) Mantener el `is_active` como proyección.** El cierre escribe la línea Y apaga el viaje. El
  Diario no cambia. Sigue existiendo la escritura sobre la tabla de dbt, con su trigger.
- **(b) El Diario le pregunta a las líneas.** `is_active` deja de escribirse a mano y vuelve a ser
  100% derivado del TMS. Desaparece el `manually_edited_fields` para este caso y con él la familia de
  bugs de la Ronda 158. Cuesta tocar el Diario, que es la pantalla más usada.

**Recomiendo (b)**, pero en una ola posterior: (a) durante el cutover para no mover el Diario y la
migración a la vez, y (b) cuando las líneas ya sean la fuente de verdad. Escrito acá para que no se
quede en (a) por inercia, que es como (a) se vuelve permanente.

## Qué se retira, y cuándo

| Objeto | Filas | Cuándo |
|---|---|---|
| `app.daily_closures` | 7 | migrar a `closure_periods`, después retirar |
| `app.equipment_closures` | 6 | idem, fusionando por `business_date` |
| `app.driver_day_status` | 1.928 | migrar a `closure_lines` con `subject_type='DRIVER'` |
| `app.equipment_day_status` | 2.613 | idem con `'ASSET'` |
| `app.trips.comments` / `.notes` | 0 | `DROP`, nunca se usaron |

Los motivos ya escritos se conservan: cambian de fila, no de significado. **Son 294 al 14/09 y el
número se mueve** —el recompute limpia el motivo cuando una fila pasa a Asignada—, así que la
migración tiene que contar antes de correr y no confiar en una cifra escrita acá. **Se retiran en una ola
aparte y después de que el modelo nuevo esté sirviendo en producción**, no en la misma migración —
este proyecto ya tiene anotado que borrar y migrar juntos deja sin red.

## Lo que no resuelve, y hay que decir

- **Concurrencia.** Dos personas firmando el mismo día necesitan un bloqueo sobre el período
  (`SELECT ... FOR UPDATE` al cerrar). Hoy no hay ninguno y el modelo nuevo no lo agrega solo.
- **Las escalaciones del pre-cierre** (`PATENTE_NO_REGISTRADA`, `CONDUCTOR_NO_REGISTRADO`,
  `EMPRESA_NO_RECONOCIDA`, `EMPRESA_ONBOARDING`) se calculan al vuelo y no se guardan. Quedan igual:
  son del pre-cierre, no del cierre. Anotado para no confundirlo con un olvido.
- **No cambia ninguna regla de negocio.** Mismos estados, mismo catálogo, mismo override de admin con
  nota obligatoria, mismas cuatro escalaciones que bloquean. Es dónde vive el dato, no qué significa.

## Olas

| Ola | Qué | Reversible |
|---|---|---|
| 1 | Las dos tablas, con RLS e índices. Nadie las lee todavía | sí, `DROP` |
| 2 | Migración de datos y doble escritura: el cierre escribe en lo viejo **y** en lo nuevo | sí |
| 3 | La lectura pasa a `closure_lines`. El congelamiento entra acá | sí, se vuelve la lectura |
| 4 | El eje de viajes gana su línea; se unifican los dos `POST /close` en uno | — |
| 5 | Se retira lo viejo y se apaga la doble escritura | no |

La doble escritura de la ola 2 es la red: mientras las dos vistas coincidan, volver atrás es cambiar
de dónde se lee. **La comparación de las dos durante unos días es la prueba de aceptación**, no un
test.

## Cómo se verifica

- Las consultas nuevas **contra la base real antes de cualquier mock** — regla del proyecto.
- **La prueba que cierra el diseño**: firmar un día, abrir la pantalla, y que `computed_at` de sus
  líneas **no** cambie. Hoy eso falla en 6 de 7 días y es reproducible a mano.
- Durante la ola 2, un chequeo diario de que lo viejo y lo nuevo dan lo mismo, fila por fila.
- Tests por mutación: revertir el congelamiento, revertir la RLS y revertir la unicidad
  `(business_date, subject_type, subject_id)` tienen que poner algo en rojo.
