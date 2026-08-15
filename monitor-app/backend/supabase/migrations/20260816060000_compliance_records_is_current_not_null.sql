-- Tramo 3: `is_current` pasa a ser el interruptor principal de
-- public.compliance_records. Desde el recálculo reversible
-- (POST /compliance-requirements/{id}/recalc, app/routers/requirements.py),
-- un requisito que deja de corresponder ya no se BORRA: se apaga
-- (is_current = false), igual que hace reconcile_carrier_shipper_link() al
-- desactivar un vínculo empresa-cliente.
--
-- La columna era NULLABLE. Mientras "apagado" era un estado marginal, un
-- NULL ahí era casi inofensivo; ahora es la clase de "un null con dos
-- significados" que este proyecto ya sufrió varias veces: cada consulta que
-- lista o cuenta pendientes filtra `is_current = true`, y con la lógica de
-- tres valores de SQL un NULL cae del lado "no vigente" en el filtro pero
-- del lado "no apagado" en el `NOT is_current` — el mismo registro
-- invisible en la pantalla y, a la vez, imposible de volver a encender.
--
-- Hoy hay 0 filas con is_current NULL (verificado en producción,
-- 2026-08-15: 4.990 filas, 4.990 vigentes, 0 nulas), así que el backfill de
-- abajo es defensivo y no debería tocar nada. Se deja igual porque
-- SET NOT NULL falla —correctamente— si aparece una sola fila nula entre
-- esta verificación y la aplicación de la migración.
--
-- El DEFAULT true ya existe en la tabla; se re-declara para que este archivo
-- sea la definición completa del contrato de la columna y no haya que ir a
-- buscar la migración original (20260715204925_init_compliance_engine.sql)
-- para saber qué pasa si alguien inserta sin la columna.

UPDATE public.compliance_records
   SET is_current = true
 WHERE is_current IS NULL;

ALTER TABLE public.compliance_records
    ALTER COLUMN is_current SET DEFAULT true;

ALTER TABLE public.compliance_records
    ALTER COLUMN is_current SET NOT NULL;

COMMENT ON COLUMN public.compliance_records.is_current IS
    'Interruptor de vigencia del registro. false = el requisito dejó de '
    'exigirse a esta entidad (cambió una condición del catálogo, o se '
    'desactivó el vínculo empresa-cliente); la fila se conserva con su '
    'documento y su historial, y volver a exigirlo la vuelve a encender. '
    'Todas las consultas que listan o cuentan pendientes filtran is_current.';
