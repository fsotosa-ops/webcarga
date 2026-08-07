# Rediseño del scraper IANSA (QAnalytics) — Design

## Contexto

El pipeline `batch_tms_monitor_trips` viene fallando en los bloques `qanalytics_endpoint_sap` (Walmart, ya conocido de la ronda 93) y `qanalytics_endpoint_scraper_iansa`. Investigando este último se confirmó una causa raíz mucho más profunda que un fallo puntual: **el scraper de IANSA apunta a la página equivocada dentro de QAnalytics**.

Hoy, `custom/qanalytics_endpoint_scraper_iansa.py` llama a `extraction_service` con `source="qanalytics", product="trips", client_name="iansa"` — el mismo extractor genérico de "Monitor de Viajes" que usa Walmart, solo cambiando el nombre de cliente en el login. Verificado en vivo: IANSA es en realidad un **tenant completamente separado** dentro de QAnalytics (portal branding "mmPFQ S.A.", con logo IANSA), con su propio menú ("Reportes → Reporte Detalle") y su propia página real:

```
https://www.qanalytics.cl/qnew/gestion_reporte_detalle_cumplimiento_iansa_trans.aspx
```

Esta página tiene una estructura de formulario y exportación distinta a las 3 que ya soporta `extraction_service` (Monitor de Viajes, Cumplimiento SAP, Cumplimiento Citas): campos de fecha `#txt_f1`/`#txt_f2` (no `#txt_fecini`/`#txt_fecfin` ni variantes), búsqueda vía `#btnImg` (no `#btn_buscar`), exportación vía botón submit `#BtExportar` (no el link `onclick="exportar_tabla()"` que reutilizan los otros 3 reportes).

**Consecuencia ya confirmada en `stg_qanalytics_trips.sql`**: existe un fix documentado del 2026-07-18 ("Fase 0, bug IANSA") que reconoce que el payload de IANSA no trae `Estado` como el resto de QAnalytics — es decir, `raw_estado` viene `NULL` en el 100% de los viajes IANSA actuales, porque el payload viene de la página incorrecta. Los datos de IANSA en `bronze`/`app.trips` hoy son estructuralmente válidos pero de la fuente equivocada — no son "casi correctos", son de otro reporte.

## Decisiones confirmadas con el usuario

1. **Reemplazo completo**: el nuevo extractor reemplaza por completo el uso de `product="trips"` para IANSA. No se mantienen ambas fuentes en paralelo.
2. **Alcance de cadena completa**: el plan cubre scraper (`extraction_service`) + transformer de Mage + ajuste dbt — no solo el scraper. Dejar solo el scraper arreglado produciría un tipo de dato roto distinto (columnas del reporte nuevo no reconocidas por el mapeo viejo del transformer).
3. **Limpieza de histórico incluida**: el borrado de los datos IANSA existentes (derivados de la página incorrecta) es un paso explícito de este plan, no una decisión aparte para después.
4. **Modelo dbt**: se extiende `stg_qanalytics_trips.sql` (mismo modelo que ya sirve a Walmart) en vez de crear un modelo dbt paralelo — sigue el patrón COALESCE genérico ya usado en el fix de Fase 0, sin ramas `WHEN source_client = 'iansa'`.
5. **Escalabilidad del transformer de Mage**: el transformer de IANSA se construye con mapeo de columnas en un módulo de configuración compartido (`utils/qanalytics_tenant_column_maps.py`), no hardcodeado inline como hoy. El transformer de Walmart (`qanalytics_agg_nro_sap_transformer.py`) **no se toca en este plan** — migrarlo a la misma convención, y evaluar consolidar las 5 cadenas de bloques Mage duplicadas por tenant en un diseño multi-tenant más escalable, queda documentado como **must-have para el hardening posterior al cierre de MVP/Hito 4** (ver sección Backlog).

## Arquitectura

### 1. Extracción (`extraction_service`)

Nuevo archivo `app/tms/qanalytics/cumplimiento_iansa.py`, subclase de `QAnalyticsExtractor` (mismo patrón que `cumplimiento_sap.py`/`cumplimiento_citas.py`):

```python
class QAnalyticsCumplimientoIansaExtractor(QAnalyticsExtractor):
    PRODUCT_NAME = "cumplimiento-iansa"

    async def _navigate_to_distribucion(self, page, client_name, timeout_ms):
        # IANSA vive en un tenant separado (mmPFQ S.A.) — alcanzable
        # directo por URL tras el login, sin pasar por ningún dropdown
        # de módulo (confirmado en vivo 2026-08-07).
        await page.goto(
            "https://www.qanalytics.cl/qnew/"
            "gestion_reporte_detalle_cumplimiento_iansa_trans.aspx",
            timeout=timeout_ms,
        )
        await page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)

    async def _set_date_range(self, page, date_from, date_to):
        # Selectores propios de esta página: #txt_f1 / #txt_f2
        ...

    async def _submit_search(self, page, timeout_ms):
        # Override nuevo — esta página no tiene #btn_buscar, usa #btnImg
        ...

    async def _download_export(self, page, client_name, timestamp,
                                date_from, date_to, downloads_dir, timeout_ms):
        # Override nuevo — exportación vía submit #BtExportar, no el
        # link onclick="exportar_tabla()" que reutilizan SAP y Citas.
        # Mecanismo exacto (descarga directa vs. postback) PENDIENTE DE
        # VERIFICAR EN VIVO durante implementación.
        ...
```

Registro en `factory.py`:
```python
("qanalytics", "cumplimiento-iansa"): QAnalyticsCumplimientoIansaExtractor(),
```

`_submit_search` y `_download_export` no existían como overrides en `cumplimiento_sap.py`/`cumplimiento_citas.py` porque esas 2 páginas sí comparten esos mecanismos con la base — esta es la primera página que también los cambia, así que ambos métodos de `QAnalyticsExtractor` pasan a ser oficialmente parte del contrato de extensión (ya lo eran implícitamente, quedan documentados como tal).

### 2. Mage — bloques

- **`custom/qanalytics_endpoint_scraper_iansa.py`**: cambiar `payload["product"]` de `"trips"` a `"cumplimiento-iansa"`.
- **Nuevo `utils/qanalytics_tenant_column_maps.py`**: módulo de configuración compartido, no un bloque de pipeline:
  ```python
  TENANT_COLUMN_MAPS = {
      "iansa": {
          "cols_viaje":  [...],  # confirmar contra el reporte real antes de escribir
          "cols_parada": [...],
      },
  }
  ```
  Sembrado solo con `"iansa"` en este plan. La forma del dict ya soporta agregar tenants futuros sin tocar código de transformer — es la pieza que hace el patrón escalable, aunque solo tenga una entrada por ahora.
- **`custom/qanalytics_agg_iansa_transformer.py`**: reemplazar las listas `cols_viaje_esperadas`/`cols_parada_esperadas` hardcodeadas por `from utils.qanalytics_tenant_column_maps import TENANT_COLUMN_MAPS` + lookup por `"iansa"`. El resto de la lógica (ffill, agrupación por `Viaje`, dedupe) se mantiene — **pendiente confirmar si el reporte nuevo tiene una columna equivalente a `"Viaje"` para agrupar**, dato a verificar contra la tabla real.
- **`data_loaders/processor_qanalytics_iansa_files.py`**: el prefijo GCS hardcodeado `tms/qanalytics/trips/iansa/` pasa a `tms/qanalytics/cumplimiento-iansa/iansa/` (sigue el nuevo `product` vía `build_path()` de `extraction_service`).

### 3. dbt

`models/silver/stg_qanalytics_trips.sql`:
- CTE `snapshot_ranked`: `WHERE product = 'trips'` → `WHERE product IN ('trips', 'cumplimiento-iansa')`.
- CTE `trips_metadata`/`stops_enriched`: extender los COALESCE ya existentes (`raw_estado`, `raw_origen_fallback`, `Local`/`Destino` en paradas) con las columnas reales del reporte nuevo, una vez confirmadas — mismo principio ya documentado ahí ("genérico a propósito, no un WHEN source_client").

### 4. Limpieza de histórico

Ejecutado como SQL directo (no como parte de un modelo dbt), con conteos antes/después y solo con confirmación explícita en ese paso — mismo nivel de cuidado que el DELETE de `trip_stops` huérfanos de la ronda anterior:

```sql
-- bronze (estado actual + historial Type-2)
DELETE FROM bronze.tms_trips
  WHERE tms_name = 'qanalytics' AND source_client = 'iansa' AND product = 'trips';
DELETE FROM bronze.tms_trips_snapshot
  WHERE tms_name = 'qanalytics' AND source_client = 'iansa' AND product = 'trips';

-- app (stops antes que trips, por FK)
DELETE FROM app.trip_stops
  WHERE trip_id IN (
    SELECT id FROM app.trips WHERE source_system = 'qanalytics' AND client_name = 'iansa'
  );
DELETE FROM app.trips
  WHERE source_system = 'qanalytics' AND client_name = 'iansa';
```

Tras el borrado, el próximo run normal del pipeline (`qanalytics_endpoint_scraper_iansa` con `product="cumplimiento-iansa"`) repuebla desde cero con la fuente correcta.

## Verificación

1. Contra el portal real: confirmar columnas exactas de la tabla de resultados de `Reporte Detalle` (con una búsqueda real, no solo el formulario vacío) y el mecanismo exacto de `#BtExportar`.
2. Smoke test end-to-end contra el extractor nuevo (mismo patrón usado con Sodimac esta sesión), inspeccionando el archivo crudo exportado antes de tocar el transformer.
3. Contra Supabase real, tras repoblar: viajes IANSA con `raw_estado`/`origin_location_name` no-NULL (a diferencia del 100% NULL actual).
4. Conteos antes/después del DELETE de histórico (auditoría simple vía `SELECT COUNT(*)`, no requiere tabla de auditoría dedicada dado que el dato se puede reconstruir completo desde GCS/el portal si hiciera falta revertir).

## Backlog — must-have para hardening post-MVP/Hito 4

Documentado explícitamente a pedido del usuario, no se ejecuta en este plan:

1. **Migrar el transformer de Walmart** (`qanalytics_agg_nro_sap_transformer.py`) a la misma convención de `TENANT_COLUMN_MAPS` — hoy tiene su propio mapeo de columnas hardcodeado, mismo patrón que IANSA tenía antes de este fix.
2. **Evaluar consolidar las cadenas de bloques Mage duplicadas por tenant** (hoy: 5 bloques completos por tenant — scraper, loader, transformer, tabla temp, insert — repetidos íntegros entre Walmart e IANSA) en un diseño multi-tenant más escalable, de forma que agregar un tenant nuevo de QAnalytics sea un cambio de configuración, no una copia de 5 archivos. Requiere evaluar las limitaciones reales del modelo de bloques de Mage (no tiene un "loop sobre tenants" nativo limpio) antes de comprometerse a una forma específica.
