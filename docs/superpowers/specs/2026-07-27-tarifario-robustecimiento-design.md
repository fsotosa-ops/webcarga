# Robustecer Tarifario — diseño

**Fecha**: 2026-07-27
**Contexto**: único bloqueante real que queda para los criterios de entrada al Hito 3 (auditoría 2026-07-27, ver `AGENTLOG.md` Rondas 46-48). Extiende `docs/superpowers/specs/2026-07-22-tarifario-design.md` (Tarifario 1.0) — no lo reemplaza.

## Por qué y qué pidió el usuario

La minuta (§6.2, reunión 10/07) pide un diccionario comuna→zona (RM/Zona Cero/Región Norte/Región Sur) para clasificar automáticamente cada local. Hoy `public.locations.operation_type` es un dato pre-cargado 1:1 desde la planilla del generador de carga — no hay ninguna regla automática, y 262 locales activos no tienen clasificación.

El usuario (Felipe) aclaró el alcance real durante el brainstorming:
- `public.locations` es el diccionario compartido de locales/destinos que usa el Diario para monitorear por zona.
- Tarifario es el módulo que debe centralizar la creación de locales nuevos y funcionar como gestor de tarifas — hoy la UX es poco intuitiva.
- El desafío es robustecer el módulo completo, no solo tapar el hueco de clasificación con un parche de datos.
- Confirmado explícitamente: **no** se reabre el alcance recortado de Tarifario 1.0 (tarifa sigue en texto libre, sin rutas, sin alertas de cobertura).

## Hallazgo clave que cambia el enfoque

Se investigó si construir el diccionario comuna→zona que pide la minuta era necesario. Resultado: **no lo es, para la gran mayoría de los casos**. Cada parada de un viaje ya trae `app.trip_stops.destination_region` (número de región real, reportado por el TMS — ej. "13"=RM, "5"=Valparaíso). Cruzando esto contra los 262 locales sin clasificar:

- **240 de 262** tienen región disponible en su historial de viajes — la regla de la minuta (RM=región 13, Zona Cero=región 5/6/7, Norte/Sur=el resto) se puede aplicar automáticamente sin que nadie cargue nada a mano.
- **22 de 262** no tienen ningún viaje asociado todavía (direcciones de oficina/proveedor tipo "Empresas Carozzi S.A.", nunca aparecieron como destino real) — para esos no hay ninguna señal automática posible, necesitan una elección manual puntual.

Construir y mantener un diccionario completo de ~346 comunas chilenas sería sobre-ingeniería para resolver 22 casos. El diseño usa la región que el TMS ya reporta como fuente automática, y deja la elección manual solo para el residual sin datos.

## Alcance

**Adentro:**
- Clasificación automática RM/Zona Cero/Región Norte/Región Sur desde `destination_region`, con backfill de los locales existentes y auto-clasificación de los nuevos.
- Posibilidad de corregir la clasificación a mano cuando haga falta (override), sin que un futuro viaje la vuelva a pisar.
- Rediseño de la pantalla de Tarifario: sin filtro obligatorio de generador de carga, con una vista de "por revisar" separada de la gestión completa, y la creación de locales como acción siempre visible.

**Afuera (se mantiene la decisión de Tarifario 1.0):**
- Tarifa por ruta/origen, tarifa estructurada/numérica, alertas de cobertura — siguen fuera de alcance.
- Diccionario de comunas completo — no se construye; se usa `destination_region` como fuente primaria y elección manual solo para el residual sin viajes.

## Modelo de datos

`region_number` **ya existe** en `public.locations` (migración `20260717230000`) — hoy solo se llena en el sync inicial desde la planilla, nunca desde los viajes. Solo hace falta agregar el override:

```sql
ALTER TABLE public.locations
  ADD COLUMN is_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN overridden_by      uuid REFERENCES public.profiles(id),
  ADD COLUMN overridden_at      timestamptz;
```

Mismo patrón `is_manual_override`/`overridden_by`/`overridden_at` que ya usa `public.carriers` — nada nuevo que aprender para quien mantenga el código.

**Regla de clasificación** (función SQL, única fuente de verdad — la usan el trigger, el backfill y cualquier reconciliación futura):

```sql
CREATE OR REPLACE FUNCTION app.classify_operation_type(p_region_number smallint)
RETURNS text AS $$
  SELECT CASE
    WHEN p_region_number = 13 THEN 'RM'
    WHEN p_region_number IN (5, 6, 7) THEN 'Z0'
    WHEN p_region_number IN (1, 2, 3, 4, 15) THEN 'Region Norte'
    WHEN p_region_number IN (8, 9, 10, 11, 12, 14, 16) THEN 'Region Sur'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;
```

✅ **Confirmado por el usuario (2026-07-27)**: Región Norte = I-IV y XV; Región Sur = VIII-XII, XIV y XVI. Coincide con la regla de la función de arriba — sin cambios pendientes.

**Backfill** (migración única, corre sobre los 262 locales existentes): para cada local sin `operation_type`, busca la región más frecuente entre sus paradas históricas (`app.trip_stops.destination_region` cruzado por nombre de local) y aplica `app.classify_operation_type()`. Deja `is_manual_override = false` en todos — son inferencias automáticas, no elecciones humanas.

**Trigger existente extendido** (`app.reconcile_new_trip_stop_location`, migración `20260722010000`): hoy solo inserta el local si no existe. Se agrega:
1. Al insertar un local nuevo, calcular `region_number`/`operation_type` desde `NEW.destination_region` si está disponible.
2. Si el local ya existe y sigue sin clasificar (`operation_type IS NULL AND NOT is_manual_override`), completar la clasificación con el primer viaje que traiga región — así los 22 casos residuales se resuelven solos apenas tengan su primer viaje real, sin esperar intervención manual.

## Backend (`app/routers/locations.py`)

- `_LOCATION_FIELDS` suma `region_number`, `is_manual_override`.
- `PATCH /locations/{id}`: cuando el body trae `operation_type`, marca `is_manual_override = true`, `overridden_by = user.sub`, `overridden_at = NOW()` — mismo criterio que ya protege otros campos manuales en el proyecto.
- Nuevo filtro en `GET /locations`: `needs_manual_classification=true` → `operation_type IS NULL AND region_number IS NULL` (el residual real, no todo lo "incompleto" de HU-16 — ver decisión de alcance abajo). Reemplaza el uso que hace hoy el frontend de `incomplete=true` para la tab "Por revisar".

## Frontend (`app/dashboard/tarifario/page.tsx`)

- Se retira el gate de "elegí un generador de carga para ver algo". Dos tabs arriba, mismo patrón visual que Empresas/Seguros (Activas/Inactivo):
  - **"Por revisar" (default)**: locales con `needs_manual_classification=true` — es decir, sin ningún viaje que informe región. Tarjetas simples (no la tabla de 10 columnas), cada una con nombre + generador + selector de zona (RM/Zona Cero/Norte/Sur) para clasificar en un click. **Alcance confirmado con el usuario**: esta tab es solo sobre clasificación de zona, no sobre otros datos incompletos (formato/dirección) — esos se completan en "Todos los locales".
  - **"Todos los locales"**: la tabla completa actual (nombre/formato/dirección/región/clasificación/activo/tarifa/vigencia), con el generador de carga como filtro opcional (chip/select), no como puerta obligatoria. Incluye búsqueda y paginación de servidor, igual que hoy.
- `LocationCreateForm`: el selector de generador de carga se mueve **adentro** del formulario (hoy vive afuera, gateado por la selección de página) — el botón "+ Nuevo local" queda visible arriba en ambas tabs, sin depender de haber elegido un generador antes.
- La columna "Clasificación" en "Todos los locales" muestra si el valor es automático o manual (ej. un tag "auto" junto al badge de zona) — visibilidad simple de cuál es cuál, sin agregar una pantalla nueva.

## Testing

- Backend: `app.classify_operation_type()` (los 4 casos de región + NULL), backfill (script/migración probado contra una copia de los 262 casos reales antes de aplicar en producción), trigger extendido (local nuevo con región disponible queda clasificado sin intervención; local existente sin clasificar se completa solo cuando llega una parada con región; no pisa `is_manual_override=true`), `PATCH /locations/{id}` marca override correctamente, filtro `needs_manual_classification`.
- Frontend: tab "Por revisar" solo lista los casos sin señal, clasificar desde la tarjeta llama `PATCH` con el override esperado, "+ Nuevo local" funciona sin haber seleccionado generador de carga primero, filtro de generador en "Todos los locales" es opcional (la tabla carga sin él).

## Riesgos aceptados

- Los 22 locales sin ningún viaje histórico quedan en "Por revisar" indefinidamente si nunca llega un viaje real hacia ellos y nadie los clasifica a mano — aceptado, es el mismo criterio que ya rige para "local nuevo incompleto" en el resto del proyecto (HU-16).
- Un local cuyo historial de viajes tiene regiones mezcladas (ej. typo del TMS en una parada aislada) se clasifica por la región más frecuente, no por unanimidad — aceptado, mismo criterio pragmático que otras heurísticas del proyecto (ej. dedupe de locales en la carga inicial).
