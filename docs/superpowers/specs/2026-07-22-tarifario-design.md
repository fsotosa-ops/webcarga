# Tarifario 1.0 — diseño

**Fecha**: 2026-07-22
**Fase**: 5 (última del roadmap post-refinamiento de las 17 HU, `AGENTLOG_ARCHIVE.md` Ronda 34)
**HU relacionada**: HU-17 (backlog `weekly-20260720.md`)

## Contexto y por qué el alcance quedó tan acotado

HU-17 original: *"administrar un tarifario basado en local, origen, zona y tarifa... el tarifario considera local, nombre favorito, origen, zona y tarifa."* La reunión real del 20/07 (Pablo, CEO) agregó un ejemplo concreto — tarifa por ruta (CD Peñón → local Tres Poniente) — y una regla de negocio: alertar cuando el TMS reporta algo nuevo sin tarifa.

Durante el brainstorming se exploró primero un diseño fiel a ese ejemplo (tarifa por par origen→destino, reutilizando `public.locations` para ambos extremos, con alertas de cobertura). El usuario lo cortó explícitamente:

> "No implementemos nada de las tarifas. Está fuera del alcance del proyecto, solo agrega el módulo al sidebar y su page donde puedan poner el válido desde/hasta y un campo para definirlo."

Y sobre por qué un campo de tarifa estructurado (numérico) no calza:

> "es que el tarifario va a depender del contexto del viaje"

Es decir: la tarifa real depende de contexto (tipo de carga, condiciones negociadas, etc.) que este proyecto no modela y no le corresponde modelar todavía. Imponerle una estructura numérica sería falsa precisión. **Este documento describe la versión mínima que el usuario confirmó**, no el diseño original de rutas/alertas — ese quedó explícitamente descartado, no diferido.

## Alcance

**Adentro:**
- Nuevo ítem de menú "Tarifario", al mismo nivel que Diario/Empresas/Seguros (no anidado, no bajo Configuración — pedido explícito de Pablo en la reunión).
- Una página que, por generador de carga, lista sus locales (mismo catálogo de `public.locations` que ya construyó la Fase 4) y permite:
  - Ver/editar la tarifa vigente de cada local (texto libre) + vigencia (válido desde/hasta).
  - Crear locales nuevos directamente ahí (mismo flujo que ya existe en Configuración → Locales) — la página es, en palabras del usuario, *"el motor de update de public.locations también y al tarifario"*.
- Historial de tarifas preservado (cada cambio de tarifa es una fila nueva, no un `UPDATE` que pisa la anterior) — confirmado explícitamente por el usuario.

**Afuera (decisión explícita, no un gap):**
- Cualquier noción de origen/ruta (CD → local). El campo "origen" de HU-17 no se implementa.
- Alertas de "ruta sin tarifa" o cualquier detección automática de cobertura.
- Cálculo, validación o suma de tarifas — el campo es texto libre sin semántica numérica.
- "Nombre favorito" — estaba en el diseño intermedio (fiel al HU-17 literal) pero no se retomó después del recorte de alcance; no se incluye en esta versión. Si se quiere después, es una columna nullable en `locations`, cambio de bajo riesgo.

## Modelo de datos

Dos tablas, mismo patrón que ya usa el proyecto para "entidad descriptiva actual" vs. "historial de eventos sobre esa entidad" (`carriers`/`drivers`/`assets` vs. `compliance_records`/`insurance_policies`):

```sql
CREATE TABLE public.location_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  tarifa      text NOT NULL,        -- texto libre, sin semántica numérica
  valid_from  date NOT NULL DEFAULT CURRENT_DATE,
  valid_to    date,                 -- NULL = vigente indefinidamente
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.profiles(id)
);

CREATE INDEX idx_location_rates_location ON public.location_rates (location_id, valid_from DESC);
```

RLS: mismo criterio que `locations` — `SELECT` para `authenticated`, escritura vía API con `require_editor` (sin policy de escritura abierta a nivel de fila, todo pasa por el backend).

**Por qué tabla separada y no columnas en `locations`**: `locations` es consumida hoy por el Diario (clasificación RM/Zona Cero) y por el banner de completitud de Fase 4 — ninguno de esos consumidores necesita saber de tarifas ni de su historial. Meter `tarifa`/`valid_from`/`valid_to` ahí como columnas mutables perdería el historial que el usuario pidió explícitamente conservar (un `PATCH` normal las pisaría, igual que hoy pisa `address`/`format`). Separar evita forzar a todo el resto del sistema a filtrar "fila vigente" quando le es irrelevante.

**"Vigente" se calcula, no se almacena**: `valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`.

## Backend

`app/schemas/location_rate.py`:
```python
class LocationRateCreateBody(BaseModel):
    tarifa: str
    valid_from: date = Field(default_factory=date.today)
    valid_to: Optional[date] = None
```

`app/routers/locations.py` (se extiende el router existente, no uno nuevo — mismo dominio):
- `GET /locations?entity_type=SHIPPER&entity_id=&include_rate=true` — agrega `current_rate`/`current_rate_valid_from`/`current_rate_valid_to` por local vía `LEFT JOIN LATERAL` contra `location_rates` (la fila vigente, `ORDER BY valid_from DESC LIMIT 1`). `include_rate` es opt-in — la Diario y Configuración → Locales no lo piden, sin cambio de comportamiento para ellos.
- `GET /locations/{id}/rates` — historial completo, para cuando se quiera ver qué regía en una fecha pasada (no hay UI para esto en 1.0, pero el endpoint es trivial de construir junto con el resto y deja la puerta abierta).
- `POST /locations/{id}/rates` — nueva fila (nuevo período de vigencia), `require_editor`. No cierra automáticamente la vigencia anterior — el usuario que carga la tarifa nueva decide si quiere ponerle `valid_to` a la anterior vía `PATCH` (ver abajo) o dejarlas superpuestas; no hay validación de solapamiento en 1.0 (nadie lo pidió, y agregarla sin que la UI la exponga sería complejidad sin uso).
- `PATCH /locations/{id}/rates/{rate_id}` — corrige una fila existente sin crear historial nuevo (ej. typo en el texto de la tarifa). Acepta los mismos 3 campos que el `create` (`tarifa`/`valid_from`/`valid_to`), todos opcionales, mismo patrón `sent_fields()`/`COALESCE` que `LocationPatchBody` — mismo criterio que otros módulos permiten corregir sin generar ruido.

## Frontend

- `Sidebar.tsx`: nuevo ítem plano "Tarifario" → `/dashboard/tarifario`, mismo nivel que Diario/Empresas/Seguros. Ícono `Receipt` (lucide-react) — distinto de los ya usados por el resto del menú.
- `app/dashboard/tarifario/page.tsx`: mismo patrón que `locales-tab.tsx` (selector de generador de carga → tabla), con `locationsApi.list({ entity_type: 'SHIPPER', entity_id, include_rate: true })`. Columnas: N° Local, Nombre, Formato, Dirección, Región, Clasificación, **Tarifa vigente** (input de texto), **Válido desde**, **Válido hasta**, Activo. Guardar tarifa/vigencia dispara `POST /locations/{id}/rates` (nueva fila = nuevo período), no un `PATCH` sobre el local.
- Reutiliza `EMPTY_LOCATION`/flujo de creación de local ya existente en `locales-tab.tsx` — se factoriza a un componente/hook compartido en `./shared` en vez de duplicar el formulario completo, dado que la lógica (validación de nombre, POST, manejo de error 409 por duplicado) es idéntica a la de Configuración → Locales.
- Sin alertas, sin badges, sin banner de "sin tarifa" — la tabla en sí ya deja ver a simple vista qué locales tienen la columna Tarifa vacía.

## Testing

- Backend: tests de `GET /locations?include_rate=true` (agrega las 3 columnas, resuelve la vigente cuando hay varias filas históricas), `POST /locations/{id}/rates` (crea fila, requiere editor), `PATCH` (corrige sin crear fila nueva). Mismo patrón de mocking (`AsyncMock`/`wire_transactional_conn`) que `test_locations.py`.
- Frontend: si se factoriza el formulario de "nuevo local" a un componente compartido, tests unitarios sobre ese componente en vez de duplicar los que ya cubren `locales-tab.tsx`. La página de Tarifario en sí: al menos un test de que la tarifa se guarda vía `POST` (no `PATCH` del local) y que el historial se refleja al recargar.

## Riesgos conocidos, aceptados explícitamente

- **Texto libre sin validación** — dos filas con formato distinto ("$450.000" vs "450000 CLP") son intencional, no un bug: el usuario decidió que la variabilidad de contexto hace prematura cualquier estructura.
- **Sin detección de "falta tarifa"** — un local puede quedar indefinidamente sin ninguna fila en `location_rates` y nada lo señala. Aceptado: el usuario explícitamente sacó esto del alcance.
- **Duplicación del formulario de creación de local** entre esta página y Configuración → Locales, si no se factoriza en la implementación — a resolver ahí, no es una decisión de diseño abierta (la sección de Frontend arriba ya especifica reutilizar, no duplicar).
