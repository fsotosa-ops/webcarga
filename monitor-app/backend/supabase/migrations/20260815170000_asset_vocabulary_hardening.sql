-- Tramo 2, Tarea 11: normalizar y proteger el vocabulario de vehículos.
--
-- ORDEN OBLIGATORIO: esta migración va DESPUÉS de desplegar el código que
-- retira CAMION/FURGON/OTRO del `Literal` de Pydantic y de los dos selectores
-- de la interfaz. Al revés, elegir "Camión" en un selector todavía vivo pasa
-- la validación y revienta acá con un 500 en vez de dar un 422 legible.

-- ── 1. El CHECK que faltaba ────────────────────────────────────────────────
-- `asset_type` era un VARCHAR NOT NULL sin restricción: los 118 vehículos
-- están limpios (81 TRACTOCAMION / 37 RAMPLA) por comportamiento del loader,
-- no porque algo lo impida. Cada variante nueva que alguien escriba en el
-- Excel de origen es un riesgo mudo — y ese origen ya está sin normalizar en
-- tres pares de sinónimos distintos (ver AGENTLOG, auditoría H1b).
ALTER TABLE public.assets
    ADD CONSTRAINT assets_asset_type_check
    CHECK (asset_type IN ('TRACTOCAMION', 'RAMPLA'));

-- ── 2. La etiqueta que desentonaba ─────────────────────────────────────────
-- `TRACTOCAMION` era la única de las 10 del dominio en mayúsculas; las otras
-- nueve son Título Capitalizado (`Furgón Seco`, `Doble Piso Furgón`, `Sider`).
-- La puso a pedido explícito la migración 20260804000000 para reusar el texto
-- literal de la columna C del Excel. Se normaliza ahora porque la app entra en
-- uso real y la inconsistencia se ve en pantalla.
--
-- Verificado seguro: los 9 literales 'TRACTOCAMION' del backend y los del
-- frontend apuntan todos a `assets.asset_type`, NINGUNO a la etiqueta de la
-- taxonomía. La interfaz la lee por `fleet_service_type_label`.
UPDATE app.status_taxonomies
   SET label = 'Tractocamión'
 WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'TRACTOCAMION';

-- ── 3. Las dos vistas materializadas que guardan la etiqueta ───────────────
-- `app.carrier_asset_roster` la guarda DESNORMALIZADA: 78 de sus 116 filas
-- decían 'TRACTOCAMION'. Su trigger de refresco (20260804010000) escucha
-- cambios en `assets`, NO en `app.status_taxonomies`, así que sin esto el
-- rename no se propaga y la interfaz sigue mostrando la etiqueta vieja.
REFRESH MATERIALIZED VIEW app.carrier_asset_roster;
REFRESH MATERIALIZED VIEW app.asset_compliance_status;
