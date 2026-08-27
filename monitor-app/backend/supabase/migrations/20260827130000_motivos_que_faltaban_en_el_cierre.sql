-- Los motivos que faltaban para poder clasificar un conductor o un viaje
--
-- Pedido de Pablo en la minuta del 25/08, secciones 5.1 y 5.2. No es cosmética:
-- sin el motivo, el conductor queda UNASSIGNED sin resolver y **el cierre del
-- día no avanza**, que es exactamente el bloqueo que reportó.
--
-- Sólo se agrega lo que de verdad falta. Medido contra la base el 27/08:
-- DRIVER_REASON tenía 16 filas y TRIP_UNASSIGNED_REASON 4.
--
-- LO QUE NO SE AGREGA, Y POR QUÉ (son preguntas para Pablo, no olvidos):
--
--   * "No disponible" (5.1) — el catálogo ya tiene "Conductor no disponible".
--     Dos opciones casi iguales en el mismo desplegable no dan precisión: dan
--     dos maneras de decir lo mismo y una estadística partida al medio.
--   * "Sin equipo disponible" (5.2) — ya existe "No tenemos camión", mismo
--     concepto. Si lo que se quiere es la PALABRA, es un rename del label
--     (el code SIN_CAMION no cambia y nada histórico se rompe), no una fila
--     nueva.
--   * "Sin precio de transporte para esta ruta" (sección 4) — ya existe "No da
--     por tarifa". Mismo caso que el anterior.
--
-- `code` es la llave estable y el label es lo que se ve: renombrar después no
-- rompe nada. El ON CONFLICT hace la migración repetible.

INSERT INTO app.status_taxonomies (domain, code, label, bg_color, text_color, sort_order)
VALUES
    -- 5.1 — motivos de conductor. Colores: gris neutro, igual que el resto del
    -- dominio, salvo los que son un impedimento documental, que van en ámbar
    -- porque son los únicos accionables por Certificación.
    ('DRIVER_REASON', 'TRAMITE_PERSONAL',  'Trámite personal',  '#f3f4f6', '#374151', 17),
    ('DRIVER_REASON', 'CONDUCTOR_BACKUP',  'Conductor backup',  '#f3f4f6', '#374151', 18),
    ('DRIVER_REASON', 'SEGURO_VENCIDO',    'Seguro vencido',    '#fef9c3', '#854d0e', 19),
    -- "Adelanto de ruta" no es un motivo más: el conductor SÍ ejecutó el viaje,
    -- sólo que en la madrugada del día siguiente al de la asignación. La
    -- estadística de rotación tiene que contarlo en la fecha de ejecución, y
    -- ESO todavía no está implementado (ver la minuta, sección 3 punto 3, y el
    -- conflicto con la ventana multi-día del cierre). Se siembra igual porque
    -- hoy no hay forma de clasificar el caso, pero queda dicho que la fila sola
    -- no arregla la estadística.
    ('DRIVER_REASON', 'ADELANTO_DE_RUTA',  'Adelanto de ruta',  '#dbeafe', '#1e40af', 20),

    -- 5.2 — motivos de cierre de viaje.
    ('TRIP_UNASSIGNED_REASON', 'MANDANTE_ELIMINA',       'Mandante elimina viaje',        '#f3f4f6', '#374151', 5),
    ('TRIP_UNASSIGNED_REASON', 'MANDANTE_RECHAZA_EQUIPO','Mandante rechaza equipo',       '#f3f4f6', '#374151', 6),
    ('TRIP_UNASSIGNED_REASON', 'CANCELADO_MANDANTE',     'Cancelado por mandante',        '#f3f4f6', '#374151', 7),
    ('TRIP_UNASSIGNED_REASON', 'FLETE_FALSO',            'Flete falso',                   '#fef2f2', '#b91c1c', 8),
    ('TRIP_UNASSIGNED_REASON', 'FLETE_FALSO_SIN_CAJAS',  'Flete falso por falta de cajas','#fef2f2', '#b91c1c', 9),
    ('TRIP_UNASSIGNED_REASON', 'VUELTA_DE_CAJAS',        'Vuelta de cajas',               '#fef9c3', '#854d0e', 10)
ON CONFLICT (domain, code) WHERE code IS NOT NULL
DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, active = true;
