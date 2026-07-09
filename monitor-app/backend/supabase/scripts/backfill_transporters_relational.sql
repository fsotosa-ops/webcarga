-- ==============================================================================
-- BACKFILL ONE-SHOT: app.transporter_profiles (jsonb) → modelo relacional
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §2.6 / Fase 2
--
-- Ejecutado el 2026-07-09 contra viclzoftiudkepqnhekv. Idempotencia: NO es
-- re-ejecutable tal cual (insert sin on conflict) — es un one-shot previo a la
-- primera corrida del pipeline. Los rechazos quedan en ops.pipeline_rejects
-- con batch_id=0 para el barrido manual.
--
-- Reglas:
-- - Ganador por rut normalizado: Operational > updated_at más reciente.
-- - Perfiles sin RUT (6 leads) y duplicados perdedores (35) → rejects.
-- - Conductores/vehículos: entidades globales; si el mismo rut/patente aparece
--   en más de una empresa, la asignación vigente va a la empresa ganadora y el
--   resto queda en rejects (reason=duplicado) para revisión.
-- - trailers[] → app.vehicles kind='rampla'. type jsonb libre → kind operativo
--   (tracto/camion/furgon/rampla/otro) + type_label original.
-- - company_governance (solo 2 filas no vacías, ambas con ediciones manuales)
--   → compliance_documents con manual_override según manually_edited_fields.
-- ==============================================================================

begin;

-- ── Ranking de perfiles legacy ──────────────────────────────────────────────
create temp table _profiles_ranked on commit drop as
select p.id as profile_id,
       app.normalize_rut(p.rut) as rut_norm,
       nullif(upper(split_part(regexp_replace(coalesce(p.rut,''), '[.\s]', '', 'g'), '-', 2)), '') as dv,
       p.business_name, p.admin_id, p.account_stage, p.contactability,
       p.company_governance, p.manually_edited_fields, p.edited_by, p.edited_at,
       p.created_at, p.updated_at,
       row_number() over (
         partition by app.normalize_rut(p.rut)
         order by (p.account_stage = 'Operational') desc, p.updated_at desc nulls last, p.created_at desc
       ) as rn
from app.transporter_profiles p
where app.normalize_rut(p.rut) <> '';

insert into ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
select 0, 'app.transporter_profiles', 'rut_vacio',
       jsonb_build_object('profile_id', id, 'rut', rut, 'business_name', business_name,
                          'account_stage', account_stage, 'admin_id', admin_id)
from app.transporter_profiles
where app.normalize_rut(rut) = '';

insert into ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
select 0, 'app.transporter_profiles', 'duplicado',
       jsonb_build_object('profile_id', profile_id, 'rut_norm', rut_norm, 'business_name', business_name,
                          'account_stage', account_stage, 'admin_id', admin_id)
from _profiles_ranked where rn > 1;

-- ── app.transporters ────────────────────────────────────────────────────────
insert into app.transporters (rut, dv, rut_dv_valid, business_name, in_admin, admin_internal_id,
  account_stage, contactability, source, manually_edited_fields, edited_by, edited_at, created_at, updated_at)
select rut_norm, dv,
       case when dv is not null then app.rut_dv(rut_norm) = dv end,
       coalesce(nullif(trim(business_name), ''), 'Sin razón social (admin ' || coalesce(admin_id, '?') || ')'),
       admin_id is not null,
       nullif(admin_id, '')::int,
       coalesce(account_stage, 'Lead'),
       contactability, 'admin',
       coalesce(manually_edited_fields, '{}'), edited_by, edited_at,
       coalesce(created_at, now()), coalesce(updated_at, now())
from _profiles_ranked
where rn = 1;

-- ── Conductores (entidad global + asignación vigente) ──────────────────────
create temp table _drivers_src on commit drop as
select app.normalize_rut(x->>'rut') as rut_norm,
       nullif(upper(split_part(regexp_replace(coalesce(x->>'rut',''), '[.\s]', '', 'g'), '-', 2)), '') as dv,
       nullif(trim(x->>'name'), '') as full_name,
       pr.rut_norm as t_rut, pr.account_stage, pr.updated_at, x as raw
from app.transporter_profiles p
join _profiles_ranked pr on app.normalize_rut(p.rut) = pr.rut_norm and pr.rn = 1
cross join lateral jsonb_array_elements(coalesce(p.drivers, '[]')) x;

insert into ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
select 0, 'transporter_profiles.drivers', 'rut_vacio',
       jsonb_build_object('driver', raw, 'empresa_rut', t_rut)
from _drivers_src where rut_norm = '';

create temp table _drivers_ranked on commit drop as
select *, row_number() over (
  partition by rut_norm
  order by (account_stage = 'Operational') desc, updated_at desc nulls last
) as rn
from _drivers_src where rut_norm <> '';

insert into app.drivers (rut, dv, rut_dv_valid, full_name, source)
select rut_norm, dv,
       case when dv is not null then app.rut_dv(rut_norm) = dv end,
       coalesce(full_name, 'Sin nombre'), 'admin'
from _drivers_ranked where rn = 1;

insert into app.driver_assignments (driver_id, transporter_id)
select d.id, t.id
from _drivers_ranked r
join app.drivers d on d.rut = r.rut_norm
join app.transporters t on t.rut = r.t_rut
where r.rn = 1;

insert into ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
select 0, 'transporter_profiles.drivers', 'duplicado',
       jsonb_build_object('rut', r.rut_norm, 'name', r.full_name,
                          'empresa_rut', r.t_rut, 'empresa_ganadora', w.t_rut)
from _drivers_ranked r
join _drivers_ranked w on w.rut_norm = r.rut_norm and w.rn = 1
where r.rn > 1 and r.t_rut <> w.t_rut;

-- ── Vehículos (vehicles[] + trailers[] → entidad global + asignación) ──────
create temp table _vehicles_src on commit drop as
select upper(replace(coalesce(x->>'plate',''), ' ', '')) as plate,
       nullif(trim(x->>'type'), '') as type_label,
       case
         when x->>'type' ilike 'tracto%' then 'tracto'
         when x->>'type' ilike '%furg%'  then 'furgon'
         when x->>'type' ilike 'cami%'   then 'camion'
         else 'otro'
       end as kind,
       pr.rut_norm as t_rut, pr.account_stage, pr.updated_at, x as raw
from app.transporter_profiles p
join _profiles_ranked pr on app.normalize_rut(p.rut) = pr.rut_norm and pr.rn = 1
cross join lateral jsonb_array_elements(coalesce(p.vehicles, '[]')) x
union all
select upper(replace(coalesce(x->>'plate',''), ' ', '')),
       'Rampla', 'rampla',
       pr.rut_norm, pr.account_stage, pr.updated_at, x
from app.transporter_profiles p
join _profiles_ranked pr on app.normalize_rut(p.rut) = pr.rut_norm and pr.rn = 1
cross join lateral jsonb_array_elements(coalesce(p.trailers, '[]')) x;

insert into ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
select 0, 'transporter_profiles.vehicles', 'patente_vacia',
       jsonb_build_object('vehicle', raw, 'empresa_rut', t_rut)
from _vehicles_src where plate = '';

create temp table _vehicles_ranked on commit drop as
select *, row_number() over (
  partition by plate
  order by (account_stage = 'Operational') desc, updated_at desc nulls last
) as rn
from _vehicles_src where plate <> '';

insert into app.vehicles (plate, kind, type_label, source)
select plate, kind, type_label, 'admin'
from _vehicles_ranked where rn = 1;

insert into app.vehicle_assignments (vehicle_id, transporter_id)
select v.id, t.id
from _vehicles_ranked r
join app.vehicles v on v.plate = r.plate
join app.transporters t on t.rut = r.t_rut
where r.rn = 1;

insert into ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
select 0, 'transporter_profiles.vehicles', 'duplicado',
       jsonb_build_object('plate', r.plate, 'kind', r.kind,
                          'empresa_rut', r.t_rut, 'empresa_ganadora', w.t_rut)
from _vehicles_ranked r
join _vehicles_ranked w on w.plate = r.plate and w.rn = 1
where r.rn > 1 and r.t_rut <> w.t_rut;

-- ── Governance legacy → compliance_documents ────────────────────────────────
insert into app.compliance_documents (entity_type, entity_id, doc_code, status, source, manual_override)
select 'transporter', t.id, g.key, g.value::app.compliance_status,
       case when 'company_governance' = any(pr.manually_edited_fields) then 'manual' else 'admin' end,
       ('company_governance' = any(pr.manually_edited_fields))
from _profiles_ranked pr
join app.transporters t on t.rut = pr.rut_norm
cross join lateral jsonb_each_text(pr.company_governance) g(key, value)
where pr.rn = 1
  and pr.company_governance is not null and pr.company_governance <> '{}'::jsonb
  and g.key in (select doc_code from app.compliance_doc_catalog where entity_type = 'transporter')
  and g.value in ('ok', 'pendiente', 'actualizar', 'n_a', 'factible');

commit;
