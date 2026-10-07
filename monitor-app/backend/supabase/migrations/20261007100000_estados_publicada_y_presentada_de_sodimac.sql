-- Sodimac: mostrar Publicada y Presentada como las dice el TMS (Ronda 166, 07/10).
--
-- QUÉ ESTABA MAL
-- int_tms_trips_conformed traducía dos estados crudos de Sodimac a 'ASIGNADO':
--   Publicada  → es una OFERTA a WebCarga. En el historial (abril–octubre) pasa
--                a Aceptada (la tomamos), a Removida/Declinada, o desaparece de
--                la lista (la tomó otro / venció). Nunca es un viaje asignado.
--   Presentada → el camión ya se presentó en origen (Aceptada → Presentada →
--                Despachada / Carga finalizada).
-- Sodimac nunca usó la palabra "ASIGNADO": la traducción era nuestra. En el
-- Monitor una oferta se veía "Asignado, en ruta" y contaba como carga del día;
-- el tooltip "· Sodimac" del 25/08 explicaba en pantalla una confusión que
-- introducía la homologación.
--
-- QUÉ CAMBIA
-- La homologación deja pasar los dos estados tal cual (como ya hacía con
-- Creada/Aceptada/Control de salida, ver 20260802020000). Esta migración les da
-- su fila en el catálogo:
--   Publicada  → grupo 'otro' (con sus hermanas previas al viaje) y
--                counts_as_load = false: una oferta no es una carga hasta que
--                se acepta. Es el único estado NO terminal que no cuenta como
--                carga, y de ahí lee silver.stg_tms_presence que un viaje que
--                falta en el TMS es una oferta retirada y no un viaje eliminado.
--   Presentada → grupo 'en_ruta', counts_as_load = true (equivale a ORIGEN de
--                QAnalytics).
-- ASIGNADO sigue en el catálogo: lo usa QAnalytics.

INSERT INTO app.trip_statuses (id, label, bg_color, text_color, group_id, sort_order, active, counts_as_load) VALUES
  ('Publicada',  'Publicada',  '#f1f5f9', '#475569', 'otro',    25, true, false),
  ('Presentada', 'Presentada', '#f3e8ff', '#8a00dd', 'en_ruta', 26, true, true)
ON CONFLICT (id) DO NOTHING;
