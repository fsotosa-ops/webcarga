-- Fase 1 (HU Cierre del Día §2.2): tabla puente M:N empresa↔tipo de
-- operación, mirror exacto de public.carrier_shippers (misma forma,
-- mismas convenciones status/start_date/end_date) — carrier_shippers ya
-- resolvió este mismo problema (empresa↔shipper) y hoy se puebla desde
-- afuera de la app (Excel de empresas en SharePoint, "solo lectura por
-- ahora" en la API, ver carriers.py) — el Excel de empresas es también la
-- fuente de esta columna nueva según la propia HU ("se agrega como columna
-- al Excel de empresas"), así que se replica el mismo contrato: la API solo
-- expone lectura hasta que exista un flujo de ingesta definido.
CREATE TABLE public.carrier_fleet_service_types (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    carrier_id UUID NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
    taxonomy_id UUID NOT NULL REFERENCES app.status_taxonomies(id),
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(carrier_id, taxonomy_id)
);

CREATE INDEX idx_carrier_fleet_service_types_taxonomy_id
  ON public.carrier_fleet_service_types(taxonomy_id);
