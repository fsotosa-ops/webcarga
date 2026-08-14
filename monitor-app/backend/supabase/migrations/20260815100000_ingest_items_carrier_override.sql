-- ==============================================================================
-- El archivo de la bandeja puede pertenecer a otra empresa que su lote
-- ==============================================================================
--
-- Cubre la cuarta variante de "mover un documento" (HU-03), que es el error más
-- probable del uso real: soltar cuarenta archivos en la empresa equivocada y
-- darse cuenta recién al verlos en la bandeja.
--
-- Hasta ahora `document_ingest_items` heredaba la empresa de su lote
-- (`document_ingest_batches.carrier_id`), así que la única salida era eliminar
-- los archivos y volver a subirlos.
--
-- NULL significa "hereda la del lote", que es el caso normal. La columna sólo
-- se escribe cuando alguien mueve el archivo a propósito.
--
-- A diferencia de las otras variantes de "mover", esta NO toca
-- compliance_records: el archivo todavía no está aplicado a ningún requisito.
-- ==============================================================================

ALTER TABLE public.document_ingest_items
    ADD COLUMN carrier_id UUID REFERENCES public.carriers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.document_ingest_items.carrier_id IS
    'Empresa del archivo cuando difiere de la del lote. NULL = hereda de document_ingest_batches.carrier_id.';

CREATE INDEX idx_ingest_items_carrier ON public.document_ingest_items (carrier_id)
    WHERE carrier_id IS NOT NULL;
