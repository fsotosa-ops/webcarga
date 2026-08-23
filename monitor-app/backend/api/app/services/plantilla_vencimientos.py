"""La planilla de vencimientos: una sola definicion de sus columnas.

De los 5.026 documentos pendientes, solo 2.656 corresponden a documentos que
PIDEN fecha de vencimiento (19 de 37 requisitos activos), y de esos 1.315 estan
en las 39 empresas activas. Esa es la planilla. Los otros 2.370 —Reglamento
Interno, Cuenta Bancaria, Rol SII, PTS, Padron, GPS— no llevan vencimiento, y
ofrecerles una celda de fecha es invitar a llenarla para despues rechazarla.

Origen: Pablo, reunion del 21/08 — *"seria bueno poder subir de alguna forma
las fechas nomas. La informacion que yo tengo en un Excel. Sin el documento"*,
y explicitamente *"solo de las treinta y nueve activas"*.

POR QUE LA LLAVE ES EL registro_id Y NO EL RUT. El identificador natural es
distinto en cada nivel: empresa y conductor por `tax_id`, pero el VEHICULO no
tiene RUT y va por patente. Un match por identificador necesitaria tres reglas
y fallaria en los dos bordes que estan medidos: los 5 registros del unico
conductor sin `tax_id` de los 87 no entrarian nunca, y las 88 filas que no
resuelven a ninguna empresa no tendrian con que desambiguarse. El RUT y la
patente viajan igual en el archivo, pero para que la persona se ubique — no
para matchear.

Esta lista se escribe UNA vez y la consumen la plantilla que baja y el parser
que sube. Escribirla dos veces es como este router llego a tener una lista de
columnas escrita tres veces y un 500 con toda la suite en verde.
"""

# La unica columna que la persona completa. El resto es contexto de solo
# lectura, y `registro_id` es la llave que devuelve cada fila a su lugar.
COLUMNA_LLAVE = "registro_id"
COLUMNA_EDITABLE = "vence_el"

COLUMNAS = [
    {"csv_key": "registro_id",   "label": "Registro",      "editable": False},
    {"csv_key": "empresa",       "label": "Empresa",       "editable": False},
    {"csv_key": "tipo",          "label": "Tipo",          "editable": False},
    {"csv_key": "sujeto",        "label": "Sujeto",        "editable": False},
    {"csv_key": "identificador", "label": "RUT o patente", "editable": False},
    {"csv_key": "documento",     "label": "Documento",     "editable": False},
    {"csv_key": COLUMNA_EDITABLE, "label": "Vence el",     "editable": True},
]

# `activas` es el default y es lo que pidio Pablo. `todas` suma las 207
# LEGACY_INACTIVE, las 2 INACTIVE y las 88 filas sin empresa — el historico que
# dijo que NO queria cargar, disponible para quien lo pida a proposito.
ALCANCES = ("activas", "todas")


def sql_filas_plantilla(pendiente: str) -> str:
    """Las filas de la planilla. `pendiente` es el predicado compartido
    (`pendiente_predicate` de routers/compliance.py) — se recibe en vez de
    escribirse aca para que la planilla y la cola de trabajo no puedan
    divergir: si manana "pendiente" cambia, cambian las dos juntas.

    $1 = alcance ('activas' | 'todas').

    `vence_el` viene PRE-LLENADO cuando el registro ya tiene fecha (hoy son 12
    de 1.326). La persona ve lo que hay en vez de escribir a ciegas sobre un
    dato existente, y al volver, una fila cuyo valor no cambio no se cuenta
    como cambio.
    """
    return f"""
WITH pendientes AS (
    SELECT cr.id, cr.entity_type, cr.entity_id, cr.expiration_date,
           req.name AS documento
    FROM public.compliance_records cr
    JOIN public.compliance_requirements req ON req.id = cr.requirement_id
    WHERE cr.is_current = true
      -- Solo los documentos que PIDEN fecha. Un documento sin vencimiento
      -- (Reglamento Interno, Rol SII, Padron, GPS) en una planilla de fechas
      -- es una celda que invita a llenarse para despues ser rechazada.
      AND req.is_active = true
      AND req.has_expiration = true
      AND {pendiente}
),
resueltas AS (
    SELECT p.*,
        CASE p.entity_type
            WHEN 'CARRIER' THEN p.entity_id
            WHEN 'DRIVER'  THEN da.carrier_id
            WHEN 'ASSET'   THEN aa.carrier_id
        END AS carrier_id,
        CASE p.entity_type
            WHEN 'CARRIER' THEN 'Empresa'
            WHEN 'DRIVER'  THEN 'Conductor'
            ELSE 'Vehículo'
        END AS tipo,
        -- Vacio a proposito para las filas de empresa: la columna `empresa` ya
        -- lo dice, y repetirlo gasta un tercio de la planilla en eco.
        CASE p.entity_type
            WHEN 'DRIVER' THEN d.full_name
            WHEN 'ASSET'  THEN a.license_plate
        END AS sujeto_alt,
        -- El vehiculo no tiene RUT: su identificador ES la patente.
        CASE p.entity_type
            WHEN 'DRIVER' THEN d.tax_id
            WHEN 'ASSET'  THEN a.license_plate
        END AS ident_alt
    FROM pendientes p
    LEFT JOIN public.driver_assignments da
        ON p.entity_type = 'DRIVER' AND da.driver_id = p.entity_id AND da.status = 'ACTIVE'
    LEFT JOIN public.asset_assignments aa
        ON p.entity_type = 'ASSET' AND aa.asset_id = p.entity_id AND aa.status = 'ACTIVE'
    LEFT JOIN public.drivers d ON p.entity_type = 'DRIVER' AND d.id = p.entity_id
    LEFT JOIN public.assets  a ON p.entity_type = 'ASSET'  AND a.id = p.entity_id
)
SELECT r.id::text                                  AS registro_id,
       COALESCE(c.business_name, '')               AS empresa,
       r.tipo,
       COALESCE(r.sujeto_alt, '')                  AS sujeto,
       COALESCE(r.ident_alt, c.tax_id, '')         AS identificador,
       r.documento,
       COALESCE(to_char(r.expiration_date, 'DD-MM-YYYY'), '') AS {COLUMNA_EDITABLE}
FROM resueltas r
LEFT JOIN public.carriers c ON c.id = r.carrier_id
-- 'activas' descarta por construccion las filas sin empresa (c es NULL), que
-- son 88: 48 vehiculos y 40 conductores sin asignacion activa. Son trabajo
-- real pero no son de nadie todavia, y meterlos en la planilla de las 39
-- empresas activas es ruido. Salen con alcance='todas'.
WHERE ($1::text = 'todas' OR c.operational_status = 'ACTIVE')
-- Bloques contiguos: quien llena una empresa trabaja seguido y no salta por
-- el archivo. El orden de `tipo` es el del negocio, no el alfabetico.
ORDER BY c.business_name NULLS LAST,
         CASE r.tipo WHEN 'Empresa' THEN 0 WHEN 'Conductor' THEN 1 ELSE 2 END,
         COALESCE(r.sujeto_alt, ''),
         r.documento
"""


# El origen queda escrito en la auditoria: `source` ya distingue quien escribio
# (`pre_cierre_auto`, `cierre_viajes`), y una carga de 1.326 fechas tiene que
# poder separarse de una edicion a mano cuando alguien audite el modulo.
FUENTE_AUDITORIA = "planilla_vencimientos"

# LA ESCRITURA ES UNA SOLA SENTENCIA, Y NO ES UNA OPTIMIZACION.
#
# `trg_refresh_view_on_compliance` ejecuta REFRESH MATERIALIZED VIEW
# CONCURRENTLY POR STATEMENT sobre public.compliance_records. Fila por fila,
# 1.326 filas son 1.326 refrescos de vista materializada. Y el camino de a una
# cuesta el doble: `record_manual_edit()` hace un SEGUNDO UPDATE sobre la misma
# tabla para marcar is_manual_override, asi que dispara el trigger otra vez.
#
# Por eso aca el marcado de override viaja DENTRO del mismo UPDATE en vez de
# llamar a `record_manual_edit()`, y la auditoria se inserta aparte — audit_log
# no tiene ese trigger.
SQL_APLICAR = """
UPDATE public.compliance_records cr
SET expiration_date    = v.vence_el,
    is_manual_override = true,
    overridden_by      = $3::uuid,
    overridden_at      = now(),
    updated_at         = now()
FROM unnest($1::uuid[], $2::date[]) AS v(id, vence_el)
WHERE cr.id = v.id AND cr.is_current = true
RETURNING cr.id::text AS registro_id
"""

# Un renglon de auditoria por fila cambiada, tambien en una sola sentencia.
# `to_jsonb(text)` produce exactamente lo mismo que el json.dumps() de
# log_change() para un escalar, asi que estas filas son indistinguibles de las
# que escribe una edicion de a una — se leen con la misma consulta.
SQL_AUDITAR = """
INSERT INTO public.audit_log
    (actor, entity_type, entity_id, action, field, old_value, new_value, source)
SELECT $1::uuid, v.entity_type, v.entity_id::uuid, 'update', 'expiration_date',
       to_jsonb(v.antes), to_jsonb(v.despues), $6::text
FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])
     AS v(entity_type, entity_id, antes, despues)
"""
